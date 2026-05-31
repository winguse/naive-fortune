import dayjs from 'dayjs'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { instrumentsByMarket } from '../config/instruments'
import { createProfileWithSeed } from '../features/profiles/repository'

const formSchema = z.object({
  name: z.string().min(1, '请输入名称'),
  market: z.enum(['us', 'cn']),
  initialCash: z.number().min(0),
  initialCashDate: z.string().min(1),
  holdingsText: z.string().optional(),
  allocationsText: z.string().min(1, '至少配置一个目标标的'),
})

type FormValue = z.infer<typeof formSchema>

const parseLines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

export const ProfileInitPage = () => {
  const navigate = useNavigate()
  const [error, setError] = useState('')

  const { register, watch, handleSubmit, formState } = useForm<FormValue>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      market: 'cn',
      initialCash: 0,
      initialCashDate: dayjs().format('YYYY-MM-DD'),
      holdingsText: '',
      allocationsText: '510300,1',
    },
  })

  const market = watch('market')
  const instrumentList = useMemo(() => instrumentsByMarket(market), [market])

  const onSubmit = handleSubmit(async (value) => {
    const allocations = parseLines(value.allocationsText)
      .map((line) => {
        const [instrumentCode, targetWeight] = line.split(',').map((part) => part.trim())
        return { instrumentCode, targetWeight: Number(targetWeight) }
      })
      .filter((row) => row.instrumentCode && Number.isFinite(row.targetWeight) && row.targetWeight > 0)

    const allocationSum = allocations.reduce((sum, row) => sum + row.targetWeight, 0)
    if (Math.abs(allocationSum - 1) > 0.0001) {
      setError('目标比例总和必须为 1（100%）')
      return
    }

    const holdings = parseLines(value.holdingsText ?? '')
      .map((line) => {
        const [instrumentCode, quantity, acquiredAt] = line.split(',').map((part) => part.trim())
        return {
          instrumentCode,
          quantity: Number(quantity),
          acquiredAt: acquiredAt || dayjs().format('YYYY-MM-DD'),
        }
      })
      .filter((row) => row.instrumentCode && Number.isFinite(row.quantity) && row.quantity > 0)

    try {
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
      <p className="helper">可选标的：{instrumentList.map((row) => row.code).join(' / ')}</p>
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
          <input type="number" step="0.01" {...register('initialCash', { valueAsNumber: true })} />
        </label>
        <label>
          初始现金日期
          <input type="date" {...register('initialCashDate')} />
        </label>
        <label>
          初始持仓（每行: 标的,数量,买入日期）
          <textarea rows={4} {...register('holdingsText')} />
        </label>
        <label>
          目标比例（每行: 标的,比例；比例总和=1）
          <textarea rows={4} {...register('allocationsText')} />
        </label>
        {error && <p className="error">{error}</p>}
        {formState.errors.name && <p className="error">{formState.errors.name.message}</p>}
        <button type="submit">保存并进入 Dashboard</button>
      </form>
    </section>
  )
}
