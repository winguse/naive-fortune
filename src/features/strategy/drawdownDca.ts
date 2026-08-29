import type {
  BacktestLotSizeRule,
  CashflowRecord,
  MarketCandle,
  StrategyConfig,
  TargetAllocation,
} from '../../types/models'
import type { PortfolioSnapshot } from '../portfolio/calc'
import { applyLotSizeRule } from '../backtest/engine'

export interface StrategySuggestion {
  instrumentCode: string
  action: 'buy' | 'sell' | 'hold'
  quantity: number
  estimatedPrice: number
  estimatedAmount: number
  rationale: string
}

const TRADING_DAYS_PER_YEAR = 252
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value))

export interface StrategySubAccount {
  id: string
  label: string
  createdAt: string
  initialPrincipal: number
  currentPrincipal: number
}

export const deriveSubAccountsFromCashflows = (
  cashflows: CashflowRecord[],
): StrategySubAccount[] => {
  const ordered = [...cashflows].sort((a, b) => a.date.localeCompare(b.date))
  const accounts: StrategySubAccount[] = []

  for (let index = 0; index < ordered.length; index += 1) {
    const row = ordered[index]
    if (row.amount > 0) {
      const label = String.fromCharCode(65 + accounts.length)
      accounts.push({
        id: row.id,
        label: `Plan ${label}`,
        createdAt: row.date,
        initialPrincipal: row.amount,
        currentPrincipal: row.amount,
      })
      continue
    }

    if (row.amount < 0) {
      const withdrawal = Math.abs(row.amount)
      const totalPrincipal = accounts.reduce(
        (sum, item) => sum + item.currentPrincipal,
        0,
      )
      if (totalPrincipal <= 0) continue
      const shrinkRatio = clamp(
        (totalPrincipal - withdrawal) / totalPrincipal,
        0,
        1,
      )
      for (const account of accounts) {
        account.currentPrincipal *= shrinkRatio
      }
    }
  }

  if (accounts.length === 0) {
    accounts.push({
      id: 'fallback',
      label: 'Plan A',
      createdAt: '',
      initialPrincipal: 0,
      currentPrincipal: 0,
    })
  }

  return accounts
}

export const calcTrailingVolatility = (
  candles: MarketCandle[],
  lookbackDays: number,
) => {
  const normalizedLookbackDays = Math.max(1, Math.floor(lookbackDays))
  const window = candles.slice(-(normalizedLookbackDays + 1))
  if (window.length <= 2) return 0

  const returns: number[] = []
  for (let index = 1; index < window.length; index += 1) {
    const prev = window[index - 1].close
    const current = window[index].close
    if (prev <= 0 || current <= 0) continue
    returns.push(Math.log(current / prev))
  }
  if (returns.length <= 1) return 0

  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length
  const variance =
    returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (returns.length - 1)
  return Math.sqrt(Math.max(variance, 0))
}

export interface BaseDailyInvestRateDetails {
  mode: NonNullable<StrategyConfig['baseDailyInvestRateMode']>
  expectedAnnualReturn: number
  dailyExpectedReturn: number
  maxDrawdown: number
  acceptableMaxDrawdown: number
  volatilityLookbackDays: number
  kellyFraction: number
  trailingVolatility: number | null
  rawRate: number
  rate: number
}

export const resolveBaseDailyInvestRateDetails = ({
  strategy,
  expectedAnnualReturn,
  maxDrawdown,
  candles,
}: {
  strategy: StrategyConfig
  expectedAnnualReturn: number
  maxDrawdown: number
  candles: MarketCandle[]
}): BaseDailyInvestRateDetails => {
  const mode = strategy.baseDailyInvestRateMode ?? 'fixed_1_252'
  const safeExpectedAnnualReturn = Math.max(expectedAnnualReturn, 0)
  const dailyExpectedReturn = safeExpectedAnnualReturn / TRADING_DAYS_PER_YEAR
  const acceptableMaxDrawdown = Math.max(strategy.acceptableMaxDrawdown ?? 0, 0)
  const volatilityLookbackDays = Math.max(
    2,
    Math.floor(strategy.volatilityLookbackDays ?? 20),
  )
  const kellyFraction = Math.max(strategy.kellyFraction ?? 0.25, 0)

  if (mode === 'fixed_1_252') {
    const rawRate = 1 / TRADING_DAYS_PER_YEAR
    return {
      mode,
      expectedAnnualReturn: safeExpectedAnnualReturn,
      dailyExpectedReturn,
      maxDrawdown,
      acceptableMaxDrawdown,
      volatilityLookbackDays,
      kellyFraction,
      trailingVolatility: null,
      rawRate,
      rate: rawRate,
    }
  }

  if (mode === 'naive') {
    const denominator = Math.max(maxDrawdown - acceptableMaxDrawdown, 0.0001)
    const rawRate = dailyExpectedReturn / denominator
    return {
      mode,
      expectedAnnualReturn: safeExpectedAnnualReturn,
      dailyExpectedReturn,
      maxDrawdown,
      acceptableMaxDrawdown,
      volatilityLookbackDays,
      kellyFraction,
      trailingVolatility: null,
      rawRate,
      rate: clamp(rawRate, 0, 1),
    }
  }

  const trailingVolatility = calcTrailingVolatility(
    candles,
    volatilityLookbackDays,
  )
  const trailingVariance = trailingVolatility ** 2
  const fullKellyFraction =
    dailyExpectedReturn > 0 && trailingVariance > 0
      ? dailyExpectedReturn / trailingVariance
      : 0
  const rawRate = (fullKellyFraction * kellyFraction) / TRADING_DAYS_PER_YEAR
  return {
    mode,
    expectedAnnualReturn: safeExpectedAnnualReturn,
    dailyExpectedReturn,
    maxDrawdown,
    acceptableMaxDrawdown,
    volatilityLookbackDays,
    kellyFraction,
    trailingVolatility,
    rawRate,
    rate: clamp(rawRate, 0, 1),
  }
}

export const resolveBaseDailyInvestRate = (
  params: Parameters<typeof resolveBaseDailyInvestRateDetails>[0],
) => resolveBaseDailyInvestRateDetails(params).rate

export const createDrawdownAdjustedSuggestions = ({
  snapshot,
  strategy,
  allocations,
  marketData,
  lotSizeRuleByInstrument = {},
  currentDayIndex = 0,
}: {
  snapshot: PortfolioSnapshot
  strategy: StrategyConfig
  allocations: TargetAllocation[]
  marketData: Record<string, MarketCandle[]>
  lotSizeRuleByInstrument?: Record<string, BacktestLotSizeRule>
  currentDayIndex?: number
}): StrategySuggestion[] => {
  const totalMarketValue = snapshot.totalMarketValue
  const totalCash = Math.max(snapshot.cash, 0)
  const totalValue = totalMarketValue + totalCash
  
  if (totalValue <= 0 || allocations.length === 0) return []

  const targetCashRatio = strategy.targetCashRatio ?? 0.2
  const targetRiskyRatio = 1 - targetCashRatio
  const targetCashReserve = totalValue * targetCashRatio
  const investableCash = Math.max(totalCash - targetCashReserve, 0)

  // DBRE: Remaining Days Re-averaging
  const totalPlannedPeriods = strategy.totalPlannedPeriods ?? 250
  const T_remain = Math.max(totalPlannedPeriods - currentDayIndex, 1)
  const investBudget = investableCash / T_remain

  // Rebalancing: check for sell actions
  const rebalanceThreshold = 0.05 // 5% deviation

  const suggestions: StrategySuggestion[] = allocations.map((allocation) => {
    const candles = marketData[allocation.instrumentCode] ?? []
    const currentPrice = candles.at(-1)?.close ?? 0
    const currentWeight = totalValue > 0 ? (snapshot.marketValueByInstrument[allocation.instrumentCode] ?? 0) / totalValue : 0
    const absoluteTargetWeight = allocation.targetWeight * targetRiskyRatio
    const gap = absoluteTargetWeight - currentWeight

    if (Math.abs(gap) < rebalanceThreshold) {
      return {
        instrumentCode: allocation.instrumentCode,
        action: 'hold',
        quantity: 0,
        estimatedPrice: currentPrice,
        estimatedAmount: 0,
        rationale: `Within rebalance threshold. CurrentWeight=${(currentWeight * 100).toFixed(2)}%, Target=${(absoluteTargetWeight * 100).toFixed(2)}%`,
      }
    }

    if (gap > 0) {
      // Buy
      const estimatedAmount = Math.min(totalCash, investBudget * (allocation.targetWeight)) // Use instrument's share of risky part
      const quantity = applyLotSizeRule(estimatedAmount / currentPrice, lotSizeRuleByInstrument[allocation.instrumentCode] ?? 'fractional')
      return {
        instrumentCode: allocation.instrumentCode,
        action: 'buy',
        quantity,
        estimatedPrice: currentPrice,
        estimatedAmount: quantity * currentPrice,
        rationale: `Rebalancing: Underweight. Gap=${(gap * 100).toFixed(2)}%`,
      }
    } else {
      // Sell
      if (!strategy.sellEnabled) {
        return {
          instrumentCode: allocation.instrumentCode,
          action: 'hold',
          quantity: 0,
          estimatedPrice: currentPrice,
          estimatedAmount: 0,
          rationale: `Overweight but selling disabled. Gap=${(gap * 100).toFixed(2)}%`,
        }
      }
      const sellAmount = Math.abs(gap) * totalValue
      const quantity = applyLotSizeRule(sellAmount / currentPrice, lotSizeRuleByInstrument[allocation.instrumentCode] ?? 'fractional')
      return {
        instrumentCode: allocation.instrumentCode,
        action: 'sell',
        quantity,
        estimatedPrice: currentPrice,
        estimatedAmount: quantity * currentPrice,
        rationale: `Rebalancing: Overweight. Gap=${(gap * 100).toFixed(2)}%`,
      }
    }
  })

  return suggestions.filter(s => s.action !== 'hold')
}
