import type { MarketCandle, StrategyConfig, TargetAllocation, BacktestLotSizeRule } from '../../types/models'
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

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

export const createDrawdownAdjustedSuggestions = ({
  snapshot,
  strategy,
  allocations,
  marketData,
  elapsedTradingDaysSinceLastBuy = 1,
  lotSizeRuleByInstrument = {},
}: {
  snapshot: PortfolioSnapshot
  strategy: StrategyConfig
  allocations: TargetAllocation[]
  marketData: Record<string, MarketCandle[]>
  elapsedTradingDaysSinceLastBuy?: number
  lotSizeRuleByInstrument?: Record<string, BacktestLotSizeRule>
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
    const lotRule: BacktestLotSizeRule = lotSizeRuleByInstrument[candidate.allocation.instrumentCode] ?? 'fractional'
    const rawQuantity = estimatedAmount / candidate.currentPrice
    const quantity = applyLotSizeRule(rawQuantity, lotRule)

    let lotNote = ''
    if (lotRule !== 'fractional' && quantity === 0 && rawQuantity > 0) {
      const minLot = lotRule === 'lot100' ? 100 : 1
      const singleDayBudget = estimatedAmount / Math.max(elapsedTradingDaysSinceLastBuy, 1)
      const amountNeeded = minLot * candidate.currentPrice
      const extraDays = singleDayBudget > 0 ? Math.ceil((amountNeeded - estimatedAmount) / singleDayBudget) : 0
      lotNote = `，还需约 ${extraDays} 个交易日积累预算才能下单`
    } else if (lotRule !== 'fractional' && quantity > 0) {
      const remainderAmount = (rawQuantity - quantity) * candidate.currentPrice
      lotNote = `，余额约 ${remainderAmount.toFixed(2)} 继续积累`
    }

    return {
      instrumentCode: candidate.allocation.instrumentCode,
      action: quantity > 0 ? 'buy' : 'hold',
      quantity,
      estimatedPrice: candidate.currentPrice,
      estimatedAmount: quantity * candidate.currentPrice,
      rationale: `drawdown=${(candidate.drawdown * 100).toFixed(2)}%, ddRatio=${candidate.ddRatio.toFixed(2)}, currentWeight=${(
        candidate.currentWeight * 100
      ).toFixed(2)}%, targetWeight=${(candidate.allocation.targetWeight * 100).toFixed(2)}%, multiplier=${candidate.multiplier.toFixed(2)}${lotNote}`,
    }
  })
}
