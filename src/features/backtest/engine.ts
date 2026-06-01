import type {
  BacktestConfig,
  BacktestLotSizeRule,
  CashflowRecord,
  StrategyConfig,
  TargetAllocation,
} from '../../types/models'

export interface BacktestBuyExecution {
  instrumentCode: string
  quantity: number
  executionPrice: number
  grossAmount: number
  totalCost: number
}

export interface BacktestPoint {
  date: string
  nav: number
  cash: number
  marketValueByInstrument: Record<string, number>
  buyExecutions: BacktestBuyExecution[]
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

export const applyLotSizeRule = (rawQuantity: number, rule: BacktestLotSizeRule) => {
  if (!Number.isFinite(rawQuantity) || rawQuantity <= 0) return 0
  if (rule === 'fractional') return rawQuantity
  if (rule === 'integer') return Math.floor(rawQuantity)
  return Math.floor(rawQuantity / 100) * 100
}

export const runSimpleBacktest = ({
  prices,
  config,
  allocations,
  strategy,
  cashflows = [],
}: {
  prices: Record<string, Array<{ date: string; close: number; open?: number | null }>>
  config: BacktestConfig
  allocations: TargetAllocation[]
  strategy: StrategyConfig
  cashflows?: CashflowRecord[]
}): BacktestResult => {
  const allDates = [...new Set(Object.values(prices).flatMap((rows) => rows.map((row) => row.date)))]
    .filter((date) => date >= config.startDate && date <= config.endDate)
    .sort()

  const holdings: Record<string, number> = {}
  let cash = config.initialCash
  let invested = config.initialCash
  const points: BacktestPoint[] = []
  const pendingBudgetByInstrument: Record<string, number> = {}
  const orderedCashflows = [...cashflows]
    .filter((row) => row.date >= config.startDate && row.date <= config.endDate)
    .sort((a, b) => a.date.localeCompare(b.date))
  let cashflowCursor = 0

  for (const date of allDates) {
    while (cashflowCursor < orderedCashflows.length && orderedCashflows[cashflowCursor].date <= date) {
      cash += orderedCashflows[cashflowCursor].amount
      invested += orderedCashflows[cashflowCursor].amount
      cashflowCursor += 1
    }

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
      const feeMultiplier = 1 + config.feeRate + config.slippageRate
      const lotRuleMap = config.lotSizeRuleByInstrument ?? {}
      const buyExecutions: BacktestBuyExecution[] = []

      for (const item of priced) {
        const dailyAmount = budget * item.allocation.targetWeight
        const lotRule = lotRuleMap[item.allocation.instrumentCode] ?? 'fractional'

        let spendBudget: number
        if (lotRule === 'fractional') {
          spendBudget = dailyAmount
        } else {
          pendingBudgetByInstrument[item.allocation.instrumentCode] =
            (pendingBudgetByInstrument[item.allocation.instrumentCode] ?? 0) + dailyAmount
          spendBudget = pendingBudgetByInstrument[item.allocation.instrumentCode]
        }

        const quantity = applyLotSizeRule(spendBudget / item.executionPrice, lotRule)
        if (quantity <= 0) continue
        const grossAmount = quantity * item.executionPrice
        const totalCost = grossAmount * feeMultiplier
        if (totalCost > cash) continue

        holdings[item.allocation.instrumentCode] = (holdings[item.allocation.instrumentCode] ?? 0) + quantity
        cash -= totalCost
        if (lotRule !== 'fractional') {
          pendingBudgetByInstrument[item.allocation.instrumentCode] =
            (pendingBudgetByInstrument[item.allocation.instrumentCode] ?? 0) - grossAmount
        }
        buyExecutions.push({
          instrumentCode: item.allocation.instrumentCode,
          quantity,
          executionPrice: item.executionPrice,
          grossAmount,
          totalCost,
        })
      }

      const marketValueByInstrument = Object.fromEntries(
        priced.map((item) => [
          item.allocation.instrumentCode,
          (holdings[item.allocation.instrumentCode] ?? 0) * item.executionPrice,
        ]),
      )

      const marketValue = Object.values(marketValueByInstrument).reduce((sum, value) => sum + value, 0)

      points.push({ date, nav: cash + marketValue, cash, marketValueByInstrument, buyExecutions })
      continue
    }

    const marketValueByInstrument = Object.fromEntries(
      priced.map((item) => [
        item.allocation.instrumentCode,
        (holdings[item.allocation.instrumentCode] ?? 0) * item.executionPrice,
      ]),
    )

    const marketValue = Object.values(marketValueByInstrument).reduce((sum, value) => sum + value, 0)

    points.push({ date, nav: cash + marketValue, cash, marketValueByInstrument, buyExecutions: [] })
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
