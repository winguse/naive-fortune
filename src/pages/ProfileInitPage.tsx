import dayjs from 'dayjs'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'
import { instrumentsByMarket } from '../config/instruments'
import { createProfileWithSeed } from '../features/profiles/repository'
import { isZh } from '../i18n/language'

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
  const text = isZh
    ? {
        noInstrument: '当前市场没有可用标的',
        holdingPrefix: '初始持仓第',
        allocationPrefix: '目标比例第',
        instrumentNotInList: '行标的不在当前市场可选列表',
        holdingQuantityInvalid: '行数量必须大于 0',
        dateInvalid: '行买入日期格式应为 YYYY-MM-DD',
        duplicatedHolding: '初始持仓存在重复标的：',
        needOneAllocation: '至少配置一个目标标的',
        allocationWeightInvalid: '行比例必须大于 0',
        duplicatedAllocation: '目标比例存在重复标的：',
        allocationSumInvalid: '目标比例总和必须为 1（100%）',
        createFail: '创建失败',
        title: '初始化组合',
        instrumentHint: '可选标的',
        name: '名称',
        market: '市场',
        cn: '中国市场',
        us: '美国市场',
        initialCash: '初始现金',
        initialCashDate: '初始现金日期',
        holdingsTitle: '初始持仓（标的,数量,买入日期）',
        noHoldings: '无初始持仓，可直接提交或添加行',
        quantity: '数量',
        delete: '删除',
        addHolding: '添加初始持仓',
        allocationsTitle: '目标比例（标的,比例；比例总和=1）',
        weight: '比例',
        addAllocation: '添加目标比例',
        submit: '保存并进入仪表盘',
      }
    : {
        noInstrument: 'No instrument available for this market',
        holdingPrefix: 'Initial holding row ',
        allocationPrefix: 'Target allocation row ',
        instrumentNotInList: ' instrument is not available in current market',
        holdingQuantityInvalid: ' quantity must be greater than 0',
        dateInvalid: ' acquired date must be YYYY-MM-DD',
        duplicatedHolding: 'Duplicated instrument in initial holdings: ',
        needOneAllocation: 'At least one target allocation is required',
        allocationWeightInvalid: ' weight must be greater than 0',
        duplicatedAllocation: 'Duplicated instrument in target allocations: ',
        allocationSumInvalid: 'Target allocation sum must be 1 (100%)',
        createFail: 'Create failed',
        title: 'Initialize Profile',
        instrumentHint: 'Available instruments',
        name: 'Name',
        market: 'Market',
        cn: 'China',
        us: 'United States',
        initialCash: 'Initial Cash',
        initialCashDate: 'Initial Cash Date',
        holdingsTitle: 'Initial Holdings (instrument, quantity, acquired date)',
        noHoldings: 'No initial holdings. Submit directly or add rows.',
        quantity: 'Quantity',
        delete: 'Delete',
        addHolding: 'Add Initial Holding',
        allocationsTitle: 'Target Allocation (instrument, weight; sum=1)',
        weight: 'Weight',
        addAllocation: 'Add Target Allocation',
        submit: 'Save and Enter Dashboard',
      }

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
      setError(text.noInstrument)
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
        setError(`${text.holdingPrefix}${row.index + 1}${text.instrumentNotInList}`)
        return
      }
      if (!Number.isFinite(row.quantity) || row.quantity <= 0) {
        setError(`${text.holdingPrefix}${row.index + 1}${text.holdingQuantityInvalid}`)
        return
      }
      if (!isValidDate(row.acquiredAt)) {
        setError(`${text.holdingPrefix}${row.index + 1}${text.dateInvalid}`)
        return
      }
    }

    const duplicatedHoldingCode = parsedHoldings
      .map((row) => row.instrumentCode)
      .find((code, index, list) => list.indexOf(code) !== index)
    if (duplicatedHoldingCode) {
      setError(`${text.duplicatedHolding}${duplicatedHoldingCode}`)
      return
    }

    const parsedAllocations = allocationDrafts.map((row, index) => ({
      index,
      instrumentCode: row.instrumentCode.trim(),
      targetWeight: Number(row.targetWeight),
    }))

    if (parsedAllocations.length === 0) {
      setError(text.needOneAllocation)
      return
    }

    for (const row of parsedAllocations) {
      if (!instrumentCodeSet.has(row.instrumentCode)) {
        setError(`${text.allocationPrefix}${row.index + 1}${text.instrumentNotInList}`)
        return
      }
      if (!Number.isFinite(row.targetWeight) || row.targetWeight <= 0) {
        setError(`${text.allocationPrefix}${row.index + 1}${text.allocationWeightInvalid}`)
        return
      }
    }

    const duplicatedAllocationCode = parsedAllocations
      .map((row) => row.instrumentCode)
      .find((code, index, list) => list.indexOf(code) !== index)
    if (duplicatedAllocationCode) {
      setError(`${text.duplicatedAllocation}${duplicatedAllocationCode}`)
      return
    }

    const allocationSum = parsedAllocations.reduce(
      (sum, row) => sum + row.targetWeight,
      0,
    )
    if (!isNearlyEqual(allocationSum, 1)) {
      setError(text.allocationSumInvalid)
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
      setError(createError instanceof Error ? createError.message : text.createFail)
    }
  })

  return (
    <section className="form-page">
      <h2>{text.title}</h2>
      <p className="helper">
        {text.instrumentHint}: {instrumentList.map((row) => row.code).join(' / ')}
      </p>
      <form onSubmit={onSubmit} className="form-grid">
        <label>
          {text.name}
          <input {...register('name')} />
        </label>
        <label>
          {text.market}
          <select {...register('market')}>
            <option value="cn">{text.cn}</option>
            <option value="us">{text.us}</option>
          </select>
        </label>
        <label>
          {text.initialCash}
          <input
            type="number"
            step="0.01"
            {...register('initialCash', { valueAsNumber: true })}
          />
        </label>
        <label>
          {text.initialCashDate}
          <input type="date" {...register('initialCashDate')} />
        </label>
        <div className="detail-input-group">
          <h3>{text.holdingsTitle}</h3>
          {holdingsDrafts.length === 0 && (
            <p className="helper">{text.noHoldings}</p>
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
                placeholder={text.quantity}
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
                {text.delete}
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
            {text.addHolding}
          </button>
        </div>

        <div className="detail-input-group">
          <h3>{text.allocationsTitle}</h3>
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
                placeholder={text.weight}
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
                {text.delete}
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
            {text.addAllocation}
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        {formState.errors.name && (
          <p className="error">{formState.errors.name.message}</p>
        )}
        <button type="submit">{text.submit}</button>
      </form>
    </section>
  )
}
