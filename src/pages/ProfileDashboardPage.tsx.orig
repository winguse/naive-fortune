import { useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import { useParams } from 'react-router-dom'
import { INSTRUMENT_BY_CODE } from '../config/instruments'
import { DEFAULT_UI_PREFERENCE } from '../config/defaults'
import { AssetAreaChart } from '../components/AssetAreaChart'
import { AssetPieChart } from '../components/AssetPieChart'
import { db } from '../db/database'
import { loadMarketDataBatch } from '../features/market-data/service'
import {
  buildHistoricalAssetSeries,
  buildPortfolioSnapshot,
  buildWeightMap,
} from '../features/portfolio/calc'
import { getProfileBundle } from '../features/profiles/repository'
import { createDefaultStrategyConfig } from '../config/defaults'
import { createDrawdownAdjustedSuggestions } from '../features/strategy/drawdownDca'
import { appLanguage, isZh } from '../i18n/language'

type HistoryRange = '3m' | '6m' | '1y' | '3y' | 'all'

export const ProfileDashboardPage = () => {
  const { profileId = '' } = useParams()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [bundle, setBundle] = useState<Awaited<
    ReturnType<typeof getProfileBundle>
  > | null>(null)
  const [marketData, setMarketData] = useState<
    Record<string, Array<{ date: string; close: number; open?: number | null }>>
  >({})
  const [showCashInPie, setShowCashInPie] = useState(true)
  const [historyRange, setHistoryRange] = useState<HistoryRange>('1y')
  const text = isZh
    ? {
        loading: '加载中...',
        notFound: '未找到组合',
        titleSuffix: '仪表盘',
        records: '记录管理',
        backtest: '回测',
        latestDate: '最新日期',
        investableCash: '当前可投资现金',
        marketValue: '当前资产市值',
        holdings: '当前持仓',
        target: '目标配置',
        suggestion: '操作建议（回撤增强 DCA）',
        elapsedDays: '累计未交易交易日',
        suggestionMerged: '天，建议金额已合并',
        noSuggestion: '当前无买入建议',
        actionBuy: '买入',
        actionHold: '观望',
        quantityUnit: '份',
        estimatedAmount: '估算金额',
        estimatedPrice: '估价',
        strategyDetailTitle: '策略说明与计算方法（点击展开）',
        strategyDetailLine1:
          '1) 对每个标的计算回撤：drawdown = 1 - 当前价 / 历史滚动峰值。',
        strategyDetailLine2:
          '2) 用标的级最大回撤阈值归一化：ddRatio = clamp(drawdown / maxDrawdownRef, 0, 1.5)。',
        strategyDetailLine3:
          '3) 计算倍率：multiplier 在 [buyScaleMin, buyScaleMax] 内按 ddRatio 线性插值。',
        strategyDetailLine4:
          '4) 预算：investBudget = 可用现金 * baseDailyInvestRate * multiplier * 累计未交易天数；baseDailyInvestRate 表示“每个交易日理论投入现金比例”，例如 1/252 约等于按一年交易日均匀摊分。',
        strategyDetailLine5:
          '5) 按目标权重缺口分配预算，执行手数规则（可小数/整数/100倍手）。',
        strategyDetailLine6:
          '6) 若整数/100倍手导致未成交，预算继续累计到后续交易日。',
        strategyDetailLine7:
          '说明：expectedAnnualReturnRef 当前用于策略展示与参数管理，后续可扩展到更复杂仓位模型。',
        strategyDetailLine8:
          'baseDailyInvestRate 策略支持三种：fixed_1_252（固定 1/252）、naive（年化/252/(最大回撤-可接受回撤)）、kelly_variant（Kelly=μ/σ²，σ 为最近 N 日对数收益率波动率，r=Kelly×K/252，K 默认 0.25）。',
        pie: '资产占比饼图',
        showCashInPie: '饼图显示现金',
        history: '历史资产堆叠面积图',
        range: '时间区间',
        m3: '近3个月',
        m6: '近6个月',
        y1: '近1年',
        y3: '近3年',
        all: '全部',
      }
    : {
        loading: 'Loading...',
        notFound: 'Profile not found',
        titleSuffix: 'Dashboard',
        records: 'Records',
        backtest: 'Backtest',
        latestDate: 'Latest Date',
        investableCash: 'Investable Cash',
        marketValue: 'Portfolio Market Value',
        holdings: 'Current Holdings',
        target: 'Target Allocation',
        suggestion: 'Suggestions (drawdown-adjusted DCA)',
        elapsedDays: 'Accumulated idle trading days',
        suggestionMerged: 'days, budgets merged',
        noSuggestion: 'No buy suggestion right now',
        actionBuy: 'buy',
        actionHold: 'hold',
        quantityUnit: 'shares',
        estimatedAmount: 'estimated amount',
        estimatedPrice: 'estimated price',
        strategyDetailTitle: 'Strategy Description and Calculation (expand)',
        strategyDetailLine1:
          '1) For each instrument: drawdown = 1 - currentPrice / rollingPeak.',
        strategyDetailLine2:
          '2) Normalize using instrument max-drawdown reference: ddRatio = clamp(drawdown / maxDrawdownRef, 0, 1.5).',
        strategyDetailLine3:
          '3) Multiplier is linearly interpolated in [buyScaleMin, buyScaleMax] by ddRatio.',
        strategyDetailLine4:
          '4) Budget: investBudget = investableCash * baseDailyInvestRate * multiplier * idleTradingDays; baseDailyInvestRate is the theoretical cash deployment ratio per trading day (for example, 1/252 spreads deployment over one trading year).',
        strategyDetailLine5:
          '5) Budget share follows target-weight gap, then lot rules are applied (fractional/integer/100-lot).',
        strategyDetailLine6:
          '6) If lot rules block execution, remaining budget is carried forward to future trading days.',
        strategyDetailLine7:
          'Note: expectedAnnualReturnRef is currently used for parameterization and rationale display, and can be extended later.',
        strategyDetailLine8:
          'baseDailyInvestRate supports three modes: fixed_1_252 (fixed 1/252), naive (annualized/252/(maxDrawdown-acceptedDrawdown)), and kelly_variant (Kelly=μ/σ² with σ from trailing N-day log-return volatility, then r=Kelly×K/252 with K defaulting to 0.25).',
        pie: 'Allocation Pie Chart',
        showCashInPie: 'Show cash in pie chart',
        history: 'Historical Asset Stacked Area',
        range: 'Range',
        m3: '3M',
        m6: '6M',
        y1: '1Y',
        y3: '3Y',
        all: 'All',
      }

  useEffect(() => {
    const run = async () => {
      setLoading(true)
      try {
        const nextBundle = await getProfileBundle(profileId)
        if (!nextBundle.profile)
          throw new Error(isZh ? '组合不存在' : 'Profile not found')
        const pref =
          (await db.uiPreferences.get('default')) ?? DEFAULT_UI_PREFERENCE
        const codes = [
          ...new Set(
            nextBundle.targetAllocations.map((row) => row.instrumentCode),
          ),
        ]
        const loadedMarket = await loadMarketDataBatch(codes)
        if (!nextBundle.strategy) {
          await db.strategyConfigs.put(
            createDefaultStrategyConfig(nextBundle.profile.id, {
              expectedAnnualReturn: pref.globalExpectedAnnualReturn,
              maxDrawdown: pref.globalMaxDrawdown,
            }),
          )
        }
        setBundle(nextBundle)
        setMarketData(loadedMarket)
        setError('')
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : isZh
              ? '加载失败'
              : 'Load failed',
        )
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
    const lastBuyDate =
      bundle.trades
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
      ...new Set(
        Object.values(marketData).flatMap((candles) =>
          candles.map((c) => c.date),
        ),
      ),
    ]
      .filter((d) => d > referenceDate && d <= snapshot.date)
      .sort()

    return Math.max(allTradingDates.length, 1)
  }, [bundle, snapshot, marketData])

  const suggestions = useMemo(() => {
    if (!bundle || !snapshot) return []
    return createDrawdownAdjustedSuggestions({
      snapshot,
      strategy:
        bundle.strategy ??
        createDefaultStrategyConfig(bundle.profile!.id, {
          expectedAnnualReturn:
            DEFAULT_UI_PREFERENCE.globalExpectedAnnualReturn,
          maxDrawdown: DEFAULT_UI_PREFERENCE.globalMaxDrawdown,
        }),
      allocations: bundle.targetAllocations,
      marketData,
      cashflows: bundle.cashflows,
      elapsedTradingDaysSinceLastBuy: elapsedTradingDays,
      lotSizeRuleByInstrument: bundle.backtest?.lotSizeRuleByInstrument ?? {},
      language: appLanguage,
    })
  }, [bundle, snapshot, marketData, elapsedTradingDays])

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
    if (historyPoints.length === 0 || historyRange === 'all')
      return historyPoints

    const endDate = dayjs(historyPoints[historyPoints.length - 1].date)
    const startDate =
      historyRange === '3m'
        ? endDate.subtract(3, 'month')
        : historyRange === '6m'
          ? endDate.subtract(6, 'month')
          : historyRange === '1y'
            ? endDate.subtract(1, 'year')
            : endDate.subtract(3, 'year')

    return historyPoints.filter(
      (point) => !dayjs(point.date).isBefore(startDate, 'day'),
    )
  }, [historyPoints, historyRange])

  if (loading) return <p>{text.loading}</p>
  if (error) return <p className="error">{error}</p>
  if (!bundle?.profile || !snapshot) return <p>{text.notFound}</p>

  const pieData = [
    ...Object.entries(snapshot.marketValueByInstrument).map(
      ([code, value]) => ({
        name: code,
        value,
      }),
    ),
    ...(showCashInPie
      ? [{ name: isZh ? '现金' : 'Cash', value: snapshot.cash }]
      : []),
  ]

  const chartSeriesKeys = [
    ...new Set(
      filteredHistoryPoints.flatMap((point) => [
        ...Object.keys(point.instrumentSeries),
        'cash',
      ]),
    ),
  ]

  const actionLabel = (action: 'buy' | 'sell' | 'hold') => {
    if (!isZh) return action
    if (action === 'buy') return text.actionBuy
    if (action === 'hold') return text.actionHold
    return '卖出'
  }

  return (
    <section>
      <h2>
        {bundle.profile.name} {text.titleSuffix}
      </h2>
      <p>
        {text.latestDate}: {snapshot.date}
      </p>
      <p>
        {text.investableCash}: {snapshot.cash.toFixed(2)}{' '}
        {bundle.profile.baseCurrency}
      </p>
      <p>
        {text.marketValue}: {snapshot.totalMarketValue.toFixed(2)}{' '}
        {bundle.profile.baseCurrency}
      </p>

      <h3>{text.holdings}</h3>
      <ul>
        {Object.entries(snapshot.holdings).map(([code, quantity]) => (
          <li key={code}>
            {isZh
              ? `${code}（${INSTRUMENT_BY_CODE[code]?.displayName ?? code}）：${quantity.toFixed(4)} 份，当前权重 ${(
                  (weights[code] ?? 0) * 100
                ).toFixed(2)}%`
              : `${code} (${INSTRUMENT_BY_CODE[code]?.displayName ?? code}): ${quantity.toFixed(4)} shares, current weight ${(
                  (weights[code] ?? 0) * 100
                ).toFixed(2)}%`}
          </li>
        ))}
      </ul>

      <h3>{text.target}</h3>
      <ul>
        {bundle.targetAllocations.map((item) => (
          <li key={item.instrumentCode}>
            {item.instrumentCode}: {(item.targetWeight * 100).toFixed(2)}%
          </li>
        ))}
      </ul>

      <h3>{text.suggestion}</h3>
      <p className="helper">
        {text.elapsedDays}: {elapsedTradingDays} {text.suggestionMerged}
      </p>
      <ul>
        {suggestions.length === 0 ? <li>{text.noSuggestion}</li> : null}
        {suggestions.map((item) => (
          <li key={item.instrumentCode}>
            {item.instrumentCode}: {actionLabel(item.action)}{' '}
            {item.quantity.toFixed(4)} {text.quantityUnit},{' '}
            {text.estimatedAmount} {item.estimatedAmount.toFixed(2)},{' '}
            {text.estimatedPrice} {item.estimatedPrice.toFixed(2)};{' '}
            {item.rationale}
          </li>
        ))}
      </ul>

      <details>
        <summary>{text.strategyDetailTitle}</summary>
        <p>{text.strategyDetailLine1}</p>
        <p>{text.strategyDetailLine2}</p>
        <p>{text.strategyDetailLine3}</p>
        <p>{text.strategyDetailLine4}</p>
        <p>{text.strategyDetailLine5}</p>
        <p>{text.strategyDetailLine6}</p>
        <p>{text.strategyDetailLine7}</p>
        <p>{text.strategyDetailLine8}</p>
      </details>

      <h3>{text.pie}</h3>
      <label>
        <input
          type="checkbox"
          checked={showCashInPie}
          onChange={(event) => setShowCashInPie(event.target.checked)}
        />
        {text.showCashInPie}
      </label>
      <AssetPieChart data={pieData} />

      <h3>{text.history}</h3>
      <div className="actions-row">
        <label>
          {text.range}
          <select
            value={historyRange}
            onChange={(event) =>
              setHistoryRange(event.target.value as HistoryRange)
            }
          >
            <option value="3m">{text.m3}</option>
            <option value="6m">{text.m6}</option>
            <option value="1y">{text.y1}</option>
            <option value="3y">{text.y3}</option>
            <option value="all">{text.all}</option>
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
