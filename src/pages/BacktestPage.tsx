import dayjs from 'dayjs'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import * as echarts from 'echarts'
import { useParams } from 'react-router-dom'
import {
  createDefaultBacktestConfig,
  createDefaultStrategyConfig,
} from '../config/defaults'
import { db } from '../db/database'
import { AssetAreaChart } from '../components/AssetAreaChart'
import { loadMarketDataBatch } from '../features/market-data/service'
import { runSimpleBacktest } from '../features/backtest/engine'
import { getProfileBundle } from '../features/profiles/repository'
import { isZh } from '../i18n/language'
import type { BacktestConfig } from '../types/models'

type AxisPointerEvent = {
  axesInfo?: Array<{ axisDim?: string; value?: string | number }>
}

export const BacktestPage = () => {
  const { profileId = '' } = useParams()
  const [bundle, setBundle] = useState<Awaited<
    ReturnType<typeof getProfileBundle>
  > | null>(null)
  const [marketData, setMarketData] = useState<
    Record<string, Array<{ date: string; close: number; open?: number | null }>>
  >({})
  const [backtestConfig, setBacktestConfig] = useState<BacktestConfig | null>(
    null,
  )
  const [buyTrendAggregation, setBuyTrendAggregation] = useState<
    'week' | 'month'
  >('week')
  const dailyChartRefs = useRef<
    Record<string, { chart: echarts.ECharts; categories: string[] }>
  >({})
  const aggregateChartRef = useRef<echarts.ECharts | null>(null)
  const syncingAxisPointerRef = useRef(false)
  const text = isZh
    ? {
        loading: '回测计算中...',
        titleSuffix: '回测',
        params: '回测参数',
        startDate: '开始日期',
        endDate: '结束日期',
        useOpenPrice: '使用开盘价',
        totalInvested: '总投入',
        finalValue: '期末市值',
        totalReturn: '总收益率',
        annualizedReturn: '年化收益率',
        maxDrawdown: '最大回撤',
        buyDetails: '每日计算明细',
        noBuyRows:
          '当前回测区间没有可计算的买入明细。请检查策略参数、目标配置与行情数据。',
        thDate: '日期',
        thInstrument: '标的',
        thQuantity: '数量',
        thPrice: '成交价',
        thAmount: '计划预算',
        thTotalCost: '含费总成本',
        thPlannedPct: '计划买入占现金',
        thCashAfter: '成交后现金',
        thClosingMarketValue: '收盘市值',
        thSigma: 'σ（日对数收益波动率）',
        thR: 'r（原始 / 使用）',
        thMultiplier: '回撤倍率',
        thStatus: '状态',
        statusBought: '已买入',
        statusNoBudget: '无预算',
        statusZeroQuantity: '数量为 0',
        statusInsufficientCash: '现金不足',
        closePriceTrendTitle: '标的收盘价走势',
        buyTrendTitle: '计划买入趋势（金额与占现金比例）',
        buyTrendAggregateTitle: '计划买入趋势（周期汇总）',
        aggregateBy: '汇总周期',
        aggregateWeek: '按周',
        aggregateMonth: '按月',
        yAmount: '投资金额',
        yPct: '金额占现金%',
        yClosePrice: '收盘价',
        cash: '现金',
      }
    : {
        loading: 'Running backtest...',
        titleSuffix: 'Backtest',
        params: 'Backtest Parameters',
        startDate: 'Start Date',
        endDate: 'End Date',
        useOpenPrice: 'Use Open Price',
        totalInvested: 'Total Invested',
        finalValue: 'Ending Value',
        totalReturn: 'Total Return',
        annualizedReturn: 'Annualized Return',
        maxDrawdown: 'Max Drawdown',
        buyDetails: 'Daily Calculation Details',
        noBuyRows:
          'No calculable buy rows in this range. Check strategy parameters, target allocations, and market data.',
        thDate: 'Date',
        thInstrument: 'Instrument',
        thQuantity: 'Quantity',
        thPrice: 'Price',
        thAmount: 'Planned Budget',
        thTotalCost: 'Total Cost (with fees)',
        thPlannedPct: 'Planned Buy / Cash',
        thCashAfter: 'Cash After Trade',
        thClosingMarketValue: 'Closing Market Value',
        thSigma: 'σ (Daily Log-Return Vol.)',
        thR: 'r (Raw / Used)',
        thMultiplier: 'Drawdown Multiplier',
        thStatus: 'Status',
        statusBought: 'Bought',
        statusNoBudget: 'No Budget',
        statusZeroQuantity: 'Zero Quantity',
        statusInsufficientCash: 'Insufficient Cash',
        closePriceTrendTitle: 'Security Closing Price Trend',
        buyTrendTitle: 'Planned Buy Trend (Amount and % of Cash)',
        buyTrendAggregateTitle: 'Planned Buy Trend (Period Total)',
        aggregateBy: 'Aggregate by',
        aggregateWeek: 'Week',
        aggregateMonth: 'Month',
        yAmount: 'Investment Amount',
        yPct: '% of Cash',
        yClosePrice: 'Close Price',
        cash: 'Cash',
      }

  useEffect(() => {
    const run = async () => {
      const nextBundle = await getProfileBundle(profileId)
      if (!nextBundle.profile) return
      setBundle(nextBundle)

      const codes = nextBundle.targetAllocations.map(
        (row) => row.instrumentCode,
      )
      const loadedMarketData = await loadMarketDataBatch(codes)
      setMarketData(loadedMarketData)

      const oldestRecordedDate = [
        ...nextBundle.cashflows.map((row) => row.date),
        ...nextBundle.trades.map((row) => row.date),
        ...nextBundle.initialHoldings.map((row) => row.acquiredAt),
      ]
        .sort()
        .at(0)

      const candidateConfig =
        nextBundle.backtest ??
        createDefaultBacktestConfig(profileId, {
          startDate:
            oldestRecordedDate ??
            dayjs().subtract(1, 'year').format('YYYY-MM-DD'),
          endDate: dayjs().format('YYYY-MM-DD'),
        })
      setBacktestConfig(candidateConfig)
      await db.backtestConfigs.put(candidateConfig)
    }

    void run()
  }, [profileId])

  const strategy = useMemo(
    () =>
      bundle?.profile
        ? (bundle.strategy ?? createDefaultStrategyConfig(profileId))
        : null,
    [bundle, profileId],
  )

  const isKellyStrategy = strategy?.baseDailyInvestRateMode === 'kelly_variant'

  const result = useMemo(() => {
    if (!bundle?.profile || !backtestConfig || !strategy) return null
    return runSimpleBacktest({
      prices: marketData,
      config: backtestConfig,
      allocations: bundle.targetAllocations,
      strategy,
      cashflows: bundle.cashflows,
    })
  }, [bundle, backtestConfig, marketData, strategy])

  const calculationRows = useMemo(
    () =>
      (result?.points ?? []).flatMap((point) =>
        point.calculationDetails.map((detail) => ({
          date: point.date,
          closingMarketValue:
            point.marketValueByInstrument[detail.instrumentCode] ?? 0,
          ...detail,
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
          [text.cash]: point.cash,
        },
      })),
    [result, text.cash],
  )

  const chartSeriesKeys = useMemo(
    () => [
      ...new Set(
        (result?.points ?? []).flatMap((point) => [
          ...Object.keys(point.marketValueByInstrument),
          text.cash,
        ]),
      ),
    ],
    [result, text.cash],
  )

  const priceSeriesCodes = useMemo(
    () => [
      ...new Set(
        bundle?.targetAllocations.map((row) => row.instrumentCode) ?? [],
      ),
    ],
    [bundle],
  )

  const closePriceDates = useMemo(
    () =>
      [
        ...new Set(
          priceSeriesCodes.flatMap((code) =>
            (marketData[code] ?? [])
              .filter(
                (row) =>
                  backtestConfig != null &&
                  row.date >= backtestConfig.startDate &&
                  row.date <= backtestConfig.endDate,
              )
              .map((row) => row.date),
          ),
        ),
      ].sort(),
    [backtestConfig, marketData, priceSeriesCodes],
  )

  const closePriceSeries = useMemo(
    () =>
      priceSeriesCodes.map((code) => {
        const priceByDate = new Map(
          (marketData[code] ?? []).map((row) => [row.date, row.close]),
        )
        return {
          name: code,
          type: 'line',
          smooth: true,
          connectNulls: true,
          showSymbol: false,
          data: closePriceDates.map((date) => {
            const price = priceByDate.get(date)
            return price == null ? null : Number(price.toFixed(4))
          }),
        }
      }),
    [closePriceDates, marketData, priceSeriesCodes],
  )

  const statusLabel = (
    status: 'bought' | 'no_budget' | 'zero_quantity' | 'insufficient_cash',
  ) => {
    if (status === 'bought') return text.statusBought
    if (status === 'no_budget') return text.statusNoBudget
    if (status === 'zero_quantity') return text.statusZeroQuantity
    return text.statusInsufficientCash
  }

  const buyTrend = useMemo(
    () =>
      (result?.points ?? []).map((point) => {
        const boughtRows = point.calculationDetails.filter(
          (row) => row.status === 'bought' && row.quantity > 0,
        )
        const tradableCash = boughtRows[0]?.cashBeforeBuy ?? 0
        if (boughtRows.length === 0 || tradableCash <= 0) {
          return {
            date: point.date,
            amount: null,
            pct: null,
          }
        }

        const amount = Math.min(
          tradableCash,
          boughtRows.reduce((sum, row) => sum + row.totalCost, 0),
        )
        const pct = amount / tradableCash
        return {
          date: point.date,
          amount,
          pct,
        }
      }),
    [result],
  )

  const getWeekStartDate = useCallback((date: string) => {
    const value = dayjs(date)
    const day = value.day()
    return value.subtract(day === 0 ? 6 : day - 1, 'day').format('YYYY-MM-DD')
  }, [])

  const getAggregatePeriod = useCallback(
    (date: string) =>
      buyTrendAggregation === 'month'
        ? dayjs(date).startOf('month').format('YYYY-MM-DD')
        : getWeekStartDate(date),
    [buyTrendAggregation, getWeekStartDate],
  )

  const aggregatedBuyTrend = useMemo(() => {
    const amountByPeriod = new Map<string, number>()
    for (const row of buyTrend) {
      if (row.amount == null || row.amount <= 0) continue
      const period = getAggregatePeriod(row.date)
      amountByPeriod.set(period, (amountByPeriod.get(period) ?? 0) + row.amount)
    }

    const dates = (result?.points ?? []).map((point) => point.date).sort()
    const firstDate = dates.at(0)
    const lastDate = dates.at(-1)
    if (!firstDate || !lastDate) return []

    const periods: string[] = []
    if (buyTrendAggregation === 'month') {
      let cursor = dayjs(firstDate).startOf('month')
      const end = dayjs(lastDate).startOf('month')
      while (cursor.isBefore(end) || cursor.isSame(end)) {
        periods.push(cursor.format('YYYY-MM-DD'))
        cursor = cursor.add(1, 'month')
      }
    } else {
      let cursor = dayjs(getWeekStartDate(firstDate))
      const end = dayjs(getWeekStartDate(lastDate))
      while (cursor.isBefore(end) || cursor.isSame(end)) {
        periods.push(cursor.format('YYYY-MM-DD'))
        cursor = cursor.add(1, 'week')
      }
    }

    return periods.map((period) => ({
      period,
      amount: amountByPeriod.get(period) ?? 0,
    }))
  }, [
    buyTrend,
    buyTrendAggregation,
    getAggregatePeriod,
    getWeekStartDate,
    result,
  ])

  const dailyDateToIndex = useMemo(
    () =>
      new Map(
        (result?.points ?? []).map((point, index) => [point.date, index]),
      ),
    [result],
  )

  const areaCats = useMemo(
    () => chartPoints.map((point) => point.date),
    [chartPoints],
  )
  const priceCats = closePriceDates
  const buyCats = useMemo(() => buyTrend.map((row) => row.date), [buyTrend])

  const aggregatePeriodToIndex = useMemo(
    () => new Map(aggregatedBuyTrend.map((row, index) => [row.period, index])),
    [aggregatedBuyTrend],
  )

  const aggregatePeriodToDailyDate = useMemo(() => {
    const dateByPeriod = new Map<string, string>()
    for (const row of aggregatedBuyTrend) {
      dateByPeriod.set(row.period, row.period)
    }
    for (const point of result?.points ?? []) {
      const period = getAggregatePeriod(point.date)
      if (!dailyDateToIndex.has(dateByPeriod.get(period) ?? '')) {
        dateByPeriod.set(period, point.date)
      }
    }
    return dateByPeriod
  }, [aggregatedBuyTrend, dailyDateToIndex, getAggregatePeriod, result])

  const chartSyncGroup = `backtest-${profileId}`

  const getAxisPointerValue = useCallback(
    (event: AxisPointerEvent, categories: string[]) => {
      const axisInfo =
        event.axesInfo?.find((info) => info.axisDim === 'x') ??
        event.axesInfo?.[0]
      const value = axisInfo?.value
      if (value == null) return null
      return typeof value === 'number' ? (categories[value] ?? null) : value
    },
    [],
  )

  const syncAggregateFromDaily = useCallback(
    (date: string) => {
      const aggregateChart = aggregateChartRef.current
      if (!aggregateChart || syncingAxisPointerRef.current) return
      const period = getAggregatePeriod(date)
      const dataIndex = aggregatePeriodToIndex.get(period)
      if (dataIndex == null) return

      syncingAxisPointerRef.current = true
      aggregateChart.dispatchAction({
        type: 'updateAxisPointer',
        xAxisIndex: 0,
        value: period,
      })
      aggregateChart.dispatchAction({
        type: 'showTip',
        xAxisIndex: 0,
        seriesIndex: 0,
        dataIndex,
      })
      window.setTimeout(() => {
        syncingAxisPointerRef.current = false
      }, 0)
    },
    [aggregatePeriodToIndex, getAggregatePeriod],
  )

  const syncDailyFromAggregate = useCallback(
    (period: string) => {
      if (syncingAxisPointerRef.current) return
      const date = aggregatePeriodToDailyDate.get(period)
      if (!date) return
      const dataIndex = dailyDateToIndex.get(date)
      if (dataIndex == null) return

      syncingAxisPointerRef.current = true
      for (const item of Object.values(dailyChartRefs.current)) {
        const itemDataIndex = item.categories.indexOf(date)
        item.chart.dispatchAction({
          type: 'updateAxisPointer',
          xAxisIndex: 0,
          value: date,
        })
        if (itemDataIndex >= 0) {
          item.chart.dispatchAction({
            type: 'showTip',
            seriesIndex: 0,
            dataIndex: itemDataIndex,
          })
        }
      }
      window.setTimeout(() => {
        syncingAxisPointerRef.current = false
      }, 0)
    },
    [aggregatePeriodToDailyDate, dailyDateToIndex],
  )

  const bindDailyChart = useCallback(
    (name: string, chart: echarts.ECharts, categories: string[]) => {
      chart.group = chartSyncGroup
      echarts.connect(chartSyncGroup)
      dailyChartRefs.current[name] = { chart, categories }

      const handleAxisPointer = (event: unknown) => {
        const value = getAxisPointerValue(event as AxisPointerEvent, categories)
        if (!value) return
        syncAggregateFromDaily(value)
      }
      chart.off('updateAxisPointer')
      chart.on('updateAxisPointer', handleAxisPointer)
    },
    [chartSyncGroup, getAxisPointerValue, syncAggregateFromDaily],
  )

  const bindAggregateChart = useCallback(
    (chart: echarts.ECharts) => {
      aggregateChartRef.current = chart
      const categories = aggregatedBuyTrend.map((row) => row.period)
      const handleAxisPointer = (event: unknown) => {
        const value = getAxisPointerValue(event as AxisPointerEvent, categories)
        if (!value) return
        syncDailyFromAggregate(value)
      }
      chart.off('updateAxisPointer')
      chart.on('updateAxisPointer', handleAxisPointer)
    },
    [aggregatedBuyTrend, getAxisPointerValue, syncDailyFromAggregate],
  )

  useEffect(() => {
    // Re-bind daily charts when logic or categories change to avoid stale closures
    for (const [name, item] of Object.entries(dailyChartRefs.current)) {
      let cats = areaCats
      if (name === 'price') cats = priceCats
      if (name === 'buy') cats = buyCats
      bindDailyChart(name, item.chart, cats)
    }
  }, [areaCats, priceCats, buyCats, bindDailyChart])

  useEffect(() => {
    if (aggregateChartRef.current) bindAggregateChart(aggregateChartRef.current)
  }, [bindAggregateChart])

  if (!bundle?.profile || !result || !backtestConfig)
    return <p>{text.loading}</p>

  const updateConfig = async (patch: Partial<BacktestConfig>) => {
    if (!backtestConfig) return
    const next = { ...backtestConfig, ...patch }
    setBacktestConfig(next)
    await db.backtestConfigs.put(next)
  }

  return (
    <section>
      <h2>
        {bundle.profile.name} {text.titleSuffix}
      </h2>

      <h3>{text.params}</h3>
      <div className="detail-input-group">
        <div className="detail-input-row">
          <span>{text.startDate}</span>
          <input
            type="date"
            value={backtestConfig.startDate}
            onChange={(event) =>
              void updateConfig({ startDate: event.target.value })
            }
          />
        </div>
        <div className="detail-input-row">
          <span>{text.endDate}</span>
          <input
            type="date"
            value={backtestConfig.endDate}
            onChange={(event) =>
              void updateConfig({ endDate: event.target.value })
            }
          />
        </div>
        <div className="detail-input-row">
          <span>{text.useOpenPrice}</span>
          <input
            type="checkbox"
            checked={backtestConfig.useOpenPrice}
            onChange={(event) =>
              void updateConfig({ useOpenPrice: event.target.checked })
            }
          />
        </div>
      </div>

      <p>
        {text.totalInvested}: {result.totalInvested.toFixed(2)}
      </p>
      <p>
        {text.finalValue}: {result.finalValue.toFixed(2)}
      </p>
      <p>
        {text.totalReturn}: {(result.totalReturn * 100).toFixed(2)}%
      </p>
      <p>
        {text.annualizedReturn}: {(result.annualizedReturn * 100).toFixed(2)}%
      </p>
      <p>
        {text.maxDrawdown}: {(result.maxDrawdown * 100).toFixed(2)}%
      </p>

      <AssetAreaChart
        points={chartPoints}
        seriesKeys={chartSeriesKeys}
        group={chartSyncGroup}
        onChartReady={(chart) => bindDailyChart('area', chart, areaCats)}
      />

      <h3>{text.closePriceTrendTitle}</h3>
      <ReactECharts
        style={{ height: 340, width: '100%' }}
        onChartReady={(chart) => bindDailyChart('price', chart, priceCats)}
        option={{
          tooltip: { trigger: 'axis' },
          axisPointer: { link: [{ xAxisIndex: 'all' }] },
          legend: { type: 'scroll', data: priceSeriesCodes },
          xAxis: {
            type: 'category',
            data: closePriceDates,
          },
          yAxis: {
            type: 'value',
            name: text.yClosePrice,
            min: 0,
          },
          series: closePriceSeries,
        }}
      />

      <h3>{text.buyTrendTitle}</h3>
      <ReactECharts
        style={{ height: 340, width: '100%' }}
        onChartReady={(chart) => bindDailyChart('buy', chart, buyCats)}
        option={{
          tooltip: { trigger: 'axis' },
          axisPointer: { link: [{ xAxisIndex: 'all' }] },
          legend: { type: 'scroll', data: [text.yAmount, text.yPct] },
          xAxis: {
            type: 'category',
            data: buyTrend.map((row) => row.date),
          },
          yAxis: [
            {
              type: 'value',
              name: text.yAmount,
              min: 0,
            },
            {
              type: 'value',
              name: text.yPct,
              min: 0,
              axisLabel: {
                formatter: (value: number) => `${value.toFixed(2)}%`,
              },
            },
          ],
          series: [
            {
              name: text.yAmount,
              type: 'line',
              yAxisIndex: 0,
              smooth: true,
              connectNulls: true,
              showSymbol: true,
              showAllSymbol: true,
              symbol: 'circle',
              symbolSize: 5,
              data: buyTrend.map((row) =>
                row.amount == null ? null : Number(row.amount.toFixed(2)),
              ),
            },
            {
              name: text.yPct,
              type: 'line',
              yAxisIndex: 1,
              smooth: true,
              connectNulls: true,
              showSymbol: true,
              showAllSymbol: true,
              symbol: 'circle',
              symbolSize: 5,
              data: buyTrend.map((row) =>
                row.pct == null ? null : Number((row.pct * 100).toFixed(4)),
              ),
            },
          ],
        }}
      />

      <h3>{text.buyTrendAggregateTitle}</h3>
      <div className="actions-row">
        <label>
          {text.aggregateBy}
          <select
            value={buyTrendAggregation}
            onChange={(event) =>
              setBuyTrendAggregation(event.target.value as 'week' | 'month')
            }
          >
            <option value="week">{text.aggregateWeek}</option>
            <option value="month">{text.aggregateMonth}</option>
          </select>
        </label>
      </div>
      <ReactECharts
        style={{ height: 300, width: '100%' }}
        onChartReady={bindAggregateChart}
        option={{
          axisPointer: {
            show: true,
            type: 'line',
            lineStyle: { type: 'dashed' },
          },
          tooltip: {
            trigger: 'axis',
            alwaysShowContent: true,
            axisPointer: {
              type: 'line',
              axis: 'x',
              lineStyle: { type: 'dashed' },
            },
          },
          legend: { data: [text.yAmount] },
          xAxis: {
            type: 'category',
            data: aggregatedBuyTrend.map((row) => row.period),
            axisPointer: {
              show: true,
              type: 'line',
              lineStyle: { type: 'dashed' },
            },
          },
          yAxis: {
            type: 'value',
            name: text.yAmount,
            min: 0,
            axisPointer: { show: false },
          },
          series: [
            {
              name: text.yAmount,
              type: 'bar',
              barMaxWidth: 36,
              data: aggregatedBuyTrend.map((row) =>
                Number(row.amount.toFixed(2)),
              ),
            },
          ],
        }}
      />

      <h3>{text.buyDetails}</h3>
      {calculationRows.length === 0 ? (
        <p className="helper">{text.noBuyRows}</p>
      ) : (
        <div className="table-wrap table-wrap--full">
          <table className="data-table data-table--buy-details">
            <thead>
              <tr>
                <th>{text.thDate}</th>
                <th>{text.thInstrument}</th>
                <th>{text.thPrice}</th>
                {isKellyStrategy ? <th>{text.thSigma}</th> : null}
                <th>{text.thR}</th>
                <th>{text.thMultiplier}</th>
                <th>{text.thAmount}</th>
                <th>{text.thPlannedPct}</th>
                <th>{text.thQuantity}</th>
                <th>{text.thTotalCost}</th>
                <th>{text.thCashAfter}</th>
                <th>{text.thClosingMarketValue}</th>
                <th>{text.thStatus}</th>
              </tr>
            </thead>
            <tbody>
              {calculationRows.map((row, index) => (
                <tr
                  className="data-table-row"
                  key={`${row.date}-${row.instrumentCode}-${index}`}
                >
                  <td>{row.date}</td>
                  <td>{row.instrumentCode}</td>
                  <td>{row.executionPrice.toFixed(4)}</td>
                  {isKellyStrategy ? (
                    <td>
                      {row.trailingVolatility == null
                        ? '-'
                        : `${(row.trailingVolatility * 100).toFixed(4)}% / ${row.volatilityLookbackDays}d`}
                    </td>
                  ) : null}
                  <td
                    title={`μ=${(row.dailyExpectedReturn * 100).toFixed(6)}%`}
                  >
                    {(row.rawRate * 100).toFixed(4)}% /{' '}
                    {(row.rate * 100).toFixed(4)}%
                  </td>
                  <td>{row.multiplier.toFixed(4)}</td>
                  <td>{row.spendBudget.toFixed(2)}</td>
                  <td>{(row.plannedBudgetPctOfCash * 100).toFixed(2)}%</td>
                  <td>{row.quantity.toFixed(4)}</td>
                  <td>{row.totalCost.toFixed(2)}</td>
                  <td>{row.cashAfterBuy.toFixed(2)}</td>
                  <td>{row.closingMarketValue.toFixed(2)}</td>
                  <td>{statusLabel(row.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
