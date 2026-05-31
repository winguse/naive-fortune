export type Market = 'us' | 'cn'
export type Currency = 'USD' | 'CNY'

export interface Instrument {
  code: string
  market: Market
  displayName: string
  currency: Currency
  dataPath: string
}

export interface Profile {
  id: string
  name: string
  market: Market
  baseCurrency: Currency
  createdAt: string
  updatedAt: string
}

export interface CashflowRecord {
  id: string
  profileId: string
  date: string
  amount: number
  note?: string
}

export interface TradeRecord {
  id: string
  profileId: string
  date: string
  instrumentCode: string
  side: 'buy' | 'sell'
  quantity: number
  price?: number | null
  note?: string
}

export interface InitialHolding {
  id: string
  profileId: string
  instrumentCode: string
  quantity: number
  acquiredAt: string
}

export interface TargetAllocation {
  profileId: string
  instrumentCode: string
  targetWeight: number
}

export interface StrategyConfig {
  profileId: string
  expectedAnnualReturn: number
  maxDrawdown: number
  baseDailyInvestRate: number
  buyScaleMin: number
  buyScaleMax: number
  sellEnabled: boolean
  manualOverrideEnabled: boolean
}

export interface BacktestConfig {
  profileId: string
  startDate: string
  endDate: string
  initialCash: number
  recurringCashflows: number
  useOpenPrice: boolean
  feeRate: number
  slippageRate: number
}

export interface UiPreference {
  id: string
  defaultCurrency: Currency
  fxUsdToCny: number
  showCashInAreaChart: boolean
}

export interface MarketCandle {
  date: string
  close: number
  open?: number | null
}

export interface AppDataExport {
  schemaVersion: 1
  exportedAt: string
  profiles: Profile[]
  initialHoldings: InitialHolding[]
  cashflows: CashflowRecord[]
  trades: TradeRecord[]
  targetAllocations: TargetAllocation[]
  strategyConfigs: StrategyConfig[]
  backtestConfigs: BacktestConfig[]
  uiPreference: UiPreference | null
}
