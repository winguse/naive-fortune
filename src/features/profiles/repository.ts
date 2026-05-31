import dayjs from 'dayjs'
import { db } from '../../db/database'
import { createDefaultBacktestConfig, createDefaultStrategyConfig, DEFAULT_UI_PREFERENCE } from '../../config/defaults'
import { createId } from '../../lib/id'
import type { Currency, InitialHolding, Market, Profile, TargetAllocation } from '../../types/models'

export interface ProfileSeedInput {
  name: string
  market: Market
  baseCurrency: Currency
  initialCash: number
  initialCashDate: string
  holdings: Array<{ instrumentCode: string; quantity: number; acquiredAt: string }>
  allocations: Array<{ instrumentCode: string; targetWeight: number }>
}

export const listProfiles = async () => db.profiles.orderBy('updatedAt').reverse().toArray()

export const getProfileBundle = async (profileId: string) => {
  const [profile, cashflows, trades, initialHoldings, targetAllocations, strategy, backtest] = await Promise.all([
    db.profiles.get(profileId),
    db.cashflows.where('profileId').equals(profileId).toArray(),
    db.trades.where('profileId').equals(profileId).toArray(),
    db.initialHoldings.where('profileId').equals(profileId).toArray(),
    db.targetAllocations.where('profileId').equals(profileId).toArray(),
    db.strategyConfigs.get(profileId),
    db.backtestConfigs.get(profileId),
  ])

  return {
    profile,
    cashflows,
    trades,
    initialHoldings,
    targetAllocations,
    strategy,
    backtest,
  }
}

export const createProfileWithSeed = async (input: ProfileSeedInput) => {
  const now = dayjs().toISOString()
  const profile: Profile = {
    id: createId(),
    name: input.name,
    market: input.market,
    baseCurrency: input.baseCurrency,
    createdAt: now,
    updatedAt: now,
  }

  const holdings: InitialHolding[] = input.holdings.map((row) => ({
    id: createId(),
    profileId: profile.id,
    instrumentCode: row.instrumentCode,
    quantity: row.quantity,
    acquiredAt: row.acquiredAt,
  }))

  await db.transaction(
    'rw',
    [
      db.profiles,
      db.cashflows,
      db.initialHoldings,
      db.targetAllocations,
      db.strategyConfigs,
      db.backtestConfigs,
      db.uiPreferences,
    ],
    async () => {
      await db.profiles.add(profile)
      await db.cashflows.add({
        id: createId(),
        profileId: profile.id,
        date: input.initialCashDate,
        amount: input.initialCash,
        note: 'initial cash',
      })
      if (holdings.length > 0) {
        await db.initialHoldings.bulkAdd(holdings)
      }
      if (input.allocations.length > 0) {
        await db.targetAllocations.bulkPut(
          input.allocations.map<TargetAllocation>((row) => ({
            profileId: profile.id,
            instrumentCode: row.instrumentCode,
            targetWeight: row.targetWeight,
          })),
        )
      }
      await db.strategyConfigs.put(createDefaultStrategyConfig(profile.id))
      await db.backtestConfigs.put(createDefaultBacktestConfig(profile.id))
      const pref = await db.uiPreferences.get(DEFAULT_UI_PREFERENCE.id)
      if (!pref) {
        await db.uiPreferences.put(DEFAULT_UI_PREFERENCE)
      }
    },
  )

  return profile
}

export const deleteProfile = async (profileId: string) => {
  await db.transaction(
    'rw',
    [
      db.profiles,
      db.cashflows,
      db.trades,
      db.initialHoldings,
      db.targetAllocations,
      db.strategyConfigs,
      db.backtestConfigs,
    ],
    async () => {
      await db.profiles.delete(profileId)
      await db.cashflows.where('profileId').equals(profileId).delete()
      await db.trades.where('profileId').equals(profileId).delete()
      await db.initialHoldings.where('profileId').equals(profileId).delete()
      await db.targetAllocations.where('profileId').equals(profileId).delete()
      await db.strategyConfigs.delete(profileId)
      await db.backtestConfigs.delete(profileId)
    },
  )
}
