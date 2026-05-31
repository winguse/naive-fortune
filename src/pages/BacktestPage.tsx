import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { createDefaultBacktestConfig, createDefaultStrategyConfig } from '../config/defaults'
import { db } from '../db/database'
import { AssetAreaChart } from '../components/AssetAreaChart'
import { loadMarketDataBatch } from '../features/market-data/service'
import { runSimpleBacktest } from '../features/backtest/engine'
import { getProfileBundle } from '../features/profiles/repository'

export const BacktestPage = () => {
  const { profileId = '' } = useParams()
  const [bundle, setBundle] = useState<Awaited<ReturnType<typeof getProfileBundle>> | null>(null)
  const [result, setResult] = useState<ReturnType<typeof runSimpleBacktest> | null>(null)

  useEffect(() => {
    const run = async () => {
      const nextBundle = await getProfileBundle(profileId)
      if (!nextBundle.profile) return
      setBundle(nextBundle)
      const codes = nextBundle.targetAllocations.map((row) => row.instrumentCode)
      const marketData = await loadMarketDataBatch(codes)
      const backtestConfig = nextBundle.backtest ?? createDefaultBacktestConfig(profileId)
      const strategy = nextBundle.strategy ?? createDefaultStrategyConfig(profileId)
      const backtest = runSimpleBacktest({
        prices: marketData,
        config: backtestConfig,
        allocations: nextBundle.targetAllocations,
        strategy,
      })
      setResult(backtest)
      await db.backtestConfigs.put(backtestConfig)
    }

    void run()
  }, [profileId])

  const chartPoints = useMemo(
    () =>
      (result?.points ?? []).map((point) => ({
        date: point.date,
        series: { nav: point.nav, cash: point.cash },
      })),
    [result],
  )

  if (!bundle?.profile || !result) return <p>回测计算中...</p>

  return (
    <section>
      <h2>{bundle.profile.name} 回测</h2>
      <p>总投入：{result.totalInvested.toFixed(2)}</p>
      <p>期末市值：{result.finalValue.toFixed(2)}</p>
      <p>总收益率：{(result.totalReturn * 100).toFixed(2)}%</p>
      <p>年化收益率：{(result.annualizedReturn * 100).toFixed(2)}%</p>
      <p>最大回撤：{(result.maxDrawdown * 100).toFixed(2)}%</p>
      <AssetAreaChart points={chartPoints} seriesKeys={['nav', 'cash']} />
    </section>
  )
}
