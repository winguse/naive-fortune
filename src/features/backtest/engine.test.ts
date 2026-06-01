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
        buyScaleMin: 0.5,
        buyScaleMax: 3,
        sellEnabled: false,
        manualOverrideEnabled: false,
      },
      cashflows: [
        { id: 'c1', profileId: 'p1', date: '2025-01-01', amount: 10000 },
      ],
    })

    expect(result.points).toHaveLength(2)
    expect(result.points[0].date).toBe('2025-01-02')
    expect(result.points[0].cash).toBe(9980.15873015873)
    expect(result.totalInvested).toBe(10000)
    expect(result.finalValue).toBeCloseTo(10000)
  })

  it('applies drawdown multiplier', () => {
    // With 50% drawdown, the multiplier should be larger on the second day.
    // Price goes 100 -> 50 (50% drawdown).
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
      },
      cashflows: [
        { id: 'c1', profileId: 'p1', date: '2025-01-01', amount: 10000 },
      ],
    })

    expect(result.points[0].calculationDetails[0].multiplier).toBeCloseTo(1)
    expect(result.points[1].calculationDetails[0].multiplier).toBeCloseTo(3)
    expect(result.points[1].calculationDetails[0].spendBudget).toBeCloseTo(
      (10000 / 252) * 3,
    )
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
      },
      cashflows: [
        { id: 'c1', profileId: 'p1', date: '2026-01-01', amount: 10000 },
      ],
    })

    const lastDetail = result.points[2].calculationDetails[0]
    expect(lastDetail.trailingVolatility).toBeGreaterThan(0)
    expect(lastDetail.rate).toBeGreaterThan(0)
    expect(lastDetail.rate).toBeLessThan(1)
    expect(result.points[0].cash).toBe(10000)
    expect(result.points[2].cash).toBeGreaterThan(0)
  })

  it('scales sub-account principals proportionally after cash-out', () => {
    const result = runSimpleBacktest({
      prices: {
        FXAIX: [
          { date: '2026-03-02', close: 100000, open: 100000 },
          { date: '2026-03-03', close: 100000, open: 100000 },
        ],
      },
      config: {
        profileId: 'p1',
        startDate: '2026-03-02',
        endDate: '2026-03-03',
        useOpenPrice: false,
      },
      allocations: [
        { profileId: 'p1', instrumentCode: 'FXAIX', targetWeight: 1 },
      ],
      strategy: {
        profileId: 'p1',
        expectedAnnualReturn: 31.5,
        maxDrawdown: 0.25,
        baseDailyInvestRate: 1 / 252,
        baseDailyInvestRateMode: 'naive',
        acceptableMaxDrawdown: 0,
        feeRate: 0,
        slippageRate: 0,
        lotSizeRuleByInstrument: { FXAIX: 'integer' },
        buyScaleMin: 1,
        buyScaleMax: 1,
        sellEnabled: false,
        manualOverrideEnabled: false,
      },
      cashflows: [
        { id: 'c1', profileId: 'p1', date: '2026-03-02', amount: 1000 },
        { id: 'c2', profileId: 'p1', date: '2026-03-02', amount: 1000 },
        { id: 'c3', profileId: 'p1', date: '2026-03-03', amount: -1000 },
      ],
    })

    expect(result.points[0].calculationDetails[0].budgetBase).toBeCloseTo(2000)
    expect(result.points[0].calculationDetails[0].dailyAmount).toBeCloseTo(1000)
    expect(result.points[1].calculationDetails[0].budgetBase).toBeCloseTo(1000)
    expect(result.points[1].calculationDetails[0].dailyAmount).toBeCloseTo(500)
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
        expectedAnnualReturn: 31.752,
        maxDrawdown: 0.25,
        baseDailyInvestRate: 1 / 252,
        baseDailyInvestRateMode: 'naive',
        acceptableMaxDrawdown: 0,
        feeRate: 0,
        slippageRate: 0,
        lotSizeRuleByInstrument: { FXAIX: 'integer' },
        buyScaleMin: 1,
        buyScaleMax: 1,
        sellEnabled: false,
        manualOverrideEnabled: false,
      },
      cashflows: [
        { id: 'c1', profileId: 'p1', date: '2026-02-02', amount: 1000 },
        { id: 'c2', profileId: 'p1', date: '2026-02-05', amount: 100 },
      ],
    })

    expect(result.points[0].buyExecutions[0].quantity).toBe(5)
    expect(result.points[1].buyExecutions[0].quantity).toBe(5)
    expect(result.points[3].buyExecutions).toHaveLength(0)
    expect(result.points[3].calculationDetails[0].status).toBe('zero_quantity')
    expect(result.points[3].cash).toBe(100)
    expect(result.points[4].buyExecutions[0].quantity).toBe(1)
    expect(result.points[4].calculationDetails[0].status).toBe('bought')
    expect(result.points[4].cash).toBe(0)
  })
})
