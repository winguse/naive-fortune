import type { MarketCandle, StrategyConfig, TargetAllocation } from '../../types/models'
import type { PortfolioSnapshot } from '../portfolio/calc'

export interface StrategySuggestion {
  instrumentCode: string
  action: 'buy' | 'sell' | 'hold'
  quantity: number
  estimatedPrice: number
  estimatedAmount: number
  rationale: string
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

export const createDrawdownAdjustedSuggestions = ({
  snapshot,
  strategy,
  allocations,
  marketData,
  elapsedTradingDaysSinceLastBuy = 1,
}: {
  snapshot: PortfolioSnapshot
  strategy: StrategyConfig
  allocations: TargetAllocation[]
  marketData: Record<string, MarketCandle[]>
  elapsedTradingDaysSinceLastBuy?: number
}): StrategySuggestion[] => {
  const positiveCash = Math.max(snapshot.cash, 0)
  if (positiveCash <= 0 || allocations.length === 0) return []

  const total = snapshot.totalMarketValue + positiveCash

  const candidates = allocations
    .map((allocation) => {
      const candles = marketData[allocation.instrumentCode] ?? []
      const currentPrice = candles.at(-1)?.close ?? 0
      const rollingPeak = candles.reduce((max, row) => Math.max(max, row.close), 0)
      const drawdown = rollingPeak > 0 ? 1 - currentPrice / rollingPeak : 0
      const ddRatio = clamp(drawdown / Math.max(strategy.maxDrawdown, 0.0001), 0, 1.5)
      const multiplier = clamp(
        strategy.buyScaleMin + (strategy.buyScaleMax - strategy.buyScaleMin) * (ddRatio / 1.5),
        strategy.buyScaleMin,
        strategy.buyScaleMax,
      )
      const investBudget = positiveCash * strategy.baseDailyInvestRate * multiplier * elapsedTradingDaysSinceLastBuy
      const currentWeight = total > 0 ? (snapshot.marketValueByInstrument[allocation.instrumentCode] ?? 0) / total : 0
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
      }
    })
    .filter((candidate) => candidate.currentPrice > 0 && candidate.gap > 0)
    .sort((a, b) => b.gap - a.gap)

  if (candidates.length === 0) return []

  const totalGap = candidates.reduce((sum, item) => sum + item.gap, 0)

  return candidates.map((candidate) => {
    const budgetShare = totalGap > 0 ? candidate.gap / totalGap : 1 / candidates.length
    const estimatedAmount = Math.min(positiveCash, candidate.investBudget * budgetShare)
    const quantity = estimatedAmount / candidate.currentPrice

    return {
      instrumentCode: candidate.allocation.instrumentCode,
      action: quantity > 0 ? 'buy' : 'hold',
      quantity,
      estimatedPrice: candidate.currentPrice,
      estimatedAmount,
      rationale: `drawdown=${(candidate.drawdown * 100).toFixed(2)}%, ddRatio=${candidate.ddRatio.toFixed(2)}, currentWeight=${(
        candidate.currentWeight * 100
      ).toFixed(2)}%, targetWeight=${(candidate.allocation.targetWeight * 100).toFixed(2)}%, multiplier=${candidate.multiplier.toFixed(2)}`,
    }
  })
}
