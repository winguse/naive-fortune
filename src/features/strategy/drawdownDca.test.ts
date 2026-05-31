import { describe, expect, it } from 'vitest'
import { createDrawdownAdjustedSuggestions } from './drawdownDca'

describe('createDrawdownAdjustedSuggestions', () => {
  it('creates buy suggestions for underweight targets with cash', () => {
    const result = createDrawdownAdjustedSuggestions({
      snapshot: {
        date: '2024-01-02',
        holdings: { FXAIX: 10 },
        prices: { FXAIX: 100, QQQM: 50 },
        marketValueByInstrument: { FXAIX: 1000, QQQM: 0 },
        totalMarketValue: 1000,
        cash: 1000,
      },
      strategy: {
        profileId: 'p1',
        expectedAnnualReturn: 0.08,
        maxDrawdown: 0.3,
        baseDailyInvestRate: 1 / 252,
        buyScaleMin: 0.5,
        buyScaleMax: 3,
        sellEnabled: false,
        manualOverrideEnabled: false,
      },
      allocations: [
        { profileId: 'p1', instrumentCode: 'FXAIX', targetWeight: 0.3 },
        { profileId: 'p1', instrumentCode: 'QQQM', targetWeight: 0.7 },
      ],
      marketData: {
        FXAIX: [
          { date: '2024-01-01', close: 110 },
          { date: '2024-01-02', close: 100 },
        ],
        QQQM: [
          { date: '2024-01-01', close: 60 },
          { date: '2024-01-02', close: 50 },
        ],
      },
    })

    expect(result.length).toBeGreaterThan(0)
    expect(result[0].action).toBe('buy')
    expect(result.some((item) => item.instrumentCode === 'QQQM')).toBe(true)
  })
})
