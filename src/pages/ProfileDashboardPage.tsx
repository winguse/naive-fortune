import { useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import { Link, useParams } from 'react-router-dom'
import { INSTRUMENT_BY_CODE } from '../config/instruments'
import { AssetAreaChart } from '../components/AssetAreaChart'
import { AssetPieChart } from '../components/AssetPieChart'
import { loadMarketDataBatch } from '../features/market-data/service'
import {
  buildHistoricalAssetSeries,
  buildPortfolioSnapshot,
  buildWeightMap,
} from '../features/portfolio/calc'
import { getProfileBundle } from '../features/profiles/repository'
import { createDefaultStrategyConfig } from '../config/defaults'
import { createDrawdownAdjustedSuggestions } from '../features/strategy/drawdownDca'

type HistoryRange = '3m' | '6m' | '1y' | '3y' | 'all'

export const ProfileDashboardPage = () => {
  const { profileId = '' } = useParams()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [bundle, setBundle] = useState<Awaited<ReturnType<typeof getProfileBundle>> | null>(null)
  const [marketData, setMarketData] = useState<Record<string, Array<{ date: string; close: number; open?: number | null }>>>({})
  const [showCashInPie, setShowCashInPie] = useState(true)
  const [historyRange, setHistoryRange] = useState<HistoryRange>('1y')

  useEffect(() => {
    const run = async () => {
      setLoading(true)
      try {
        const nextBundle = await getProfileBundle(profileId)
        if (!nextBundle.profile) throw new Error('Profile 不存在')
        const codes = [...new Set(nextBundle.targetAllocations.map((row) => row.instrumentCode))]
        const loadedMarket = await loadMarketDataBatch(codes)
        setBundle(nextBundle)
        setMarketData(loadedMarket)
        setError('')
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : '加载失败')
      } finally {
        setLoading(false)
      }
    }

    void run()
  }, [profileId])

  const snapshot = useMemo(() => {
    if (!bundle) return null
    return buildPortfolioSnapshot({
      cashflows: bundle.cashflows,
      trades: bundle.trades,
      initialHoldings: bundle.initialHoldings,
      marketData,
    })
  }, [bundle, marketData])

  const weights = useMemo(() => {
    if (!bundle || !snapshot) return {}
    return buildWeightMap(snapshot, bundle.targetAllocations)
  }, [bundle, snapshot])

  const elapsedTradingDays = useMemo(() => {
    if (!bundle || !snapshot) return 1

    // Find the most recent buy trade date
    const lastBuyDate = bundle.trades
      .filter((t) => t.side === 'buy')
      .map((t) => t.date)
      .sort()
      .at(-1) ?? null

    // Reference date: last buy date, or the earliest cashflow date if no buys yet
    const referenceDate =
      lastBuyDate ??
      bundle.cashflows
        .map((c) => c.date)
        .sort()
        .at(0) ??
      null

    if (!referenceDate) return 1

    // All unique trading dates across all instruments, up to snapshot date
    const allTradingDates = [
      ...new Set(Object.values(marketData).flatMap((candles) => candles.map((c) => c.date))),
    ]
      .filter((d) => d > referenceDate && d <= snapshot.date)
      .sort()

    return Math.max(allTradingDates.length, 1)
  }, [bundle, snapshot, marketData])

  const suggestions = useMemo(() => {
    if (!bundle || !snapshot) return []
    return createDrawdownAdjustedSuggestions({
      snapshot,
      strategy: bundle.strategy ?? createDefaultStrategyConfig(bundle.profile!.id),
      allocations: bundle.targetAllocations,
      marketData,
      elapsedTradingDaysSinceLastBuy: elapsedTradingDays,
      lotSizeRuleByInstrument: bundle.backtest?.lotSizeRuleByInstrument ?? {},
    })
  }, [bundle, snapshot, marketData])

  const historyPoints = useMemo(() => {
    if (!bundle) return []
    return buildHistoricalAssetSeries({
      cashflows: bundle.cashflows,
      trades: bundle.trades,
      initialHoldings: bundle.initialHoldings,
      marketData,
    })
  }, [bundle, marketData])

  const filteredHistoryPoints = useMemo(() => {
    if (historyPoints.length === 0 || historyRange === 'all') return historyPoints

    const endDate = dayjs(historyPoints[historyPoints.length - 1].date)
    const startDate =
      historyRange === '3m'
        ? endDate.subtract(3, 'month')
        : historyRange === '6m'
          ? endDate.subtract(6, 'month')
          : historyRange === '1y'
            ? endDate.subtract(1, 'year')
            : endDate.subtract(3, 'year')

    return historyPoints.filter((point) => !dayjs(point.date).isBefore(startDate, 'day'))
  }, [historyPoints, historyRange])

  if (loading) return <p>加载中...</p>
  if (error) return <p className="error">{error}</p>
  if (!bundle?.profile || !snapshot) return <p>未找到 profile</p>

  const pieData = [
    ...Object.entries(snapshot.marketValueByInstrument).map(([code, value]) => ({
      name: code,
      value,
    })),
    ...(showCashInPie ? [{ name: '现金', value: snapshot.cash }] : []),
  ]

  const chartSeriesKeys = [
    ...new Set(
      filteredHistoryPoints.flatMap((point) => [
        ...Object.keys(point.instrumentSeries),
        'cash',
      ]),
    ),
  ]

  return (
    <section>
      <h2>{bundle.profile.name} Dashboard</h2>
      <div className="actions-row">
        <Link to={`/profiles/${bundle.profile.id}/records`}>记录管理</Link>
        <Link to={`/profiles/${bundle.profile.id}/backtest`}>回测</Link>
      </div>
      <p>最新日期：{snapshot.date}</p>
      <p>当前可投资现金：{snapshot.cash.toFixed(2)} {bundle.profile.baseCurrency}</p>
      <p>当前资产市值：{snapshot.totalMarketValue.toFixed(2)} {bundle.profile.baseCurrency}</p>

      <h3>当前持仓</h3>
      <ul>
        {Object.entries(snapshot.holdings).map(([code, quantity]) => (
          <li key={code}>
            {code}（{INSTRUMENT_BY_CODE[code]?.displayName ?? code}）：{quantity.toFixed(4)} 份，当前权重 {(weights[code] * 100 || 0).toFixed(2)}%
          </li>
        ))}
      </ul>

      <h3>目标配置</h3>
      <ul>
        {bundle.targetAllocations.map((item) => (
          <li key={item.instrumentCode}>
            {item.instrumentCode}: {(item.targetWeight * 100).toFixed(2)}%
          </li>
        ))}
      </ul>

      <h3>操作建议（drawdown-adjusted DCA）</h3>
      <p className="helper">累计未交易交易日：{elapsedTradingDays} 天，建议金额已合并</p>
      <ul>
        {suggestions.length === 0 ? <li>当前无买入建议</li> : null}
        {suggestions.map((item) => (
          <li key={item.instrumentCode}>
            {item.instrumentCode}: {item.action} {item.quantity.toFixed(4)} 份，估算金额 {item.estimatedAmount.toFixed(2)}，估价 {item.estimatedPrice.toFixed(2)}；{item.rationale}
          </li>
        ))}
      </ul>

      <h3>资产占比饼图</h3>
      <label>
        <input
          type="checkbox"
          checked={showCashInPie}
          onChange={(event) => setShowCashInPie(event.target.checked)}
        />
        饼图显示现金
      </label>
      <AssetPieChart data={pieData} />

      <h3>历史资产堆叠面积图</h3>
      <div className="actions-row">
        <label>
          时间区间
          <select value={historyRange} onChange={(event) => setHistoryRange(event.target.value as HistoryRange)}>
            <option value="3m">近3个月</option>
            <option value="6m">近6个月</option>
            <option value="1y">近1年</option>
            <option value="3y">近3年</option>
            <option value="all">全部</option>
          </select>
        </label>
      </div>
      <AssetAreaChart
        seriesKeys={chartSeriesKeys}
        points={filteredHistoryPoints.map((point) => ({
          date: point.date,
          series: {
            ...point.instrumentSeries,
            cash: point.cash,
          },
        }))}
      />
    </section>
  )
}
