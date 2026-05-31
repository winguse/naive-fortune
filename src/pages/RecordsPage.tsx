import dayjs from 'dayjs'
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { db } from '../db/database'
import { createId } from '../lib/id'
import type { CashflowRecord, InitialHolding, TradeRecord } from '../types/models'

export const RecordsPage = () => {
  const { profileId = '' } = useParams()
  const [cashflows, setCashflows] = useState<CashflowRecord[]>([])
  const [trades, setTrades] = useState<TradeRecord[]>([])
  const [holdings, setHoldings] = useState<InitialHolding[]>([])

  const refresh = async () => {
    const [nextCashflows, nextTrades, nextHoldings] = await Promise.all([
      db.cashflows.where('profileId').equals(profileId).reverse().sortBy('date'),
      db.trades.where('profileId').equals(profileId).reverse().sortBy('date'),
      db.initialHoldings.where('profileId').equals(profileId).reverse().sortBy('acquiredAt'),
    ])
    setCashflows(nextCashflows)
    setTrades(nextTrades)
    setHoldings(nextHoldings)
  }

  useEffect(() => {
    void refresh()
  }, [profileId])

  return (
    <section>
      <h2>记录管理</h2>

      <h3>新增现金流</h3>
      <button
        onClick={async () => {
          const amount = Number(window.prompt('输入现金金额（正数）', '1000'))
          if (!Number.isFinite(amount)) return
          await db.cashflows.add({ id: createId(), profileId, date: dayjs().format('YYYY-MM-DD'), amount })
          await refresh()
        }}
      >
        添加现金流
      </button>

      <h3>新增交易</h3>
      <button
        onClick={async () => {
          const instrumentCode = window.prompt('标的代码，例如 510300')
          const quantity = Number(window.prompt('数量', '1'))
          const price = Number(window.prompt('成交价格（留空则使用市价）', '0'))
          if (!instrumentCode || !Number.isFinite(quantity)) return
          await db.trades.add({
            id: createId(),
            profileId,
            date: dayjs().format('YYYY-MM-DD'),
            instrumentCode,
            side: 'buy',
            quantity,
            price: Number.isFinite(price) && price > 0 ? price : null,
          })
          await refresh()
        }}
      >
        添加交易
      </button>

      <h3>初始持仓</h3>
      <ul>
        {holdings.map((row) => (
          <li key={row.id}>
            {row.acquiredAt} - {row.instrumentCode} - {row.quantity}
            <button
              onClick={async () => {
                const quantity = Number(window.prompt('修改数量', String(row.quantity)))
                if (!Number.isFinite(quantity)) return
                await db.initialHoldings.put({ ...row, quantity })
                await refresh()
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
          </li>
        ))}
      </ul>

      <h3>现金流记录</h3>
      <ul>
        {cashflows.map((row) => (
          <li key={row.id}>
            {row.date} - {row.amount}
            <button
              onClick={async () => {
                const amount = Number(window.prompt('修改金额', String(row.amount)))
                if (!Number.isFinite(amount)) return
                await db.cashflows.put({ ...row, amount })
                await refresh()
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
          </li>
        ))}
      </ul>

      <h3>交易记录</h3>
      <ul>
        {trades.map((row) => (
          <li key={row.id}>
            {row.date} - {row.side} {row.instrumentCode} {row.quantity} @ {row.price ?? '市价'}
            <button
              onClick={async () => {
                const quantity = Number(window.prompt('修改数量', String(row.quantity)))
                if (!Number.isFinite(quantity)) return
                await db.trades.put({ ...row, quantity })
                await refresh()
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
          </li>
        ))}
      </ul>
    </section>
  )
}
