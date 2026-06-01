import type {
  BacktestLotSizeRule,
  CashflowRecord,
  MarketCandle,
  StrategyConfig,
  TargetAllocation,
} from '../../types/models'
import type { AppLanguage } from '../../i18n/language'
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
  cashflows = [],
  elapsedTradingDaysSinceLastBuy = 1,
  lotSizeRuleByInstrument = {},
  language = 'en-US',
}: {
  snapshot: PortfolioSnapshot
  strategy: StrategyConfig
  allocations: TargetAllocation[]
  marketData: Record<string, MarketCandle[]>
  cashflows?: CashflowRecord[]
  elapsedTradingDaysSinceLastBuy?: number
  lotSizeRuleByInstrument?: Record<string, BacktestLotSizeRule>
  language?: AppLanguage
}): StrategySuggestion[] => {
  const positiveCash = Math.max(snapshot.cash, 0)
  if (positiveCash <= 0 || allocations.length === 0) return []

  const total = snapshot.totalMarketValue + positiveCash
  const zh = language === 'zh-CN'
  const mode = strategy.baseDailyInvestRateMode ?? 'fixed_1_252'
  const subAccounts = deriveSubAccountsFromCashflows(cashflows)
  const fixedBudgetBaseFromAccounts = subAccounts.reduce(
    (sum, account) => sum + account.initialPrincipal,
    0,
  )
  const staticBudgetBaseFromAccounts = subAccounts.reduce(
    (sum, account) => sum + account.currentPrincipal,
    0,
  )
  const staticBudgetBase =
    staticBudgetBaseFromAccounts > 0
      ? staticBudgetBaseFromAccounts
      : positiveCash
  const kellyBudgetBase = Math.max(snapshot.totalMarketValue + snapshot.cash, 0)

  const candidates = allocations
    .map((allocation) => {
      const candles = marketData[allocation.instrumentCode] ?? []
      const currentPrice = candles.at(-1)?.close ?? 0
      const rollingPeak = candles.reduce(
        (max, row) => Math.max(max, row.close),
        0,
      )
      const drawdown = rollingPeak > 0 ? 1 - currentPrice / rollingPeak : 0
      const instrumentStrategy =
        strategy.instrumentOverrides?.[allocation.instrumentCode]
      const effectiveMaxDrawdown =
        instrumentStrategy?.maxDrawdown ?? strategy.maxDrawdown
      const effectiveExpectedAnnualReturn =
        instrumentStrategy?.expectedAnnualReturn ??
        strategy.expectedAnnualReturn
      const effectiveBaseDailyInvestRate = resolveBaseDailyInvestRate({
        strategy,
        expectedAnnualReturn: effectiveExpectedAnnualReturn,
        maxDrawdown: effectiveMaxDrawdown,
        candles,
      })
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
      const budgetBase =
        mode === 'kelly_variant'
          ? kellyBudgetBase
          : mode === 'fixed_1_252'
            ? fixedBudgetBaseFromAccounts > 0
              ? fixedBudgetBaseFromAccounts
              : positiveCash
            : staticBudgetBase
      const investBudget =
        budgetBase *
        effectiveBaseDailyInvestRate *
        multiplier *
        elapsedTradingDaysSinceLastBuy
      const currentWeight =
        total > 0
          ? (snapshot.marketValueByInstrument[allocation.instrumentCode] ?? 0) /
            total
          : 0
      const gap = allocation.targetWeight - currentWeight
      return {
        allocation,
        currentPrice,
        drawdown,
        ddRatio,
        multiplier,
        investBudget,
        currentWeight,
        gap,
        effectiveMaxDrawdown,
        effectiveExpectedAnnualReturn,
        effectiveBaseDailyInvestRate,
      }
    })
    .filter((candidate) => candidate.currentPrice > 0 && candidate.gap > 0)
    .sort((a, b) => b.gap - a.gap)

  if (candidates.length === 0) return []

  const totalGap = candidates.reduce((sum, item) => sum + item.gap, 0)

  return candidates.map((candidate) => {
    const budgetShare =
      totalGap > 0 ? candidate.gap / totalGap : 1 / candidates.length
    const estimatedAmount = Math.min(
      positiveCash,
      candidate.investBudget * budgetShare,
    )
    const lotRule: BacktestLotSizeRule =
      lotSizeRuleByInstrument[candidate.allocation.instrumentCode] ??
      'fractional'
    const rawQuantity = estimatedAmount / candidate.currentPrice
    const quantity = applyLotSizeRule(rawQuantity, lotRule)

    let lotNote = ''
    if (lotRule !== 'fractional' && quantity === 0 && rawQuantity > 0) {
      const minLot = lotRule === 'lot100' ? 100 : 1
      const singleDayBudget =
        estimatedAmount / Math.max(elapsedTradingDaysSinceLastBuy, 1)
      const amountNeeded = minLot * candidate.currentPrice
      const extraDays =
        singleDayBudget > 0
          ? Math.ceil((amountNeeded - estimatedAmount) / singleDayBudget)
          : 0
      lotNote = zh
        ? `, 还需约 ${extraDays} 个交易日积累预算才能下单`
        : `, about ${extraDays} more trading day(s) of budget accumulation needed before execution`
    } else if (lotRule !== 'fractional' && quantity > 0) {
      const remainderAmount = (rawQuantity - quantity) * candidate.currentPrice
      lotNote = zh
        ? `, 余额约 ${remainderAmount.toFixed(2)} 继续积累`
        : `, remaining budget ${remainderAmount.toFixed(2)} will carry forward`
    }

    return {
      instrumentCode: candidate.allocation.instrumentCode,
      action: quantity > 0 ? 'buy' : 'hold',
      quantity,
      estimatedPrice: candidate.currentPrice,
      estimatedAmount: quantity * candidate.currentPrice,
      rationale: `drawdown=${(candidate.drawdown * 100).toFixed(2)}%, ddRatio=${candidate.ddRatio.toFixed(2)}, currentWeight=${(
        candidate.currentWeight * 100
      ).toFixed(
        2,
      )}%, targetWeight=${(candidate.allocation.targetWeight * 100).toFixed(2)}%, maxDrawdownRef=${(
        candidate.effectiveMaxDrawdown * 100
      ).toFixed(
        2,
      )}%, expectedAnnualReturnRef=${(candidate.effectiveExpectedAnnualReturn * 100).toFixed(2)}%, baseDailyInvestRateRef=${(
        candidate.effectiveBaseDailyInvestRate * 100
      ).toFixed(4)}%, multiplier=${candidate.multiplier.toFixed(2)}${lotNote}`,
    }
  })
}
