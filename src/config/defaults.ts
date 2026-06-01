import dayjs from 'dayjs'
import type {
  BacktestConfig,
  BacktestLotSizeRule,
  Market,
  StrategyConfig,
  UiPreference,
} from '../types/models'

export const defaultLotSizeRuleByMarket: Record<Market, BacktestLotSizeRule> = {
  us: 'fractional',
  cn: 'lot100',
}

export const DEFAULT_UI_PREFERENCE: UiPreference = {
  id: 'default',
  defaultCurrency: 'CNY',
  fxUsdToCny: 7.2,
  showCashInAreaChart: false,
  language: 'auto',
  globalExpectedAnnualReturn: 0.08,
  globalMaxDrawdown: 0.3,
  defaultLotSizeRuleByMarket,
}

export const createDefaultStrategyConfig = (
  profileId: string,
  overrides: Partial<
    Pick<StrategyConfig, 'expectedAnnualReturn' | 'maxDrawdown'>
  > = {},
): StrategyConfig => ({
  profileId,
  expectedAnnualReturn: overrides.expectedAnnualReturn ?? 0.08,
  maxDrawdown: overrides.maxDrawdown ?? 0.3,
  baseDailyInvestRate: 1 / 252,
  baseDailyInvestRateMode: 'fixed_1_252',
  acceptableMaxDrawdown: 0,
  volatilityLookbackDays: 20,
  kellyFraction: 0.25,
  feeRate: 0.0005,
  slippageRate: 0.0005,
  lotSizeRuleByInstrument: {},
  buyScaleMin: 0.5,
  buyScaleMax: 3,
  sellEnabled: false,
  manualOverrideEnabled: false,
  instrumentOverrides: {},
})

export const getDefaultLotSizeRuleForMarket = (
  market: Market,
): BacktestLotSizeRule => defaultLotSizeRuleByMarket[market] ?? 'fractional'

export const createDefaultBacktestConfig = (
  profileId: string,
  overrides: Partial<
    Pick<BacktestConfig, 'startDate' | 'endDate' | 'lotSizeRuleByInstrument'>
  > = {},
): BacktestConfig => ({
  profileId,
  startDate:
    overrides.startDate ?? dayjs().subtract(1, 'year').format('YYYY-MM-DD'),
  endDate: overrides.endDate ?? dayjs().format('YYYY-MM-DD'),
  useOpenPrice: false,
  lotSizeRuleByInstrument: overrides.lotSizeRuleByInstrument ?? {},
})
