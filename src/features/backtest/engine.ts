import type { BacktestConfig, StrategyConfig, TargetAllocation } from '../../types/models'

export interface BacktestPoint {
  date: string
  nav: number
  cash: number
}

export interface BacktestResult {
  points: BacktestPoint[]
  totalInvested: number
  finalValue: number
  totalReturn: number
  annualizedReturn: number
  maxDrawdown: number
}

const calcMaxDrawdown = (values: number[]) => {
  let peak = 0
  let maxDd = 0
  for (const value of values) {
    peak = Math.max(peak, value)
    if (peak > 0) {
      maxDd = Math.max(maxDd, 1 - value / peak)
    }
  }
  return maxDd
}

export const runSimpleBacktest = ({
  prices,
  config,
  allocations,
  strategy,
}: {
  prices: Record<string, Array<{ date: string; close: number; open?: number | null }>>
  config: BacktestConfig
  allocations: TargetAllocation[]
  strategy: StrategyConfig
}): BacktestResult => {
  const allDates = [...new Set(Object.values(prices).flatMap((rows) => rows.map((row) => row.date)))]
    .filter((date) => date >= config.startDate && date <= config.endDate)
    .sort()

  const holdings: Record<string, number> = {}
  let cash = config.initialCash
  let invested = config.initialCash
  const points: BacktestPoint[] = []

  for (const date of allDates) {
    cash += config.recurringCashflows
    invested += config.recurringCashflows

    const priced = allocations
      .map((allocation) => {
        const row = prices[allocation.instrumentCode]?.find((item) => item.date === date)
        const executionPrice = config.useOpenPrice ? row?.open ?? row?.close : row?.close
        return { allocation, executionPrice: executionPrice ?? 0 }
      })
      .filter((item) => item.executionPrice > 0)

    if (priced.length > 0 && cash > 0) {
      const budget = cash * strategy.baseDailyInvestRate
      for (const item of priced) {
        const amount = budget * item.allocation.targetWeight
        const cost = amount * (1 + config.feeRate + config.slippageRate)
        if (cost <= cash) {
          holdings[item.allocation.instrumentCode] =
            (holdings[item.allocation.instrumentCode] ?? 0) + amount / item.executionPrice
          cash -= cost
        }
      }
    }

    const marketValue = priced.reduce(
      (sum, item) => sum + (holdings[item.allocation.instrumentCode] ?? 0) * item.executionPrice,
      0,
    )

    points.push({ date, nav: cash + marketValue, cash })
  }

  const finalValue = points.at(-1)?.nav ?? cash
  const totalReturn = invested > 0 ? (finalValue - invested) / invested : 0
  const years = Math.max(allDates.length / 252, 1 / 252)
  const annualizedReturn = invested > 0 ? Math.pow(finalValue / invested, 1 / years) - 1 : 0

  return {
    points,
    totalInvested: invested,
    finalValue,
    totalReturn,
    annualizedReturn,
    maxDrawdown: calcMaxDrawdown(points.map((point) => point.nav)),
  }
}
