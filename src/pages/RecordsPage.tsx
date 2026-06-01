import dayjs from 'dayjs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { instrumentsByMarket } from '../config/instruments'
import { db } from '../db/database'
import { createId } from '../lib/id'
import type { Market } from '../types/models'
import type { CashflowRecord, InitialHolding, TradeRecord } from '../types/models'

const isValidDate = (dateText: string) => /^\d{4}-\d{2}-\d{2}$/.test(dateText) && dayjs(dateText).isValid()

export const RecordsPage = () => {
  const { profileId = '' } = useParams()
  const [market, setMarket] = useState<Market>('cn')
  const [cashflows, setCashflows] = useState<CashflowRecord[]>([])
  const [trades, setTrades] = useState<TradeRecord[]>([])
  const [holdings, setHoldings] = useState<InitialHolding[]>([])

  const [newCashflowDate, setNewCashflowDate] = useState(dayjs().format('YYYY-MM-DD'))
  const [newCashflowAmount, setNewCashflowAmount] = useState('1000')
  const [newCashflowMode, setNewCashflowMode] = useState<'increment' | 'set-total'>('increment')
  const [cashflowAddError, setCashflowAddError] = useState('')

  const [newTradeDate, setNewTradeDate] = useState(dayjs().format('YYYY-MM-DD'))
  const [newTradeCode, setNewTradeCode] = useState('')
  const [newTradeQuantity, setNewTradeQuantity] = useState('1')
  const [newTradePrice, setNewTradePrice] = useState('')
  const [tradeAddError, setTradeAddError] = useState('')

  const [editingCashflowId, setEditingCashflowId] = useState<string | null>(null)
  const [editingCashflowDate, setEditingCashflowDate] = useState('')
  const [editingCashflowAmount, setEditingCashflowAmount] = useState('')
  const [cashflowEditError, setCashflowEditError] = useState('')
  const [editingHoldingId, setEditingHoldingId] = useState<string | null>(null)
  const [editingHoldingQuantity, setEditingHoldingQuantity] = useState('')
  const [holdingEditError, setHoldingEditError] = useState('')
  const [editingTradeId, setEditingTradeId] = useState<string | null>(null)
  const [editingTradeQuantity, setEditingTradeQuantity] = useState('')
  const [tradeEditError, setTradeEditError] = useState('')

  const instrumentOptions = useMemo(() => instrumentsByMarket(market), [market])
  const defaultInstrumentCode = instrumentOptions[0]?.code ?? ''

  const refresh = useCallback(async () => {
    const [profile, nextCashflows, nextTrades, nextHoldings] = await Promise.all([
      db.profiles.get(profileId),
      db.cashflows.where('profileId').equals(profileId).reverse().sortBy('date'),
      db.trades.where('profileId').equals(profileId).reverse().sortBy('date'),
      db.initialHoldings.where('profileId').equals(profileId).reverse().sortBy('acquiredAt'),
    ])
    setMarket(profile?.market ?? 'cn')
    setCashflows(nextCashflows)
    setTrades(nextTrades)
    setHoldings(nextHoldings)
  }, [profileId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!newTradeCode && defaultInstrumentCode) {
      setNewTradeCode(defaultInstrumentCode)
    }
  }, [defaultInstrumentCode, newTradeCode])

  return (
    <section>
      <h2>记录管理</h2>

      <h3>新增现金流</h3>
      <div className="actions-row">
        <label>
          模式
          <select value={newCashflowMode} onChange={(event) => setNewCashflowMode(event.target.value as 'increment' | 'set-total')}>
            <option value="increment">增量（正数入账，负数支出）</option>
            <option value="set-total">设定总现金（系统自动计算差值）</option>
          </select>
        </label>
        <label>
          日期
          <input type="date" value={newCashflowDate} onChange={(event) => setNewCashflowDate(event.target.value)} />
        </label>
        <label>
          {newCashflowMode === 'increment' ? '增量金额（可正可负）' : '目标总现金'}
          <input
            type="number"
            step="0.01"
            value={newCashflowAmount}
            onChange={(event) => setNewCashflowAmount(event.target.value)}
          />
        </label>
        <button
          onClick={async () => {
            const inputValue = Number(newCashflowAmount)
            if (!isValidDate(newCashflowDate)) {
              setCashflowAddError('日期格式应为 YYYY-MM-DD')
              return
            }
            if (!Number.isFinite(inputValue)) {
              setCashflowAddError('金额必须是有效数字')
              return
            }
            let amount: number
            if (newCashflowMode === 'increment') {
              amount = inputValue
            } else {
              const existingCash = cashflows.reduce((sum, row) => sum + row.amount, 0)
              amount = inputValue - existingCash
            }
            await db.cashflows.add({ id: createId(), profileId, date: newCashflowDate, amount })
            setCashflowAddError('')
            setNewCashflowAmount('')
            await refresh()
          }}
        >
          添加现金流
        </button>
      </div>
      {newCashflowMode === 'set-total' && (
        <p className="helper">
          当前已记录现金合计：{cashflows.reduce((sum, row) => sum + row.amount, 0).toFixed(2)}，
          系统会插入差值作为新记录。
        </p>
      )}
      {cashflowAddError && <p className="error">{cashflowAddError}</p>}

      <h3>新增交易</h3>
      <div className="actions-row">
        <label>
          日期
          <input type="date" value={newTradeDate} onChange={(event) => setNewTradeDate(event.target.value)} />
        </label>
        <label>
          标的
          <select value={newTradeCode} onChange={(event) => setNewTradeCode(event.target.value)}>
            {instrumentOptions.map((item) => (
              <option value={item.code} key={item.code}>
                {item.code}
              </option>
            ))}
          </select>
        </label>
        <label>
          数量
          <input
            type="number"
            step="0.0001"
            value={newTradeQuantity}
            onChange={(event) => setNewTradeQuantity(event.target.value)}
          />
        </label>
        <label>
          成交价（留空市价）
          <input type="number" step="0.0001" value={newTradePrice} onChange={(event) => setNewTradePrice(event.target.value)} />
        </label>
        <button
          onClick={async () => {
            const quantity = Number(newTradeQuantity)
            const price = Number(newTradePrice)
            if (!isValidDate(newTradeDate)) {
              setTradeAddError('新增交易日期格式应为 YYYY-MM-DD')
              return
            }
            if (!newTradeCode.trim()) {
              setTradeAddError('新增交易标的不能为空')
              return
            }
            if (!Number.isFinite(quantity) || quantity <= 0) {
              setTradeAddError('新增交易数量必须大于 0')
              return
            }
            await db.trades.add({
              id: createId(),
              profileId,
              date: newTradeDate,
              instrumentCode: newTradeCode.trim(),
              side: 'buy',
              quantity,
              price: Number.isFinite(price) && price > 0 ? price : null,
            })
            setTradeAddError('')
            setNewTradeCode(defaultInstrumentCode)
            setNewTradeQuantity('1')
            setNewTradePrice('')
            await refresh()
          }}
        >
          添加交易
        </button>
      </div>
      {tradeAddError && <p className="error">{tradeAddError}</p>}

      <h3>初始持仓</h3>
      <ul>
        {holdings.map((row) => (
          <li key={row.id}>
            {editingHoldingId === row.id ? (
              <>
                {row.acquiredAt} - {row.instrumentCode}
                <input
                  type="number"
                  step="0.0001"
                  value={editingHoldingQuantity}
                  onChange={(event) => setEditingHoldingQuantity(event.target.value)}
                />
                <button
                  onClick={async () => {
                    const quantity = Number(editingHoldingQuantity)
                    if (!Number.isFinite(quantity) || quantity <= 0) {
                      setHoldingEditError('初始持仓数量必须大于 0')
                      return
                    }
                    await db.initialHoldings.put({ ...row, quantity })
                    setEditingHoldingId(null)
                    setEditingHoldingQuantity('')
                    setHoldingEditError('')
                    await refresh()
                  }}
                >
                  保存
                </button>
                <button
                  onClick={() => {
                    setEditingHoldingId(null)
                    setEditingHoldingQuantity('')
                    setHoldingEditError('')
                  }}
                >
                  取消
                </button>
              </>
            ) : (
              <>
                {row.acquiredAt} - {row.instrumentCode} - {row.quantity}
                <button
                  onClick={() => {
                    setEditingHoldingId(row.id)
                    setEditingHoldingQuantity(String(row.quantity))
                    setHoldingEditError('')
                  }}
                >
                  编辑
                </button>
                <button
                  onClick={async () => {
                    await db.initialHoldings.delete(row.id)
                    await refresh()
                  }}
                >
                  删除
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      {holdingEditError && <p className="error">{holdingEditError}</p>}

      <h3>现金流记录</h3>
      <ul>
        {cashflows.map((row) => (
          <li key={row.id}>
            {editingCashflowId === row.id ? (
              <>
                <input
                  type="date"
                  value={editingCashflowDate}
                  onChange={(event) => setEditingCashflowDate(event.target.value)}
                />
                <input
                  type="number"
                  step="0.01"
                  value={editingCashflowAmount}
                  onChange={(event) => setEditingCashflowAmount(event.target.value)}
                />
                <button
                  onClick={async () => {
                    const amount = Number(editingCashflowAmount)
                    if (!dayjs(editingCashflowDate, 'YYYY-MM-DD', true).isValid()) {
                      setCashflowEditError('日期格式必须是 YYYY-MM-DD')
                      return
                    }
                    if (!Number.isFinite(amount)) {
                      setCashflowEditError('金额必须是有效数字')
                      return
                    }
                    await db.cashflows.put({ ...row, date: editingCashflowDate, amount })
                    setEditingCashflowId(null)
                    setEditingCashflowDate('')
                    setEditingCashflowAmount('')
                    setCashflowEditError('')
                    await refresh()
                  }}
                >
                  保存
                </button>
                <button
                  onClick={() => {
                    setEditingCashflowId(null)
                    setEditingCashflowDate('')
                    setEditingCashflowAmount('')
                    setCashflowEditError('')
                  }}
                >
                  取消
                </button>
              </>
            ) : (
              <>
                {row.date} - {row.amount}
                <button
                  onClick={() => {
                    setEditingCashflowId(row.id)
                    setEditingCashflowDate(row.date)
                    setEditingCashflowAmount(String(row.amount))
                    setCashflowEditError('')
                  }}
                >
                  编辑
                </button>
                <button
                  onClick={async () => {
                    await db.cashflows.delete(row.id)
                    await refresh()
                  }}
                >
                  删除
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      {cashflowEditError && <p className="error">{cashflowEditError}</p>}

      <h3>交易记录</h3>
      <ul>
        {trades.map((row) => (
          <li key={row.id}>
            {editingTradeId === row.id ? (
              <>
                {row.date} - {row.side} {row.instrumentCode}
                <input
                  type="number"
                  step="0.0001"
                  value={editingTradeQuantity}
                  onChange={(event) => setEditingTradeQuantity(event.target.value)}
                />
                @ {row.price ?? '市价'}
                <button
                  onClick={async () => {
                    const quantity = Number(editingTradeQuantity)
                    if (!Number.isFinite(quantity) || quantity <= 0) {
                      setTradeEditError('交易数量必须大于 0')
                      return
                    }
                    await db.trades.put({ ...row, quantity })
                    setEditingTradeId(null)
                    setEditingTradeQuantity('')
                    setTradeEditError('')
                    await refresh()
                  }}
                >
                  保存
                </button>
                <button
                  onClick={() => {
                    setEditingTradeId(null)
                    setEditingTradeQuantity('')
                    setTradeEditError('')
                  }}
                >
                  取消
                </button>
              </>
            ) : (
              <>
                {row.date} - {row.side} {row.instrumentCode} {row.quantity} @ {row.price ?? '市价'}
                <button
                  onClick={() => {
                    setEditingTradeId(row.id)
                    setEditingTradeQuantity(String(row.quantity))
                    setTradeEditError('')
                  }}
                >
                  编辑
                </button>
                <button
                  onClick={async () => {
                    await db.trades.delete(row.id)
                    await refresh()
                  }}
                >
                  删除
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      {tradeEditError && <p className="error">{tradeEditError}</p>}
    </section>
  )
}
