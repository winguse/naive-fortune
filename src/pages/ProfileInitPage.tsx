import dayjs from 'dayjs'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'
import { instrumentsByMarket } from '../config/instruments'
import { createProfileWithSeed } from '../features/profiles/repository'

const formSchema = z.object({
  name: z.string().min(1, '请输入名称'),
  market: z.enum(['us', 'cn']),
  initialCash: z.number().min(0),
  initialCashDate: z.string().min(1),
})

type FormValue = z.infer<typeof formSchema>

type HoldingDraft = {
  instrumentCode: string
  quantity: string
  acquiredAt: string
}

type AllocationDraft = {
  instrumentCode: string
  targetWeight: string
}

const isValidDate = (dateText: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(dateText) && dayjs(dateText).isValid()

const isNearlyEqual = (left: number, right: number, epsilon = 0.0001) =>
  Math.abs(left - right) <= epsilon

export const ProfileInitPage = () => {
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const [holdingsDrafts, setHoldingsDrafts] = useState<HoldingDraft[]>([])
  const [allocationDrafts, setAllocationDrafts] = useState<AllocationDraft[]>(
    [],
  )

  const { register, control, handleSubmit, formState } = useForm<FormValue>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      market: 'cn',
      initialCash: 0,
      initialCashDate: dayjs().format('YYYY-MM-DD'),
    },
  })

  const market = useWatch({ control, name: 'market' })
  const instrumentList = useMemo(() => instrumentsByMarket(market), [market])
  const instrumentCodeSet = useMemo(
    () => new Set(instrumentList.map((item) => item.code)),
    [instrumentList],
  )
  const defaultInstrumentCode = instrumentList[0]?.code ?? ''

  useEffect(() => {
    setHoldingsDrafts((current) =>
      current.map((row) => ({
        ...row,
        instrumentCode: instrumentCodeSet.has(row.instrumentCode)
          ? row.instrumentCode
          : defaultInstrumentCode,
      })),
    )
    setAllocationDrafts((current) => {
      const next =
        current.length > 0
          ? current.map((row) => ({
              ...row,
              instrumentCode: instrumentCodeSet.has(row.instrumentCode)
                ? row.instrumentCode
                : defaultInstrumentCode,
            }))
          : [{ instrumentCode: defaultInstrumentCode, targetWeight: '1' }]
      return next
    })
  }, [defaultInstrumentCode, instrumentCodeSet])

  const onSubmit = handleSubmit(async (value) => {
    if (!defaultInstrumentCode) {
      setError('当前市场没有可用标的')
      return
    }

    const parsedHoldings = holdingsDrafts.map((row, index) => ({
      index,
      instrumentCode: row.instrumentCode.trim(),
      quantity: Number(row.quantity),
      acquiredAt: row.acquiredAt.trim(),
    }))

    for (const row of parsedHoldings) {
      if (!instrumentCodeSet.has(row.instrumentCode)) {
        setError(`初始持仓第 ${row.index + 1} 行标的不在当前市场可选列表`)
        return
      }
      if (!Number.isFinite(row.quantity) || row.quantity <= 0) {
        setError(`初始持仓第 ${row.index + 1} 行数量必须大于 0`)
        return
      }
      if (!isValidDate(row.acquiredAt)) {
        setError(`初始持仓第 ${row.index + 1} 行买入日期格式应为 YYYY-MM-DD`)
        return
      }
    }

    const duplicatedHoldingCode = parsedHoldings
      .map((row) => row.instrumentCode)
      .find((code, index, list) => list.indexOf(code) !== index)
    if (duplicatedHoldingCode) {
      setError(`初始持仓存在重复标的：${duplicatedHoldingCode}`)
      return
    }

    const parsedAllocations = allocationDrafts.map((row, index) => ({
      index,
      instrumentCode: row.instrumentCode.trim(),
      targetWeight: Number(row.targetWeight),
    }))

    if (parsedAllocations.length === 0) {
      setError('至少配置一个目标标的')
      return
    }

    for (const row of parsedAllocations) {
      if (!instrumentCodeSet.has(row.instrumentCode)) {
        setError(`目标比例第 ${row.index + 1} 行标的不在当前市场可选列表`)
        return
      }
      if (!Number.isFinite(row.targetWeight) || row.targetWeight <= 0) {
        setError(`目标比例第 ${row.index + 1} 行比例必须大于 0`)
        return
      }
    }

    const duplicatedAllocationCode = parsedAllocations
      .map((row) => row.instrumentCode)
      .find((code, index, list) => list.indexOf(code) !== index)
    if (duplicatedAllocationCode) {
      setError(`目标比例存在重复标的：${duplicatedAllocationCode}`)
      return
    }

    const allocationSum = parsedAllocations.reduce(
      (sum, row) => sum + row.targetWeight,
      0,
    )
    if (!isNearlyEqual(allocationSum, 1)) {
      setError('目标比例总和必须为 1（100%）')
      return
    }

    const holdings = parsedHoldings.map((row) => ({
      instrumentCode: row.instrumentCode,
      quantity: row.quantity,
      acquiredAt: row.acquiredAt,
    }))

    const allocations = parsedAllocations.map((row) => ({
      instrumentCode: row.instrumentCode,
      targetWeight: row.targetWeight,
    }))

    try {
      setError('')
      const profile = await createProfileWithSeed({
        name: value.name,
        market: value.market,
        baseCurrency: value.market === 'us' ? 'USD' : 'CNY',
        initialCash: value.initialCash,
        initialCashDate: value.initialCashDate,
        holdings,
        allocations,
      })
      navigate(`/profiles/${profile.id}`)
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : '创建失败')
    }
  })

  return (
    <section className="form-page">
      <h2>初始化 Profile</h2>
      <p className="helper">
        可选标的：{instrumentList.map((row) => row.code).join(' / ')}
      </p>
      <form onSubmit={onSubmit} className="form-grid">
        <label>
          名称
          <input {...register('name')} />
        </label>
        <label>
          市场
          <select {...register('market')}>
            <option value="cn">中国市场</option>
            <option value="us">美国市场</option>
          </select>
        </label>
        <label>
          初始现金
          <input
            type="number"
            step="0.01"
            {...register('initialCash', { valueAsNumber: true })}
          />
        </label>
        <label>
          初始现金日期
          <input type="date" {...register('initialCashDate')} />
        </label>
        <div className="detail-input-group">
          <h3>初始持仓（标的,数量,买入日期）</h3>
          {holdingsDrafts.length === 0 && (
            <p className="helper">无初始持仓，可直接提交或添加行</p>
          )}
          {holdingsDrafts.map((row, index) => (
            <div className="detail-input-row" key={`holding-${index}`}>
              <select
                value={row.instrumentCode}
                onChange={(event) => {
                  const next = [...holdingsDrafts]
                  next[index] = {
                    ...next[index],
                    instrumentCode: event.target.value,
                  }
                  setHoldingsDrafts(next)
                }}
              >
                {instrumentList.map((item) => (
                  <option value={item.code} key={item.code}>
                    {item.code}
                  </option>
                ))}
              </select>
              <input
                type="number"
                step="0.0001"
                min="0"
                placeholder="数量"
                value={row.quantity}
                onChange={(event) => {
                  const next = [...holdingsDrafts]
                  next[index] = { ...next[index], quantity: event.target.value }
                  setHoldingsDrafts(next)
                }}
              />
              <input
                type="date"
                value={row.acquiredAt}
                onChange={(event) => {
                  const next = [...holdingsDrafts]
                  next[index] = {
                    ...next[index],
                    acquiredAt: event.target.value,
                  }
                  setHoldingsDrafts(next)
                }}
              />
              <button
                type="button"
                onClick={() =>
                  setHoldingsDrafts((current) =>
                    current.filter((_, rowIndex) => rowIndex !== index),
                  )
                }
              >
                删除
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setHoldingsDrafts((current) => [
                ...current,
                {
                  instrumentCode: defaultInstrumentCode,
                  quantity: '',
                  acquiredAt: dayjs().format('YYYY-MM-DD'),
                },
              ])
            }
          >
            添加初始持仓
          </button>
        </div>

        <div className="detail-input-group">
          <h3>目标比例（标的,比例；比例总和=1）</h3>
          {allocationDrafts.map((row, index) => (
            <div
              className="detail-input-row detail-input-row--allocation"
              key={`allocation-${index}`}
            >
              <select
                value={row.instrumentCode}
                onChange={(event) => {
                  const next = [...allocationDrafts]
                  next[index] = {
                    ...next[index],
                    instrumentCode: event.target.value,
                  }
                  setAllocationDrafts(next)
                }}
              >
                {instrumentList.map((item) => (
                  <option value={item.code} key={item.code}>
                    {item.code}
                  </option>
                ))}
              </select>
              <input
                type="number"
                step="0.0001"
                min="0"
                placeholder="比例"
                value={row.targetWeight}
                onChange={(event) => {
                  const next = [...allocationDrafts]
                  next[index] = {
                    ...next[index],
                    targetWeight: event.target.value,
                  }
                  setAllocationDrafts(next)
                }}
              />
              <button
                type="button"
                onClick={() =>
                  setAllocationDrafts((current) =>
                    current.filter((_, rowIndex) => rowIndex !== index),
                  )
                }
                disabled={allocationDrafts.length <= 1}
              >
                删除
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setAllocationDrafts((current) => [
                ...current,
                {
                  instrumentCode: defaultInstrumentCode,
                  targetWeight: '',
                },
              ])
            }
          >
            添加目标比例
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        {formState.errors.name && (
          <p className="error">{formState.errors.name.message}</p>
        )}
        <button type="submit">保存并进入 Dashboard</button>
      </form>
    </section>
  )
}
