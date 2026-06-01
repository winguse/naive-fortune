import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { createDefaultBacktestConfig, createDefaultStrategyConfig } from '../config/defaults'
import { db } from '../db/database'
import { AssetAreaChart } from '../components/AssetAreaChart'
import { loadMarketDataBatch } from '../features/market-data/service'
import { runSimpleBacktest } from '../features/backtest/engine'
import { getProfileBundle } from '../features/profiles/repository'
import type { BacktestConfig, BacktestLotSizeRule } from '../types/models'

const lotRuleOptions: Array<{ value: BacktestLotSizeRule; label: string }> = [
  { value: 'fractional', label: '可买小数' },
  { value: 'integer', label: '必须整数' },
  { value: 'lot100', label: '必须 100 的倍数' },
]

const normalizeBacktestConfig = (config: BacktestConfig, instrumentCodes: string[]): BacktestConfig => {
  const currentMap = config.lotSizeRuleByInstrument ?? {}
  const normalizedMap = Object.fromEntries(
    instrumentCodes.map((code) => [code, currentMap[code] ?? 'fractional']),
  ) as Record<string, BacktestLotSizeRule>

  return {
    ...config,
    lotSizeRuleByInstrument: normalizedMap,
  }
}

export const BacktestPage = () => {
  const { profileId = '' } = useParams()
  const [bundle, setBundle] = useState<Awaited<ReturnType<typeof getProfileBundle>> | null>(null)
  const [marketData, setMarketData] = useState<Record<string, Array<{ date: string; close: number; open?: number | null }>>>({})
  const [backtestConfig, setBacktestConfig] = useState<BacktestConfig | null>(null)

  useEffect(() => {
    const run = async () => {
      const nextBundle = await getProfileBundle(profileId)
      if (!nextBundle.profile) return
      setBundle(nextBundle)
      const codes = nextBundle.targetAllocations.map((row) => row.instrumentCode)
      const loadedMarketData = await loadMarketDataBatch(codes)
      setMarketData(loadedMarketData)

      const candidateConfig = nextBundle.backtest ?? createDefaultBacktestConfig(profileId)
      const normalizedConfig = normalizeBacktestConfig(candidateConfig, codes)
      setBacktestConfig(normalizedConfig)
      await db.backtestConfigs.put(normalizedConfig)
    }

    void run()
  }, [profileId])

  const result = useMemo(() => {
    if (!bundle?.profile || !backtestConfig) return null
    const strategy = bundle.strategy ?? createDefaultStrategyConfig(profileId)
    return runSimpleBacktest({
      prices: marketData,
      config: backtestConfig,
      allocations: bundle.targetAllocations,
      strategy,
      cashflows: bundle.cashflows,
    })
  }, [bundle, backtestConfig, marketData, profileId])

  const buyRows = useMemo(
    () =>
      (result?.points ?? []).flatMap((point) =>
        point.buyExecutions.map((execution) => ({
          date: point.date,
          ...execution,
        })),
      ),
    [result],
  )

  const chartPoints = useMemo(
    () =>
      (result?.points ?? []).map((point) => ({
        date: point.date,
        series: {
          ...point.marketValueByInstrument,
          现金: point.cash,
        },
      })),
    [result],
  )

  const chartSeriesKeys = useMemo(
    () => [...new Set((result?.points ?? []).flatMap((point) => [...Object.keys(point.marketValueByInstrument), '现金']))],
    [result],
  )

  if (!bundle?.profile || !result || !backtestConfig) return <p>回测计算中...</p>

  const updateConfig = async (patch: Partial<BacktestConfig>) => {
    if (!backtestConfig) return
    const next = { ...backtestConfig, ...patch }
    setBacktestConfig(next)
    await db.backtestConfigs.put(next)
  }

  const updateLotRule = async (instrumentCode: string, rule: BacktestLotSizeRule) => {
    const nextConfig: BacktestConfig = {
      ...backtestConfig,
      lotSizeRuleByInstrument: {
        ...(backtestConfig.lotSizeRuleByInstrument ?? {}),
        [instrumentCode]: rule,
      },
    }
    setBacktestConfig(nextConfig)
    await db.backtestConfigs.put(nextConfig)
  }

  return (
    <section>
      <h2>{bundle.profile.name} 回测</h2>

      <h3>回测参数</h3>
      <div className="detail-input-group">
        <div className="detail-input-row">
          <span>开始日期</span>
          <input
            type="date"
            value={backtestConfig.startDate}
            onChange={(event) => void updateConfig({ startDate: event.target.value })}
          />
        </div>
        <div className="detail-input-row">
          <span>结束日期</span>
          <input
            type="date"
            value={backtestConfig.endDate}
            onChange={(event) => void updateConfig({ endDate: event.target.value })}
          />
        </div>
        <div className="detail-input-row">
          <span>初始现金</span>
          <input
            type="number"
            step="1000"
            value={backtestConfig.initialCash}
            onChange={(event) => void updateConfig({ initialCash: Number(event.target.value) })}
          />
        </div>
        <div className="detail-input-row">
          <span>每日定投（每交易日）</span>
          <input
            type="number"
            step="100"
            value={backtestConfig.recurringCashflows}
            onChange={(event) => void updateConfig({ recurringCashflows: Number(event.target.value) })}
          />
        </div>
        <div className="detail-input-row">
          <span>使用开盘价</span>
          <input
            type="checkbox"
            checked={backtestConfig.useOpenPrice}
            onChange={(event) => void updateConfig({ useOpenPrice: event.target.checked })}
          />
        </div>
      </div>

      <p>总投入：{result.totalInvested.toFixed(2)}</p>
      <p>期末市值：{result.finalValue.toFixed(2)}</p>
      <p>总收益率：{(result.totalReturn * 100).toFixed(2)}%</p>
      <p>年化收益率：{(result.annualizedReturn * 100).toFixed(2)}%</p>
      <p>最大回撤：{(result.maxDrawdown * 100).toFixed(2)}%</p>

      <h3>买入数量规则</h3>
      <div className="detail-input-group">
        {bundle.targetAllocations.map((allocation) => (
          <div className="detail-input-row detail-input-row--allocation" key={allocation.instrumentCode}>
            <span>{allocation.instrumentCode}</span>
            <select
              value={backtestConfig.lotSizeRuleByInstrument?.[allocation.instrumentCode] ?? 'fractional'}
              onChange={(event) => updateLotRule(allocation.instrumentCode, event.target.value as BacktestLotSizeRule)}
            >
              {lotRuleOptions.map((option) => (
                <option value={option.value} key={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <AssetAreaChart points={chartPoints} seriesKeys={chartSeriesKeys} />

      <h3>买入明细</h3>
      {buyRows.length === 0 ? (
        <p className="helper">
          当前回测区间没有发生买入。如果选择了整数/100倍手数规则，请确认「初始现金」是否足够支付一手的成本。
        </p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>日期</th>
                <th>标的</th>
                <th>数量</th>
                <th>成交价</th>
                <th>成交金额</th>
                <th>含费总成本</th>
              </tr>
            </thead>
            <tbody>
              {buyRows.map((row, index) => (
                <tr key={`${row.date}-${row.instrumentCode}-${index}`}>
                  <td>{row.date}</td>
                  <td>{row.instrumentCode}</td>
                  <td>{row.quantity.toFixed(4)}</td>
                  <td>{row.executionPrice.toFixed(4)}</td>
                  <td>{row.grossAmount.toFixed(2)}</td>
                  <td>{row.totalCost.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
