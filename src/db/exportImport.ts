import { z } from 'zod'
import { DEFAULT_UI_PREFERENCE } from '../config/defaults'
import { db } from './database'
import type { AppDataExport } from '../types/models'

const importSchema = z.object({
  schemaVersion: z.literal(1),
  exportedAt: z.string(),
  profiles: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      market: z.enum(['us', 'cn']),
      baseCurrency: z.enum(['USD', 'CNY']),
      createdAt: z.string(),
      updatedAt: z.string(),
    }),
  ),
  initialHoldings: z.array(
    z.object({
      id: z.string(),
      profileId: z.string(),
      instrumentCode: z.string(),
      quantity: z.number(),
      acquiredAt: z.string(),
    }),
  ),
  cashflows: z.array(
    z.object({
      id: z.string(),
      profileId: z.string(),
      date: z.string(),
      amount: z.number(),
      note: z.string().optional(),
    }),
  ),
  trades: z.array(
    z.object({
      id: z.string(),
      profileId: z.string(),
      date: z.string(),
      instrumentCode: z.string(),
      side: z.enum(['buy', 'sell']),
      quantity: z.number(),
      price: z.number().nullable().optional(),
      note: z.string().optional(),
    }),
  ),
  targetAllocations: z.array(
    z.object({
      profileId: z.string(),
      instrumentCode: z.string(),
      targetWeight: z.number(),
    }),
  ),
  strategyConfigs: z.array(
    z.object({
      profileId: z.string(),
      expectedAnnualReturn: z.number(),
      maxDrawdown: z.number(),
      baseDailyInvestRate: z.number(),
      baseDailyInvestRateMode: z
        .enum(['fixed_1_252', 'naive', 'kelly_variant'])
        .optional(),
      acceptableMaxDrawdown: z.number().optional(),
      volatilityLookbackDays: z.number().int().optional(),
      kellyFraction: z.number().optional(),
      feeRate: z.number().optional(),
      slippageRate: z.number().optional(),
      lotSizeRuleByInstrument: z
        .record(z.string(), z.enum(['fractional', 'integer', 'lot100']))
        .optional(),
      buyScaleMin: z.number(),
      buyScaleMax: z.number(),
      sellEnabled: z.boolean(),
      manualOverrideEnabled: z.boolean(),
      instrumentOverrides: z
        .record(
          z.string(),
          z.object({
            expectedAnnualReturn: z.number().optional(),
            maxDrawdown: z.number().optional(),
            feeRate: z.number().optional(),
            slippageRate: z.number().optional(),
            lotSizeRule: z.enum(['fractional', 'integer', 'lot100']).optional(),
          }),
        )
        .optional(),
    }),
  ),
  backtestConfigs: z.array(
    z.object({
      profileId: z.string(),
      startDate: z.string(),
      endDate: z.string(),
      useOpenPrice: z.boolean(),
    }),
  ),
  uiPreference: z
    .object({
      id: z.string(),
      defaultCurrency: z.enum(['USD', 'CNY']),
      fxUsdToCny: z.number(),
      showCashInAreaChart: z.boolean(),
      language: z.enum(['auto', 'zh-CN', 'en-US']).optional(),
      globalExpectedAnnualReturn: z.number().optional(),
      globalMaxDrawdown: z.number().optional(),
      defaultLotSizeRuleByMarket: z
        .object({
          us: z.enum(['fractional', 'integer', 'lot100']),
          cn: z.enum(['fractional', 'integer', 'lot100']),
        })
        .optional(),
    })
    .nullable(),
})

export const exportAllData = async (): Promise<AppDataExport> => ({
  schemaVersion: 1,
  exportedAt: new Date().toISOString(),
  profiles: await db.profiles.toArray(),
  initialHoldings: await db.initialHoldings.toArray(),
  cashflows: await db.cashflows.toArray(),
  trades: await db.trades.toArray(),
  targetAllocations: await db.targetAllocations.toArray(),
  strategyConfigs: await db.strategyConfigs.toArray(),
  backtestConfigs: await db.backtestConfigs.toArray(),
  uiPreference: (await db.uiPreferences.get('default')) ?? null,
})

const tables = [
  db.profiles,
  db.initialHoldings,
  db.cashflows,
  db.trades,
  db.targetAllocations,
  db.strategyConfigs,
  db.backtestConfigs,
  db.uiPreferences,
] as const

export const importAllData = async (
  raw: unknown,
  mode: 'overwrite' | 'append',
) => {
  const parsed = importSchema.parse(raw)

  await db.transaction('rw', tables, async () => {
    if (mode === 'overwrite') {
      await Promise.all(tables.map((table) => table.clear()))
    }

    await db.profiles.bulkPut(parsed.profiles)
    await db.initialHoldings.bulkPut(parsed.initialHoldings)
    await db.cashflows.bulkPut(parsed.cashflows)
    await db.trades.bulkPut(parsed.trades)
    await db.targetAllocations.bulkPut(parsed.targetAllocations)
    await db.strategyConfigs.bulkPut(parsed.strategyConfigs)
    await db.backtestConfigs.bulkPut(parsed.backtestConfigs)
    if (parsed.uiPreference) {
      await db.uiPreferences.put({
        ...DEFAULT_UI_PREFERENCE,
        ...parsed.uiPreference,
        defaultLotSizeRuleByMarket: {
          ...DEFAULT_UI_PREFERENCE.defaultLotSizeRuleByMarket,
          ...(parsed.uiPreference.defaultLotSizeRuleByMarket ?? {}),
        },
      })
    }
  })
}
