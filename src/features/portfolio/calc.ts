import dayjs from 'dayjs'
import type {
  CashflowRecord,
  InitialHolding,
  MarketCandle,
  TargetAllocation,
  TradeRecord,
} from '../../types/models'

export interface PortfolioSnapshot {
  date: string
  holdings: Record<string, number>
  prices: Record<string, number>
  marketValueByInstrument: Record<string, number>
  totalMarketValue: number
  cash: number
}

export const getLatestPrice = (candles: MarketCandle[]) => candles[candles.length - 1]?.close ?? 0

export const buildPortfolioSnapshot = ({
  cashflows,
  trades,
  initialHoldings,
  marketData,
}: {
  cashflows: CashflowRecord[]
  trades: TradeRecord[]
  initialHoldings: InitialHolding[]
  marketData: Record<string, MarketCandle[]>
}): PortfolioSnapshot => {
  const holdings: Record<string, number> = {}
  let cash = cashflows.reduce((sum, row) => sum + row.amount, 0)

  for (const row of initialHoldings) {
    holdings[row.instrumentCode] = (holdings[row.instrumentCode] ?? 0) + row.quantity
  }

  const sortedTrades = [...trades].sort((a, b) => a.date.localeCompare(b.date))
  for (const trade of sortedTrades) {
    const price = trade.price ?? getLatestPrice(marketData[trade.instrumentCode] ?? [])
    const signedQty = trade.side === 'buy' ? trade.quantity : -trade.quantity
    holdings[trade.instrumentCode] = (holdings[trade.instrumentCode] ?? 0) + signedQty
    const signedCash = trade.side === 'buy' ? -1 : 1
    cash += signedCash * trade.quantity * price
  }

  const prices: Record<string, number> = {}
  const marketValueByInstrument: Record<string, number> = {}
  for (const [instrumentCode, quantity] of Object.entries(holdings)) {
    const candles = marketData[instrumentCode] ?? []
    const price = getLatestPrice(candles)
    prices[instrumentCode] = price
    marketValueByInstrument[instrumentCode] = quantity * price
  }

  const totalMarketValue = Object.values(marketValueByInstrument).reduce((sum, value) => sum + value, 0)
  const date =
    Object.values(marketData)
      .map((rows) => rows[rows.length - 1]?.date)
      .filter((item): item is string => Boolean(item))
      .sort()
      .at(-1) ?? dayjs().format('YYYY-MM-DD')

  return {
    date,
    holdings,
    prices,
    marketValueByInstrument,
    totalMarketValue,
    cash,
  }
}

export const buildWeightMap = (snapshot: PortfolioSnapshot, allocations: TargetAllocation[]) => {
  const total = snapshot.totalMarketValue + Math.max(snapshot.cash, 0)
  return Object.fromEntries(
    allocations.map((allocation) => {
      const current = snapshot.marketValueByInstrument[allocation.instrumentCode] ?? 0
      const currentWeight = total > 0 ? current / total : 0
      return [allocation.instrumentCode, currentWeight]
    }),
  )
}

export const buildHistoricalAssetSeries = ({
  cashflows,
  trades,
  initialHoldings,
  marketData,
}: {
  cashflows: CashflowRecord[]
  trades: TradeRecord[]
  initialHoldings: InitialHolding[]
  marketData: Record<string, MarketCandle[]>
}) => {
  const timeline = [...new Set(Object.values(marketData).flatMap((rows) => rows.map((row) => row.date)))].sort()
  const holdings: Record<string, number> = {}
  let cash = 0

  for (const row of initialHoldings) {
    holdings[row.instrumentCode] = (holdings[row.instrumentCode] ?? 0) + row.quantity
  }

  const orderedCashflows = [...cashflows].sort((a, b) => a.date.localeCompare(b.date))
  const orderedTrades = [...trades].sort((a, b) => a.date.localeCompare(b.date))

  return timeline.map((date) => {
    for (const row of orderedCashflows.filter((item) => item.date === date)) {
      cash += row.amount
    }

    for (const trade of orderedTrades.filter((item) => item.date === date)) {
      const marketPrice =
        marketData[trade.instrumentCode]?.find((row) => row.date === date)?.close ??
        getLatestPrice(marketData[trade.instrumentCode] ?? [])
      const price = trade.price ?? marketPrice
      const signedQty = trade.side === 'buy' ? trade.quantity : -trade.quantity
      holdings[trade.instrumentCode] = (holdings[trade.instrumentCode] ?? 0) + signedQty
      cash += (trade.side === 'buy' ? -1 : 1) * trade.quantity * price
    }

    const instrumentSeries: Record<string, number> = {}
    for (const [code, quantity] of Object.entries(holdings)) {
      const price =
        marketData[code]?.find((row) => row.date === date)?.close ?? getLatestPrice(marketData[code] ?? [])
      instrumentSeries[code] = quantity * price
    }

    return { date, cash, instrumentSeries }
  })
}
