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
        useOpenPrice: false,
      },
      allocations: [
        { profileId: 'p1', instrumentCode: 'FXAIX', targetWeight: 1 },
      ],
      strategy: {
        profileId: 'p1',
        expectedAnnualReturn: 0.08,
        maxDrawdown: 0.3,
        baseDailyInvestRate: 1,
        feeRate: 0,
        slippageRate: 0,
        buyScaleMin: 0.5,
        buyScaleMax: 3,
        sellEnabled: false,
        manualOverrideEnabled: false,
        targetCashRatio: 0,
        totalPlannedPeriods: 252,
      },
      // 1000 prior to start; 100 on 2024-01-01 and 100 on 2024-01-02 within window
      cashflows: [
        { id: 'c0', profileId: 'p1', date: '2023-12-31', amount: 1000 },
        { id: 'c1', profileId: 'p1', date: '2024-01-01', amount: 100 },
        { id: 'c2', profileId: 'p1', date: '2024-01-02', amount: 100 },
      ],
    })

    expect(result.points).toHaveLength(2)
    expect(result.totalInvested).toBe(1200)
    expect(Number.isFinite(result.maxDrawdown)).toBe(true)
  })

  it('includes dated cashflow records during backtest period', () => {
    const result = runSimpleBacktest({
      prices: {
        FXAIX: [
          { date: '2025-01-02', close: 100, open: 100 },
          { date: '2025-01-03', close: 100, open: 100 },
        ],
      },
      config: {
        profileId: 'p1',
        startDate: '2025-01-01',
        endDate: '2025-01-03',
        useOpenPrice: false,
      },
      allocations: [
        { profileId: 'p1', instrumentCode: 'FXAIX', targetWeight: 1 },
      ],
      strategy: {
        profileId: 'p1',
        expectedAnnualReturn: 0.08,
        maxDrawdown: 0.3,
        baseDailyInvestRate: 0,
        feeRate: 0,
        slippageRate: 0,
        buyScaleMin: 1,
        buyScaleMax: 1,
        sellEnabled: false,
        manualOverrideEnabled: false,
        targetCashRatio: 0,
        totalPlannedPeriods: 250,
      },
      cashflows: [
        { id: 'c1', profileId: 'p1', date: '2025-01-01', amount: 10000 },
      ],
    })

    expect(result.points).toHaveLength(2)
    expect(result.points[0].date).toBe('2025-01-02')
    // 10000 / 250 = 40. 10000 - 40 = 9960.
    expect(result.points[0].cash).toBe(9960)
    expect(result.totalInvested).toBe(10000)
    expect(result.finalValue).toBeCloseTo(10000)
  })

  it('applies drawdown multiplier', () => {
    const result = runSimpleBacktest({
      prices: {
        FXAIX: [
          { date: '2025-01-01', close: 100, open: 100 },
          { date: '2025-01-02', close: 50, open: 50 },
        ],
      },
      config: {
        profileId: 'p1',
        startDate: '2025-01-01',
        endDate: '2025-01-02',
        useOpenPrice: false,
      },
      allocations: [
        { profileId: 'p1', instrumentCode: 'FXAIX', targetWeight: 1 },
      ],
      strategy: {
        profileId: 'p1',
        expectedAnnualReturn: 0.08,
        maxDrawdown: 0.3,
        baseDailyInvestRate: 1 / 252,
        baseDailyInvestRateMode: 'fixed_1_252',
        buyScaleMin: 1,
        buyScaleMax: 3,
        sellEnabled: false,
        manualOverrideEnabled: false,
        targetCashRatio: 0,
        totalPlannedPeriods: 250,
      },
      cashflows: [
        { id: 'c1', profileId: 'p1', date: '2025-01-01', amount: 10000 },
      ],
    })

    expect(result.points[0].calculationDetails[0].multiplier).toBeCloseTo(1)
    expect(result.points[1].calculationDetails[0].multiplier).toBeCloseTo(3)
    // Day 0: Budget = 10000 / 250 = 40. Cash after = 9960.
    // Day 1: Budget = 9960 / 249 * 3 = 40 * 3 = 120.
    expect(result.points[1].calculationDetails[0].dailyAmount).toBeCloseTo(120)
  })

  it('records Kelly variant volatility and rate details without exhausting cash immediately', () => {
    const result = runSimpleBacktest({
      prices: {
        FXAIX: [
          { date: '2026-01-02', close: 100, open: 100 },
          { date: '2026-01-05', close: 101, open: 101 },
          { date: '2026-01-06', close: 99, open: 99 },
        ],
      },
      config: {
        profileId: 'p1',
        startDate: '2026-01-01',
        endDate: '2026-01-06',
        useOpenPrice: false,
      },
      allocations: [
        { profileId: 'p1', instrumentCode: 'FXAIX', targetWeight: 1 },
      ],
      strategy: {
        profileId: 'p1',
        expectedAnnualReturn: 0.08,
        maxDrawdown: 0.3,
        baseDailyInvestRate: 1 / 252,
        baseDailyInvestRateMode: 'kelly_variant',
        volatilityLookbackDays: 3,
        feeRate: 0,
        slippageRate: 0,
        buyScaleMin: 1,
        buyScaleMax: 1,
        sellEnabled: false,
        manualOverrideEnabled: false,
        targetCashRatio: 0,
        totalPlannedPeriods: 250,
      },
      cashflows: [
        { id: 'c1', profileId: 'p1', date: '2026-01-01', amount: 10000 },
      ],
    })

    const lastDetail = result.points[2].calculationDetails[0]
    expect(lastDetail.rate).toBeGreaterThan(0)
    expect(lastDetail.rate).toBeLessThan(1)
    expect(result.points[0].cash).toBe(10000)
    expect(result.points[2].cash).toBeGreaterThan(0)
  })

  it('does not let old pending budget spend a new cashflow before its own DCA budget accrues', () => {
    const result = runSimpleBacktest({
      prices: {
        FXAIX: [
          { date: '2026-02-02', close: 100, open: 100 },
          { date: '2026-02-03', close: 100, open: 100 },
          { date: '2026-02-04', close: 100, open: 100 },
          { date: '2026-02-05', close: 100, open: 100 },
          { date: '2026-02-06', close: 100, open: 100 },
        ],
      },
      config: {
        profileId: 'p1',
        startDate: '2026-02-02',
        endDate: '2026-02-06',
        useOpenPrice: false,
      },
      allocations: [
        { profileId: 'p1', instrumentCode: 'FXAIX', targetWeight: 1 },
      ],
      strategy: {
        profileId: 'p1',
        expectedAnnualReturn: 0.08,
        maxDrawdown: 0.25,
        baseDailyInvestRate: 1 / 252,
        baseDailyInvestRateMode: 'fixed_1_252',
        acceptableMaxDrawdown: 0,
        feeRate: 0,
        slippageRate: 0,
        lotSizeRuleByInstrument: { FXAIX: 'integer' },
        buyScaleMin: 1,
        buyScaleMax: 1,
        sellEnabled: false,
        manualOverrideEnabled: false,
        targetCashRatio: 0,
        totalPlannedPeriods: 25000, // Very large to make budget small
      },
      cashflows: [
        { id: 'c1', profileId: 'p1', date: '2026-02-02', amount: 1000 },
        { id: 'c2', profileId: 'p1', date: '2026-02-05', amount: 100 },
      ],
    })

    // Budget = 1000 / 25000 = 0.04. 0.04 / 100 = 0.0004 -> quantity 0 for integer rule.
    expect(result.points[0].buyExecutions).toHaveLength(0)
    expect(result.points[0].calculationDetails[0].status).toBe('zero_quantity')
    expect(result.points[4].cash).toBe(1100)
  })

  it('triggers rebalance sell when overweight', () => {
    const result = runSimpleBacktest({
      prices: {
        FXAIX: [
          { date: '2024-01-01', close: 100 },
          { date: '2024-01-02', close: 1000 }, // 10x price!
        ],
      },
      config: {
        profileId: 'p1',
        startDate: '2024-01-01',
        endDate: '2024-01-02',
        useOpenPrice: false,
      },
      allocations: [
        { profileId: 'p1', instrumentCode: 'FXAIX', targetWeight: 1 },
      ],
      strategy: {
        profileId: 'p1',
        expectedAnnualReturn: 0.08,
        maxDrawdown: 0.3,
        baseDailyInvestRate: 1,
        feeRate: 0,
        slippageRate: 0,
        buyScaleMin: 1,
        buyScaleMax: 1,
        sellEnabled: true,
        manualOverrideEnabled: false,
        targetCashRatio: 0.1, // 10% cash
        totalPlannedPeriods: 1, // Spend all on Day 0
      },
      cashflows: [
        { id: 'c1', profileId: 'p1', date: '2023-12-31', amount: 10000 },
      ],
    })

    // Day 0: Bought 90 shares at 100. Cash=1000. NAV=10000.
    // Day 1: Price=1000. MV=90000. Cash=1000. NAV=91000.
    // Weight = 90000/91000 = 0.989. Target = 0.9.
    // Gap = 0.9 - 0.989 = -0.089. Trigger SELL.
    expect(result.points[1].sellExecutions).toHaveLength(1)
    expect(result.points[1].sellExecutions[0].quantity).toBeGreaterThan(0)
  })
})
