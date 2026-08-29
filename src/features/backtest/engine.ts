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
  | 'sold'
  | 'no_budget'
  | 'zero_quantity'
  | 'insufficient_cash'
  | 'hold'

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

export interface BacktestSellExecution {
  instrumentCode: string
  quantity: number
  executionPrice: number
  grossAmount: number
  totalCost: number
  cashAfterSell: number
}

export interface BacktestCalculationDetail {
  instrumentCode: string
  action: 'buy' | 'sell' | 'hold'
  executionPrice: number
  targetWeight: number
  currentWeight: number
  gap: number
  rate: number
  trailingVolatility: number | null
  volatilityLookbackDays: number
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
  cashBeforeAction: number
  cashAfterAction: number
  status: BacktestCalculationStatus
}

export interface BacktestPoint {
  date: string
  nav: number
  cash: number
  marketValueByInstrument: Record<string, number>
  buyExecutions: BacktestBuyExecution[]
  sellExecutions: BacktestSellExecution[]
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
  let cash = 0
  let invested = 0

  // Apply prior cashflows
  const priorCashflows = [...cashflows]
    .filter((cf) => cf.date < config.startDate)
    .sort((a, b) => a.date.localeCompare(b.date))
  for (const cf of priorCashflows) {
    cash += cf.amount
    invested += cf.amount
  }

  const points: BacktestPoint[] = []
  const pendingBudgetByInstrument: Record<string, number> = {}

  // Cashflows within window
  const orderedCashflows = [...cashflows]
    .filter((row) => row.date >= config.startDate && row.date <= config.endDate)
    .sort((a, b) => a.date.localeCompare(b.date))
  let cashflowCursor = 0

  const globalFeeRate = strategy.feeRate ?? 0.0005
  const globalSlippageRate = strategy.slippageRate ?? 0.0005
  const globalLotRuleMap = strategy.lotSizeRuleByInstrument ?? {}
  const totalPlannedPeriods = strategy.totalPlannedPeriods ?? 250
  const rebalanceThreshold = 0.05

  for (let dayIndex = 0; dayIndex < allDates.length; dayIndex++) {
    const date = allDates[dayIndex]

    // 1. Apply cashflows for today
    while (
      cashflowCursor < orderedCashflows.length &&
      orderedCashflows[cashflowCursor].date <= date
    ) {
      const cf = orderedCashflows[cashflowCursor]
      cash += cf.amount
      invested += cf.amount
      cashflowCursor += 1
    }

    const buyExecutions: BacktestBuyExecution[] = []
    const sellExecutions: BacktestSellExecution[] = []
    const calculationDetails: BacktestCalculationDetail[] = []

    // 2. Get today's prices and calculate NAV
    const priced = allocations.map((allocation) => {
      const rows = prices[allocation.instrumentCode] ?? []
      const row = rows.find((item) => item.date === date)
      const executionPrice = config.useOpenPrice ? (row?.open ?? row?.close) : row?.close
      return { allocation, executionPrice: executionPrice ?? 0, candles: rows.filter(r => r.date <= date) }
    }).filter(p => p.executionPrice > 0)

    const marketValueByInstrument: Record<string, number> = {}
    let totalMarketValue = 0
    for (const p of priced) {
      const mv = (holdings[p.allocation.instrumentCode] ?? 0) * p.executionPrice
      marketValueByInstrument[p.allocation.instrumentCode] = mv
      totalMarketValue += mv
    }

    const nav = cash + totalMarketValue
    if (nav <= 0) {
      points.push({ date, nav, cash, marketValueByInstrument, buyExecutions: [], sellExecutions: [], calculationDetails: [] })
      continue
    }

    // 3. DBRE Calculation: investBudget for today
    const targetCashRatio = strategy.targetCashRatio ?? 0.2
    const targetRiskyRatio = 1 - targetCashRatio
    const targetCash = nav * targetCashRatio
    const investableCash = Math.max(cash - targetCash, 0)
    const T_remain = Math.max(totalPlannedPeriods - dayIndex, 1)

    // 4. Rebalancing & DCA Suggesions
    // Sells first
    for (const p of priced) {
      const code = p.allocation.instrumentCode
      const currentWeight = (marketValueByInstrument[code] ?? 0) / nav
      const absoluteTargetWeight = p.allocation.targetWeight * targetRiskyRatio
      const gap = absoluteTargetWeight - currentWeight
      const override = strategy.instrumentOverrides?.[code]
      const lotRule = override?.lotSizeRule ?? globalLotRuleMap[code] ?? 'fractional'
      const effectiveFeeRate = override?.feeRate ?? globalFeeRate
      const effectiveSlippageRate = override?.slippageRate ?? globalSlippageRate

      if (strategy.sellEnabled && gap < -rebalanceThreshold) {
        // Sell to target
        const sellGrossAmount = Math.abs(gap) * nav
        const quantity = applyLotSizeRule(sellGrossAmount / p.executionPrice, lotRule)
        if (quantity > 0) {
          const actualGross = quantity * p.executionPrice
          const fees = actualGross * (effectiveFeeRate + effectiveSlippageRate)
          const netProceeds = actualGross - fees
          
          holdings[code] = (holdings[code] ?? 0) - quantity
          cash += netProceeds
          
          sellExecutions.push({
            instrumentCode: code,
            quantity,
            executionPrice: p.executionPrice,
            grossAmount: actualGross,
            totalCost: fees,
            cashAfterSell: cash
          })
          
          calculationDetails.push({
            instrumentCode: code,
            action: 'sell',
            executionPrice: p.executionPrice,
            targetWeight: absoluteTargetWeight,
            currentWeight,
            gap,
            rate: 0,
            trailingVolatility: null,
            volatilityLookbackDays: 0,
            drawdown: 0,
            ddRatio: 0,
            multiplier: 1,
            budgetBase: 0,
            dailyAmount: 0,
            spendBudget: sellGrossAmount,
            plannedBudgetPctOfCash: 0,
            rawQuantity: sellGrossAmount / p.executionPrice,
            quantity,
            grossAmount: actualGross,
            totalCost: fees,
            cashBeforeAction: cash - netProceeds,
            cashAfterAction: cash,
            status: 'sold',
          })
        }
      }
    }

    // 5. DCA Buys
    for (const p of priced) {
      const code = p.allocation.instrumentCode
      const currentMarketValue = (holdings[code] ?? 0) * p.executionPrice
      const currentNav = cash + Object.entries(holdings).reduce((sum, [c, q]) => {
        const px = priced.find(x => x.allocation.instrumentCode === c)?.executionPrice ?? 0
        return sum + q * px
      }, 0)
      const updatedWeight = currentNav > 0 ? currentMarketValue / currentNav : 0
      const absoluteTargetWeight = p.allocation.targetWeight * targetRiskyRatio
      const gap = absoluteTargetWeight - updatedWeight

      if (gap > 0) {
        const override = strategy.instrumentOverrides?.[code]
        const effectiveMaxDrawdown = override?.maxDrawdown ?? strategy.maxDrawdown
        const effectiveExpectedReturn = override?.expectedAnnualReturn ?? strategy.expectedAnnualReturn
        
        // Rate details (Kelly/Naive)
        const rateDetails = resolveBaseDailyInvestRateDetails({
          strategy,
          expectedAnnualReturn: effectiveExpectedReturn,
          maxDrawdown: effectiveMaxDrawdown,
          candles: p.candles,
        })
        
        // DBRE provides the "fixed" base rate if mode is fixed, otherwise use dynamic rate
        const mode = strategy.baseDailyInvestRateMode ?? 'fixed_1_252'
        const baseRate = mode === 'fixed_1_252' ? (1 / T_remain) : rateDetails.rate
        
        // Drawdown multiplier
        const rollingPeak = p.candles.reduce((max, row) => Math.max(max, row.close), 0)
        const drawdown = rollingPeak > 0 ? 1 - p.executionPrice / rollingPeak : 0
        const ddRatio = clamp(drawdown / Math.max(effectiveMaxDrawdown, 0.0001), 0, 1.5)
        const multiplier = clamp(
          strategy.buyScaleMin + (strategy.buyScaleMax - strategy.buyScaleMin) * (ddRatio / 1.5),
          strategy.buyScaleMin,
          strategy.buyScaleMax,
        )

        const lotRule = override?.lotSizeRule ?? globalLotRuleMap[code] ?? 'fractional'
        const effectiveFeeRate = override?.feeRate ?? globalFeeRate
        const effectiveSlippageRate = override?.slippageRate ?? globalSlippageRate
        const feeMultiplier = 1 + effectiveFeeRate + effectiveSlippageRate

        // Budget allocation
        // budgetBase for dynamic rates is NAV, for fixed it is investable cash
        const budgetBase = mode === 'fixed_1_252' ? investableCash : currentNav
        const dailyAmount = budgetBase * baseRate * (p.allocation.targetWeight) * multiplier 
        
        let spendBudget = dailyAmount
        if (lotRule !== 'fractional') {
          pendingBudgetByInstrument[code] = (pendingBudgetByInstrument[code] ?? 0) + dailyAmount
          spendBudget = pendingBudgetByInstrument[code]
        }

        const affordableGrossBudget = Math.min(spendBudget, Math.max(cash - targetCash, 0) / feeMultiplier)
        const rawQuantity = affordableGrossBudget / p.executionPrice
        const quantity = applyLotSizeRule(rawQuantity, lotRule)
        const grossAmount = quantity * p.executionPrice
        const totalCost = grossAmount * feeMultiplier

        if (quantity > 0 && totalCost <= cash) {
          holdings[code] = (holdings[code] ?? 0) + quantity
          cash -= totalCost
          
          if (lotRule !== 'fractional') {
            pendingBudgetByInstrument[code] -= grossAmount
          }

          buyExecutions.push({
            instrumentCode: code,
            quantity,
            executionPrice: p.executionPrice,
            grossAmount,
            totalCost,
            plannedBudget: spendBudget,
            plannedBudgetPctOfCash: cash > 0 ? spendBudget / (cash + totalCost) : 0,
            cashAfterBuy: cash
          })

          calculationDetails.push({
            instrumentCode: code,
            action: 'buy',
            executionPrice: p.executionPrice,
            targetWeight: absoluteTargetWeight,
            currentWeight: updatedWeight,
            gap,
            rate: baseRate,
            trailingVolatility: rateDetails.trailingVolatility,
            volatilityLookbackDays: rateDetails.volatilityLookbackDays,
            drawdown,
            ddRatio,
            multiplier,
            budgetBase,
            dailyAmount,
            spendBudget,
            plannedBudgetPctOfCash: cash > 0 ? spendBudget / (cash + totalCost) : 0,
            rawQuantity,
            quantity,
            grossAmount,
            totalCost,
            cashBeforeAction: cash + totalCost,
            cashAfterAction: cash,
            status: 'bought',
          })
        } else {
          calculationDetails.push({
            instrumentCode: code,
            action: 'buy',
            executionPrice: p.executionPrice,
            targetWeight: absoluteTargetWeight,
            currentWeight: updatedWeight,
            gap,
            rate: baseRate,
            trailingVolatility: rateDetails.trailingVolatility,
            volatilityLookbackDays: rateDetails.volatilityLookbackDays,
            drawdown,
            ddRatio,
            multiplier,
            budgetBase,
            dailyAmount,
            spendBudget,
            plannedBudgetPctOfCash: cash > 0 ? spendBudget / cash : 0,
            rawQuantity,
            quantity,
            grossAmount: 0,
            totalCost: 0,
            cashBeforeAction: cash,
            cashAfterAction: cash,
            status: quantity <= 0 ? 'zero_quantity' : 'insufficient_cash',
          })
        }
      }
    }

    // Update market values for the point after all actions
    const finalMarketValueByInstrument: Record<string, number> = {}
    let finalTotalMarketValue = 0
    for (const p of priced) {
      const mv = (holdings[p.allocation.instrumentCode] ?? 0) * p.executionPrice
      finalMarketValueByInstrument[p.allocation.instrumentCode] = mv
      finalTotalMarketValue += mv
    }

    points.push({
      date,
      nav: cash + finalTotalMarketValue,
      cash,
      marketValueByInstrument: finalMarketValueByInstrument,
      buyExecutions,
      sellExecutions,
      calculationDetails
    })
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
