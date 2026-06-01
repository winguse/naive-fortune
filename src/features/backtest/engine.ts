import type {
  BacktestConfig,
  BacktestLotSizeRule,
  CashflowRecord,
  StrategyConfig,
  TargetAllocation,
} from '../../types/models'
import { resolveBaseDailyInvestRateDetails } from '../strategy/drawdownDca'

export type BacktestCalculationStatus =
  | 'bought'
  | 'no_budget'
  | 'zero_quantity'
  | 'insufficient_cash'

export interface BacktestBuyExecution {
  instrumentCode: string
  quantity: number
  executionPrice: number
  grossAmount: number
  totalCost: number
  plannedBudget: number
  plannedBudgetPctOfCash: number
  cashAfterBuy: number
}

export interface BacktestCalculationDetail {
  instrumentCode: string
  executionPrice: number
  targetWeight: number
  expectedAnnualReturn: number
  dailyExpectedReturn: number
  volatilityLookbackDays: number
  trailingVolatility: number | null
  rawRate: number
  rate: number
  drawdown: number
  ddRatio: number
  multiplier: number
  budgetBase: number
  dailyAmount: number
  spendBudget: number
  plannedBudgetPctOfCash: number
  rawQuantity: number
  quantity: number
  grossAmount: number
  totalCost: number
  cashBeforeBuy: number
  cashAfterBuy: number
  status: BacktestCalculationStatus
}

export interface BacktestPoint {
  date: string
  nav: number
  cash: number
  marketValueByInstrument: Record<string, number>
  buyExecutions: BacktestBuyExecution[]
  calculationDetails: BacktestCalculationDetail[]
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

export const applyLotSizeRule = (
  rawQuantity: number,
  rule: BacktestLotSizeRule,
) => {
  if (!Number.isFinite(rawQuantity) || rawQuantity <= 0) return 0
  if (rule === 'fractional') return rawQuantity
  if (rule === 'integer') return Math.floor(rawQuantity)
  return Math.floor(rawQuantity / 100) * 100
}

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value))

interface BacktestSubAccount {
  id: string
  initialPrincipal: number
  currentPrincipal: number
  cash: number
}

const getSubAccountCash = (accounts: BacktestSubAccount[]) =>
  accounts.reduce((sum, account) => sum + account.cash, 0)

const applyCashflowToSubAccounts = (
  accounts: BacktestSubAccount[],
  cashflow: CashflowRecord,
) => {
  if (cashflow.amount > 0) {
    accounts.push({
      id: cashflow.id,
      initialPrincipal: cashflow.amount,
      currentPrincipal: cashflow.amount,
      cash: cashflow.amount,
    })
    return
  }

  if (cashflow.amount >= 0) return

  const withdrawal = Math.abs(cashflow.amount)
  const totalPrincipal = accounts.reduce(
    (sum, account) => sum + account.currentPrincipal,
    0,
  )
  if (totalPrincipal > 0) {
    const principalShrinkRatio = clamp(
      (totalPrincipal - withdrawal) / totalPrincipal,
      0,
      1,
    )
    for (const account of accounts) {
      account.currentPrincipal *= principalShrinkRatio
    }
  }

  const totalCash = getSubAccountCash(accounts)
  if (totalCash <= 0) return
  const cashShrinkRatio = clamp((totalCash - withdrawal) / totalCash, 0, 1)
  for (const account of accounts) {
    account.cash *= cashShrinkRatio
  }
}

export const runSimpleBacktest = ({
  prices,
  config,
  allocations,
  strategy,
  cashflows = [],
}: {
  prices: Record<
    string,
    Array<{ date: string; close: number; open?: number | null }>
  >
  config: BacktestConfig
  allocations: TargetAllocation[]
  strategy: StrategyConfig
  cashflows?: CashflowRecord[]
}): BacktestResult => {
  const allDates = [
    ...new Set(
      Object.values(prices).flatMap((rows) => rows.map((row) => row.date)),
    ),
  ]
    .filter((date) => date >= config.startDate && date <= config.endDate)
    .sort()

  const holdings: Record<string, number> = {}
  // Actual trades are ignored; the simulation runs strategy from scratch.
  const subAccounts: BacktestSubAccount[] = []
  const priorCashflows = [...cashflows]
    .filter((cf) => cf.date < config.startDate)
    .sort((a, b) => a.date.localeCompare(b.date))
  for (const cashflow of priorCashflows) {
    applyCashflowToSubAccounts(subAccounts, cashflow)
  }

  let cash = getSubAccountCash(subAccounts)
  let invested = cashflows
    .filter((cf) => cf.date < config.startDate)
    .reduce((sum, cf) => sum + cf.amount, 0)
  const points: BacktestPoint[] = []
  const pendingBudgetByAccountAndInstrument: Record<
    string,
    Record<string, number>
  > = {}

  // Only cashflows within the window are applied during the loop.
  const orderedCashflows = [...cashflows]
    .filter((row) => row.date >= config.startDate && row.date <= config.endDate)
    .sort((a, b) => a.date.localeCompare(b.date))
  let cashflowCursor = 0

  const globalFeeRate = strategy.feeRate ?? 0.0005
  const globalSlippageRate = strategy.slippageRate ?? 0.0005
  const globalLotRuleMap = strategy.lotSizeRuleByInstrument ?? {}

  for (const date of allDates) {
    while (
      cashflowCursor < orderedCashflows.length &&
      orderedCashflows[cashflowCursor].date <= date
    ) {
      const cashflow = orderedCashflows[cashflowCursor]
      applyCashflowToSubAccounts(subAccounts, cashflow)
      invested += cashflow.amount
      cash = getSubAccountCash(subAccounts)
      cashflowCursor += 1
    }

    const priced = allocations
      .map((allocation) => {
        const row = prices[allocation.instrumentCode]?.find(
          (item) => item.date === date,
        )
        const executionPrice = config.useOpenPrice
          ? (row?.open ?? row?.close)
          : row?.close
        return { allocation, executionPrice: executionPrice ?? 0 }
      })
      .filter((item) => item.executionPrice > 0)

    if (priced.length > 0 && cash > 0) {
      const cashBeforeBuy = cash
      const mode = strategy.baseDailyInvestRateMode ?? 'fixed_1_252'
      const budgetBase = subAccounts.reduce((sum, account) => {
        if (mode === 'fixed_1_252') return sum + account.initialPrincipal
        return sum + account.currentPrincipal
      }, 0)
      const buyExecutions: BacktestBuyExecution[] = []
      const calculationDetails: BacktestCalculationDetail[] = []

      for (const item of priced) {
        const code = item.allocation.instrumentCode
        const override = strategy.instrumentOverrides?.[code]

        const effectiveMaxDrawdown =
          override?.maxDrawdown ?? strategy.maxDrawdown
        const effectiveExpectedReturn =
          override?.expectedAnnualReturn ?? strategy.expectedAnnualReturn

        const candlesUpToDate = (prices[code] ?? []).filter(
          (r) => r.date <= date,
        )
        const rateDetails = resolveBaseDailyInvestRateDetails({
          strategy,
          expectedAnnualReturn: effectiveExpectedReturn,
          maxDrawdown: effectiveMaxDrawdown,
          candles: candlesUpToDate,
        })
        const rate = rateDetails.rate

        const rollingPeak = candlesUpToDate.reduce(
          (max, row) => Math.max(max, row.close),
          0,
        )
        const drawdown =
          rollingPeak > 0 ? 1 - item.executionPrice / rollingPeak : 0
        const ddRatio = clamp(
          drawdown / Math.max(effectiveMaxDrawdown, 0.0001),
          0,
          1.5,
        )
        const multiplier = clamp(
          strategy.buyScaleMin +
            (strategy.buyScaleMax - strategy.buyScaleMin) * (ddRatio / 1.5),
          strategy.buyScaleMin,
          strategy.buyScaleMax,
        )

        const lotRule: BacktestLotSizeRule =
          override?.lotSizeRule ?? globalLotRuleMap[code] ?? 'fractional'
        const effectiveFeeRate = override?.feeRate ?? globalFeeRate
        const effectiveSlippageRate =
          override?.slippageRate ?? globalSlippageRate
        const feeMultiplier = 1 + effectiveFeeRate + effectiveSlippageRate

        let dailyAmount = 0
        let spendBudget = 0
        let rawQuantity = 0
        let quantity = 0
        let grossAmount = 0
        let totalCost = 0

        for (const account of subAccounts) {
          const accountBudgetBase =
            mode === 'fixed_1_252'
              ? account.initialPrincipal
              : account.currentPrincipal
          const accountDailyAmount =
            accountBudgetBase * rate * item.allocation.targetWeight * multiplier
          dailyAmount += accountDailyAmount

          let accountSpendBudget: number
          if (lotRule === 'fractional') {
            accountSpendBudget = accountDailyAmount
          } else {
            const pendingByInstrument =
              pendingBudgetByAccountAndInstrument[account.id] ?? {}
            pendingBudgetByAccountAndInstrument[account.id] =
              pendingByInstrument
            pendingByInstrument[code] =
              (pendingByInstrument[code] ?? 0) + accountDailyAmount
            accountSpendBudget = pendingByInstrument[code]
          }
          spendBudget += accountSpendBudget

          const affordableGrossBudget = Math.min(
            accountSpendBudget,
            account.cash / feeMultiplier,
          )
          const accountRawQuantity = affordableGrossBudget / item.executionPrice
          const accountQuantity = applyLotSizeRule(accountRawQuantity, lotRule)
          const accountGrossAmount = accountQuantity * item.executionPrice
          const accountTotalCost = accountGrossAmount * feeMultiplier

          if (accountQuantity <= 0 || accountTotalCost > account.cash) continue

          account.cash -= accountTotalCost
          if (lotRule !== 'fractional') {
            pendingBudgetByAccountAndInstrument[account.id][code] =
              (pendingBudgetByAccountAndInstrument[account.id][code] ?? 0) -
              accountGrossAmount
          }

          rawQuantity += accountRawQuantity
          quantity += accountQuantity
          grossAmount += accountGrossAmount
          totalCost += accountTotalCost
        }

        cash = getSubAccountCash(subAccounts)
        const plannedBudgetPctOfCash =
          cashBeforeBuy > 0 ? spendBudget / cashBeforeBuy : 0

        const pushCalculationDetail = (status: BacktestCalculationStatus) => {
          calculationDetails.push({
            instrumentCode: code,
            executionPrice: item.executionPrice,
            targetWeight: item.allocation.targetWeight,
            expectedAnnualReturn: rateDetails.expectedAnnualReturn,
            dailyExpectedReturn: rateDetails.dailyExpectedReturn,
            volatilityLookbackDays: rateDetails.volatilityLookbackDays,
            trailingVolatility: rateDetails.trailingVolatility,
            rawRate: rateDetails.rawRate,
            rate,
            drawdown,
            ddRatio,
            multiplier,
            budgetBase,
            dailyAmount,
            spendBudget,
            plannedBudgetPctOfCash,
            rawQuantity,
            quantity,
            grossAmount,
            totalCost,
            cashBeforeBuy,
            cashAfterBuy: cash,
            status,
          })
        }

        if (dailyAmount <= 0 || spendBudget <= 0) {
          pushCalculationDetail('no_budget')
          continue
        }

        if (quantity <= 0) {
          pushCalculationDetail('zero_quantity')
          continue
        }

        holdings[code] = (holdings[code] ?? 0) + quantity
        buyExecutions.push({
          instrumentCode: code,
          quantity,
          executionPrice: item.executionPrice,
          grossAmount,
          totalCost,
          plannedBudget: spendBudget,
          plannedBudgetPctOfCash,
          cashAfterBuy: cash,
        })
        pushCalculationDetail('bought')
      }

      const marketValueByInstrument = Object.fromEntries(
        priced.map((item) => [
          item.allocation.instrumentCode,
          (holdings[item.allocation.instrumentCode] ?? 0) * item.executionPrice,
        ]),
      )
      const marketValue = Object.values(marketValueByInstrument).reduce(
        (sum, v) => sum + v,
        0,
      )
      points.push({
        date,
        nav: cash + marketValue,
        cash,
        marketValueByInstrument,
        buyExecutions,
        calculationDetails,
      })
      continue
    }

    const marketValueByInstrument = Object.fromEntries(
      priced.map((item) => [
        item.allocation.instrumentCode,
        (holdings[item.allocation.instrumentCode] ?? 0) * item.executionPrice,
      ]),
    )
    const marketValue = Object.values(marketValueByInstrument).reduce(
      (sum, v) => sum + v,
      0,
    )
    points.push({
      date,
      nav: cash + marketValue,
      cash,
      marketValueByInstrument,
      buyExecutions: [],
      calculationDetails: [],
    })
  }

  const finalValue = points.at(-1)?.nav ?? cash
  const totalReturn = invested > 0 ? (finalValue - invested) / invested : 0
  const years = Math.max(allDates.length / 252, 1 / 252)
  const annualizedReturn =
    invested > 0 ? Math.pow(finalValue / invested, 1 / years) - 1 : 0

  return {
    points,
    totalInvested: invested,
    finalValue,
    totalReturn,
    annualizedReturn,
    maxDrawdown: calcMaxDrawdown(points.map((point) => point.nav)),
  }
}
