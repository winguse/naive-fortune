export type Market = 'us' | 'cn'
export type Currency = 'USD' | 'CNY'
export type Language = 'zh-CN' | 'en-US'

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
  baseDailyInvestRateMode?: 'fixed_1_252' | 'naive' | 'kelly_variant'
  acceptableMaxDrawdown?: number
  volatilityLookbackDays?: number
  kellyFraction?: number
  feeRate?: number
  slippageRate?: number
  lotSizeRuleByInstrument?: Record<string, BacktestLotSizeRule>
  buyScaleMin: number
  buyScaleMax: number
  sellEnabled: boolean
  manualOverrideEnabled: boolean
  instrumentOverrides?: Record<
    string,
    {
      expectedAnnualReturn?: number
      maxDrawdown?: number
      feeRate?: number
      slippageRate?: number
      lotSizeRule?: BacktestLotSizeRule
    }
  >
}

export interface BacktestConfig {
  profileId: string
  startDate: string
  endDate: string
  useOpenPrice: boolean
  lotSizeRuleByInstrument?: Record<string, BacktestLotSizeRule>
}

export type BacktestLotSizeRule = 'fractional' | 'integer' | 'lot100'

export interface UiPreference {
  id: string
  defaultCurrency: Currency
  fxUsdToCny: number
  showCashInAreaChart: boolean
  language: Language | 'auto'
  globalExpectedAnnualReturn: number
  globalMaxDrawdown: number
  defaultLotSizeRuleByMarket: Record<Market, BacktestLotSizeRule>
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
