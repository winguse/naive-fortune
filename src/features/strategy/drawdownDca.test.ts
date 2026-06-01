import { describe, expect, it } from 'vitest'
import {
  calcTrailingVolatility,
  createDrawdownAdjustedSuggestions,
  deriveSubAccountsFromCashflows,
  resolveBaseDailyInvestRate,
  resolveBaseDailyInvestRateDetails,
} from './drawdownDca'

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

  it('derives sub-account markers from cashflows and proportional withdrawals', () => {
    const accounts = deriveSubAccountsFromCashflows([
      { id: 'c1', profileId: 'p1', date: '2024-01-01', amount: 10000 },
      { id: 'c2', profileId: 'p1', date: '2024-01-05', amount: 5000 },
      { id: 'c3', profileId: 'p1', date: '2024-01-10', amount: -3000 },
    ])

    expect(accounts).toHaveLength(2)
    expect(accounts[0].label).toBe('Plan A')
    expect(accounts[1].label).toBe('Plan B')
    expect(
      accounts[0].currentPrincipal + accounts[1].currentPrincipal,
    ).toBeCloseTo(12000)
  })

  it('uses static principal budgeting for fixed strategy with cashflows', () => {
    const result = createDrawdownAdjustedSuggestions({
      snapshot: {
        date: '2024-01-02',
        holdings: {},
        prices: { FXAIX: 100 },
        marketValueByInstrument: { FXAIX: 0 },
        totalMarketValue: 0,
        cash: 20000,
      },
      strategy: {
        profileId: 'p1',
        expectedAnnualReturn: 0.08,
        maxDrawdown: 0.3,
        baseDailyInvestRate: 1 / 252,
        baseDailyInvestRateMode: 'fixed_1_252',
        acceptableMaxDrawdown: 0,
        volatilityLookbackDays: 20,
        buyScaleMin: 1,
        buyScaleMax: 1,
        sellEnabled: false,
        manualOverrideEnabled: false,
      },
      allocations: [
        { profileId: 'p1', instrumentCode: 'FXAIX', targetWeight: 1 },
      ],
      marketData: {
        FXAIX: [
          { date: '2024-01-01', close: 100 },
          { date: '2024-01-02', close: 100 },
        ],
      },
      cashflows: [
        { id: 'c1', profileId: 'p1', date: '2024-01-01', amount: 10000 },
        { id: 'c2', profileId: 'p1', date: '2024-01-02', amount: 5000 },
      ],
    })

    expect(result[0].estimatedAmount).toBeCloseTo(15000 / 252, 6)
  })

  it('uses initial principal (not remaining) for fixed_1_252 after withdrawal', () => {
    const result = createDrawdownAdjustedSuggestions({
      snapshot: {
        date: '2024-01-02',
        holdings: {},
        prices: { FXAIX: 100 },
        marketValueByInstrument: { FXAIX: 0 },
        totalMarketValue: 0,
        cash: 12000,
      },
      strategy: {
        profileId: 'p1',
        expectedAnnualReturn: 0.08,
        maxDrawdown: 0.3,
        baseDailyInvestRate: 1 / 252,
        baseDailyInvestRateMode: 'fixed_1_252',
        acceptableMaxDrawdown: 0,
        volatilityLookbackDays: 20,
        buyScaleMin: 1,
        buyScaleMax: 1,
        sellEnabled: false,
        manualOverrideEnabled: false,
      },
      allocations: [
        { profileId: 'p1', instrumentCode: 'FXAIX', targetWeight: 1 },
      ],
      marketData: {
        FXAIX: [
          { date: '2024-01-01', close: 100 },
          { date: '2024-01-02', close: 100 },
        ],
      },
      cashflows: [
        { id: 'c1', profileId: 'p1', date: '2024-01-01', amount: 10000 },
        { id: 'c2', profileId: 'p1', date: '2024-01-05', amount: 5000 },
        { id: 'c3', profileId: 'p1', date: '2024-01-10', amount: -3000 },
      ],
    })

    expect(result[0].estimatedAmount).toBeCloseTo(15000 / 252, 6)
  })

  it('uses total-asset budgeting for kelly strategy', () => {
    const result = createDrawdownAdjustedSuggestions({
      snapshot: {
        date: '2024-01-02',
        holdings: { FXAIX: 10 },
        prices: { FXAIX: 100 },
        marketValueByInstrument: { FXAIX: 1000 },
        totalMarketValue: 1000,
        cash: 9000,
      },
      strategy: {
        profileId: 'p1',
        expectedAnnualReturn: 0.1,
        maxDrawdown: 0.3,
        baseDailyInvestRate: 1 / 252,
        baseDailyInvestRateMode: 'kelly_variant',
        acceptableMaxDrawdown: 0,
        volatilityLookbackDays: 3,
        buyScaleMin: 1,
        buyScaleMax: 1,
        sellEnabled: false,
        manualOverrideEnabled: false,
      },
      allocations: [
        { profileId: 'p1', instrumentCode: 'FXAIX', targetWeight: 1 },
      ],
      marketData: {
        FXAIX: [
          { date: '2024-01-01', close: 100 },
          { date: '2024-01-02', close: 105 },
          { date: '2024-01-03', close: 95 },
        ],
      },
      cashflows: [
        { id: 'c1', profileId: 'p1', date: '2024-01-01', amount: 10000 },
      ],
    })

    expect(result[0].estimatedAmount).toBeGreaterThan(0)
    expect(result[0].estimatedAmount).toBeLessThanOrEqual(9000)
  })

  it('resolves base daily invest rate with naive mode', () => {
    const rate = resolveBaseDailyInvestRate({
      strategy: {
        profileId: 'p1',
        expectedAnnualReturn: 0.12,
        maxDrawdown: 0.3,
        baseDailyInvestRate: 1 / 252,
        baseDailyInvestRateMode: 'naive',
        acceptableMaxDrawdown: 0.05,
        volatilityLookbackDays: 20,
        buyScaleMin: 0.5,
        buyScaleMax: 3,
        sellEnabled: false,
        manualOverrideEnabled: false,
      },
      expectedAnnualReturn: 0.12,
      maxDrawdown: 0.3,
      candles: [
        { date: '2024-01-01', close: 100 },
        { date: '2024-01-02', close: 101 },
      ],
    })

    expect(rate).toBeCloseTo(0.12 / 252 / (0.3 - 0.05), 8)
  })

  it('calculates trailing N-day volatility from N log returns', () => {
    const candles = [
      { date: '2024-01-01', close: 100 },
      { date: '2024-01-02', close: 102 },
      { date: '2024-01-03', close: 99 },
      { date: '2024-01-04', close: 104 },
      { date: '2024-01-05', close: 101 },
    ]

    const volatility = calcTrailingVolatility(candles, 3)
    const trailingWindow = candles.slice(-4)
    const returns = trailingWindow
      .slice(1)
      .map((row, index) => Math.log(row.close / trailingWindow[index].close))
    const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length
    const expectedVolatility = Math.sqrt(
      returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
        (returns.length - 1),
    )

    expect(volatility).toBeCloseTo(expectedVolatility, 8)
  })

  it('resolves base daily invest rate with kelly variant mode', () => {
    const candles = [
      { date: '2024-01-01', close: 100 },
      { date: '2024-01-02', close: 102 },
      { date: '2024-01-03', close: 101 },
      { date: '2024-01-04', close: 103 },
      { date: '2024-01-05', close: 102 },
    ]
    const details = resolveBaseDailyInvestRateDetails({
      strategy: {
        profileId: 'p1',
        expectedAnnualReturn: 0.1,
        maxDrawdown: 0.3,
        baseDailyInvestRate: 1 / 252,
        baseDailyInvestRateMode: 'kelly_variant',
        acceptableMaxDrawdown: 0,
        volatilityLookbackDays: 5,
        buyScaleMin: 0.5,
        buyScaleMax: 3,
        sellEnabled: false,
        manualOverrideEnabled: false,
      },
      expectedAnnualReturn: 0.1,
      maxDrawdown: 0.3,
      candles,
    })
    const rate = resolveBaseDailyInvestRate({
      strategy: {
        profileId: 'p1',
        expectedAnnualReturn: 0.1,
        maxDrawdown: 0.3,
        baseDailyInvestRate: 1 / 252,
        baseDailyInvestRateMode: 'kelly_variant',
        acceptableMaxDrawdown: 0,
        volatilityLookbackDays: 5,
        buyScaleMin: 0.5,
        buyScaleMax: 3,
        sellEnabled: false,
        manualOverrideEnabled: false,
      },
      expectedAnnualReturn: 0.1,
      maxDrawdown: 0.3,
      candles,
    })

    const returns = candles
      .slice(1)
      .map((row, index) => Math.log(row.close / candles[index].close))
    const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length
    const volatility = Math.sqrt(
      returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
        (returns.length - 1),
    )
    const fullKellyFraction = 0.1 / 252 / volatility ** 2
    const rawDailyRate = (fullKellyFraction * 0.25) / 252
    expect(details.kellyFraction).toBe(0.25)
    expect(details.trailingVolatility).toBeCloseTo(volatility, 8)
    expect(details.rawRate).toBeCloseTo(rawDailyRate, 8)
    expect(rate).toBeCloseTo(rawDailyRate, 8)
    expect(rate).toBeGreaterThanOrEqual(0)
    expect(rate).toBeLessThanOrEqual(1)
  })

  it('applies configured fractional Kelly K without base rate cap', () => {
    const candles = [
      { date: '2024-01-01', close: 100 },
      { date: '2024-01-02', close: 100.5 },
      { date: '2024-01-03', close: 100 },
      { date: '2024-01-04', close: 100.5 },
      { date: '2024-01-05', close: 100 },
    ]
    const details = resolveBaseDailyInvestRateDetails({
      strategy: {
        profileId: 'p1',
        expectedAnnualReturn: 0.1,
        maxDrawdown: 0.3,
        baseDailyInvestRate: 1 / 252,
        baseDailyInvestRateMode: 'kelly_variant',
        acceptableMaxDrawdown: 0,
        volatilityLookbackDays: 5,
        kellyFraction: 0.5,
        buyScaleMin: 0.5,
        buyScaleMax: 3,
        sellEnabled: false,
        manualOverrideEnabled: false,
      },
      expectedAnnualReturn: 0.1,
      maxDrawdown: 0.3,
      candles,
    })

    expect(details.kellyFraction).toBe(0.5)
    expect(details.rate).toBeCloseTo(details.rawRate, 8)
    expect(details.rate).toBeGreaterThan(1 / 252)
  })
})
