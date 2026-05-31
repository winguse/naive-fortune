import { describe, expect, it } from 'vitest'
import { runSimpleBacktest } from './engine'

describe('runSimpleBacktest', () => {
  it('returns result metrics and timeline points', () => {
    const result = runSimpleBacktest({
      prices: {
        FXAIX: [
          { date: '2024-01-01', close: 100, open: 99 },
          { date: '2024-01-02', close: 101, open: 100 },
        ],
      },
      config: {
        profileId: 'p1',
        startDate: '2024-01-01',
        endDate: '2024-01-02',
        initialCash: 1000,
        recurringCashflows: 100,
        useOpenPrice: false,
        feeRate: 0,
        slippageRate: 0,
      },
      allocations: [{ profileId: 'p1', instrumentCode: 'FXAIX', targetWeight: 1 }],
      strategy: {
        profileId: 'p1',
        expectedAnnualReturn: 0.08,
        maxDrawdown: 0.3,
        baseDailyInvestRate: 1,
        buyScaleMin: 0.5,
        buyScaleMax: 3,
        sellEnabled: false,
        manualOverrideEnabled: false,
      },
    })

    expect(result.points).toHaveLength(2)
    expect(result.totalInvested).toBe(1200)
    expect(Number.isFinite(result.maxDrawdown)).toBe(true)
  })
})
