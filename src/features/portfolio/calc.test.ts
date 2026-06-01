import { describe, expect, it } from 'vitest'
import { buildHistoricalAssetSeries } from './calc'

describe('buildHistoricalAssetSeries', () => {
  it('applies cashflow on non-trading day to next trading day and onward', () => {
    const points = buildHistoricalAssetSeries({
      cashflows: [{ id: 'c1', profileId: 'p1', date: '2025-01-01', amount: 10000 }],
      trades: [],
      initialHoldings: [],
      marketData: {
        QQQM: [
          { date: '2025-01-02', close: 210 },
          { date: '2025-01-03', close: 211 },
        ],
      },
    })

    expect(points).toHaveLength(3)
    expect(points[0]).toMatchObject({ date: '2025-01-01', cash: 10000 })
    expect(points[1]).toMatchObject({ date: '2025-01-02', cash: 10000 })
    expect(points[2]).toMatchObject({ date: '2025-01-03', cash: 10000 })
  })
})
