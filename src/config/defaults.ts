import dayjs from 'dayjs'
import type { BacktestConfig, StrategyConfig, UiPreference } from '../types/models'

export const DEFAULT_UI_PREFERENCE: UiPreference = {
  id: 'default',
  defaultCurrency: 'CNY',
  fxUsdToCny: 7.2,
  showCashInAreaChart: false,
}

export const createDefaultStrategyConfig = (profileId: string): StrategyConfig => ({
  profileId,
  expectedAnnualReturn: 0.08,
  maxDrawdown: 0.3,
  baseDailyInvestRate: 1 / 252,
  buyScaleMin: 0.5,
  buyScaleMax: 3,
  sellEnabled: false,
  manualOverrideEnabled: false,
})

export const createDefaultBacktestConfig = (profileId: string): BacktestConfig => ({
  profileId,
  startDate: dayjs().subtract(1, 'year').format('YYYY-MM-DD'),
  endDate: dayjs().format('YYYY-MM-DD'),
  initialCash: 10000,
  recurringCashflows: 0,
  useOpenPrice: false,
  feeRate: 0.0005,
  slippageRate: 0.0005,
  lotSizeRuleByInstrument: {},
})
