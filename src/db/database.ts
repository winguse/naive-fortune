import Dexie, { type Table } from 'dexie'
import type {
  BacktestConfig,
  CashflowRecord,
  InitialHolding,
  Profile,
  StrategyConfig,
  TargetAllocation,
  TradeRecord,
  UiPreference,
} from '../types/models'

class NaiveFortuneDB extends Dexie {
  profiles!: Table<Profile, string>
  initialHoldings!: Table<InitialHolding, string>
  cashflows!: Table<CashflowRecord, string>
  trades!: Table<TradeRecord, string>
  targetAllocations!: Table<TargetAllocation, [string, string]>
  strategyConfigs!: Table<StrategyConfig, string>
  backtestConfigs!: Table<BacktestConfig, string>
  uiPreferences!: Table<UiPreference, string>

  constructor() {
    super('naive-fortune-db')
    this.version(1).stores({
      profiles: 'id, market, updatedAt',
      initialHoldings: 'id, profileId, instrumentCode, acquiredAt',
      cashflows: 'id, profileId, date',
      trades: 'id, profileId, date, instrumentCode',
      targetAllocations: '[profileId+instrumentCode], profileId, instrumentCode',
      strategyConfigs: 'profileId',
      backtestConfigs: 'profileId',
      uiPreferences: 'id',
    })
  }
}

export const db = new NaiveFortuneDB()
