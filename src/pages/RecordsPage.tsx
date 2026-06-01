import dayjs from 'dayjs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  createDefaultStrategyConfig,
  DEFAULT_UI_PREFERENCE,
} from '../config/defaults'
import { instrumentsByMarket } from '../config/instruments'
import { db } from '../db/database'
import { loadMarketDataBatch } from '../features/market-data/service'
import {
  deriveSubAccountsFromCashflows,
  resolveBaseDailyInvestRate,
} from '../features/strategy/drawdownDca'
import { isZh } from '../i18n/language'
import { createId } from '../lib/id'
import type { Market } from '../types/models'
import type {
  CashflowRecord,
  InitialHolding,
  MarketCandle,
  StrategyConfig,
  TargetAllocation,
  TradeRecord,
} from '../types/models'
import type { BacktestLotSizeRule } from '../types/models'

const isValidDate = (dateText: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(dateText) && dayjs(dateText).isValid()
type InstrumentStrategyDraft = {
  expectedAnnualReturn: string
  maxDrawdown: string
  lotSizeRule: string
}

export const RecordsPage = () => {
  const { profileId = '' } = useParams()
  const [market, setMarket] = useState<Market>('cn')
  const [cashflows, setCashflows] = useState<CashflowRecord[]>([])
  const [trades, setTrades] = useState<TradeRecord[]>([])
  const [holdings, setHoldings] = useState<InitialHolding[]>([])
  const [allocations, setAllocations] = useState<TargetAllocation[]>([])

  const [newCashflowDate, setNewCashflowDate] = useState(
    dayjs().format('YYYY-MM-DD'),
  )
  const [newCashflowAmount, setNewCashflowAmount] = useState('1000')
  const [cashflowAddError, setCashflowAddError] = useState('')

  const [newTradeDate, setNewTradeDate] = useState(dayjs().format('YYYY-MM-DD'))
  const [newTradeCode, setNewTradeCode] = useState('')
  const [newTradeQuantity, setNewTradeQuantity] = useState('1')
  const [newTradePrice, setNewTradePrice] = useState('')
  const [tradeAddError, setTradeAddError] = useState('')

  const [editingCashflowId, setEditingCashflowId] = useState<string | null>(
    null,
  )
  const [editingCashflowDate, setEditingCashflowDate] = useState('')
  const [editingCashflowAmount, setEditingCashflowAmount] = useState('')
  const [cashflowEditError, setCashflowEditError] = useState('')
  const [editingHoldingId, setEditingHoldingId] = useState<string | null>(null)
  const [editingHoldingCode, setEditingHoldingCode] = useState('')
  const [editingHoldingDate, setEditingHoldingDate] = useState('')
  const [editingHoldingQuantity, setEditingHoldingQuantity] = useState('')
  const [holdingEditError, setHoldingEditError] = useState('')
  const [editingTradeId, setEditingTradeId] = useState<string | null>(null)
  const [editingTradeQuantity, setEditingTradeQuantity] = useState('')
  const [tradeEditError, setTradeEditError] = useState('')
  const [newAllocationCode, setNewAllocationCode] = useState('')
  const [newAllocationWeight, setNewAllocationWeight] = useState('')
  const [allocationError, setAllocationError] = useState('')
  const [editingAllocationCode, setEditingAllocationCode] = useState<
    string | null
  >(null)
  const [editingAllocationWeight, setEditingAllocationWeight] = useState('')
  const [strategyConfig, setStrategyConfig] = useState<StrategyConfig | null>(
    null,
  )
  const [strategyDraftByInstrument, setStrategyDraftByInstrument] = useState<
    Record<string, InstrumentStrategyDraft>
  >({})
  const [strategySaveError, setStrategySaveError] = useState('')
  const [marketDataByInstrument, setMarketDataByInstrument] = useState<
    Record<string, MarketCandle[]>
  >({})

  const instrumentOptions = useMemo(() => instrumentsByMarket(market), [market])
  const defaultInstrumentCode = instrumentOptions[0]?.code ?? ''
  const text = isZh
    ? {
        title: '记录管理',
        addCashflow: '新增现金流',
        date: '日期',
        amountIncrement: '增量金额（可正可负）',
        addCashflowButton: '添加现金流',
        addTrade: '新增交易',
        instrument: '标的',
        quantity: '数量',
        tradePrice: '成交价（留空市价）',
        addTradeButton: '添加交易',
        allocation: '目标比例',
        allocationSum: '当前比例总和',
        allocationHint: '建议为 1',
        weight: '比例',
        addAllocationButton: '添加目标比例',
        holdings: '初始持仓',
        cashflows: '现金流记录',
        trades: '交易记录',
        save: '保存',
        cancel: '取消',
        edit: '编辑',
        delete: '删除',
        marketPrice: '市价',
        dateFormat: '日期格式应为 YYYY-MM-DD',
        cashflowDateFormat: '日期格式必须是 YYYY-MM-DD',
        amountInvalid: '金额必须是有效数字',
        tradeDateFormat: '新增交易日期格式应为 YYYY-MM-DD',
        tradeCodeRequired: '新增交易标的不能为空',
        tradeQuantityInvalid: '新增交易数量必须大于 0',
        holdingQtyInvalid: '初始持仓数量必须大于 0',
        holdingDateInvalid: '初始持仓日期格式应为 YYYY-MM-DD',
        tradeQtyInvalid: '交易数量必须大于 0',
        allocationPositive: '目标比例必须大于 0',
        allocationCodeRequired: '标的不能为空',
        strategySettings: '策略参数（自动保存）',
        strategyAutoSaveHint:
          '修改有效参数后会立即保存；无效输入会保留在页面上但不会写入数据库。',
        strategyAssumptionsSection: '全局假设',
        strategyDcaSection: '每日投入模型',
        strategyCostSection: '交易成本',
        strategyPreviewSection: '实时预览',
        globalExpectedAnnualReturn: '全局预期年化收益率',
        globalMaxDrawdown: '全局最大回撤',
        dailyRateStrategy: '每日投入比例策略',
        dailyRateFixed: '现有：固定 1/252',
        dailyRateNaive: 'naive（基于可接受回撤）',
        dailyRateKelly: 'Kelly 变体（r = Kelly × K / 252，Kelly = μ / σ²）',
        acceptableMaxDrawdown: '用户可接受最大回撤（默认 0）',
        volatilityLookbackDays: '波动率窗口（交易日）',
        volatilityLookbackDaysHint: '默认 20（约过去 1 个月）',
        kellyFraction: 'Kelly 分数 K',
        kellyFractionHint: '默认 0.25（四分之一 Kelly）',
        baseDailyInvestRate: '基础日投入比例（baseDailyInvestRate）',
        baseDailyInvestRateHelp:
          'fixed_1_252: 每日固定投入比例 = 1/252；naive: 每日投入比例 = 预期年化收益/252/(预期最大回撤 - 可接受最大回撤)；kelly_variant: Kelly仓位 = μ/σ²，其中 μ=预期日收益率(年化/252)，σ=最近 N 日对数收益率波动率；每日投入比例 r = Kelly仓位 × K / 252，K 默认为 0.25。最终预算还会乘以回撤倍率 multiplier。',
        perInstrumentSettings: '按标的覆写（留空=使用全局）',
        saveStrategy: '保存策略参数',
        strategyInvalidAnnual: '预期年化收益率必须为有效数字且大于 0',
        strategyInvalidDd: '最大回撤必须是 (0, 1] 范围内数字',
        strategyInvalidBaseDailyInvestRate:
          'baseDailyInvestRate 必须是 (0, 1] 范围内数字',
        strategyInvalidAcceptableDd:
          '可接受最大回撤必须在 [0, 1) 且小于最大回撤',
        strategyInvalidLookbackDays: '波动率窗口必须是大于等于 2 的整数',
        strategyInvalidKellyFraction: 'Kelly 分数 K 必须是 (0, 1] 范围内数字',
        feeRate: '手续费率（全局）',
        slippageRate: '滑点率（全局）',
        feeDesc:
          '交易费 = 成交金额 × (1 + 手续费率 + 滑点率)。手续费一般 0.0005（万五），滑点用于模拟价差与冲击成本。',
        lotSizeRuleByInstrument: '按标的买入数量规则',
        lotSizeRuleHeader: '手数规则',
        lotFractional: '可买小数',
        lotInteger: '必须整数',
        lotLot100: '必须 100 的倍数',
        lotInherit: '继承全局',
        realtimeRatePreview: '当前策略实时 r 值预览（按标的）',
        rateFormula: '计算模式',
        rateValue: 'r（每日投入比例）',
        expectedAnnualReturnRef: '预期年化参考',
        maxDrawdownRef: '最大回撤参考',
        volaWindow: '波动率窗口',
        loadingMarketData: '加载行情中...',
        subAccountsTitle: '子账户标记预览（同一 Profile 内并行）',
        subAccountPlan: '计划',
        subAccountDate: '创建日期',
        subAccountPrincipal: '当前本金',
        subAccountHint:
          '正向入金会新增 Plan B/C...；负向出金会按比例缩减各子账户当前本金（子账户隔离法）。',
      }
    : {
        title: 'Records',
        addCashflow: 'Add Cashflow',
        date: 'Date',
        amountIncrement: 'Increment Amount',
        addCashflowButton: 'Add Cashflow',
        addTrade: 'Add Trade',
        instrument: 'Instrument',
        quantity: 'Quantity',
        tradePrice: 'Trade Price (blank = market)',
        addTradeButton: 'Add Trade',
        allocation: 'Target Allocation',
        allocationSum: 'Current allocation sum',
        allocationHint: 'recommended to be 1',
        weight: 'Weight',
        addAllocationButton: 'Add Target Allocation',
        holdings: 'Initial Holdings',
        cashflows: 'Cashflow Records',
        trades: 'Trade Records',
        save: 'Save',
        cancel: 'Cancel',
        edit: 'Edit',
        delete: 'Delete',
        marketPrice: 'Market',
        dateFormat: 'Date must be YYYY-MM-DD',
        cashflowDateFormat: 'Date must be YYYY-MM-DD',
        amountInvalid: 'Amount must be a valid number',
        tradeDateFormat: 'Trade date must be YYYY-MM-DD',
        tradeCodeRequired: 'Instrument is required',
        tradeQuantityInvalid: 'Trade quantity must be greater than 0',
        holdingQtyInvalid: 'Initial holding quantity must be greater than 0',
        holdingDateInvalid: 'Initial holding date must be YYYY-MM-DD',
        tradeQtyInvalid: 'Trade quantity must be greater than 0',
        allocationPositive: 'Target weight must be greater than 0',
        allocationCodeRequired: 'Instrument is required',
        strategySettings: 'Strategy Parameters (auto-save)',
        strategyAutoSaveHint:
          'Valid changes are saved immediately; invalid inputs stay visible but are not written to the database.',
        strategyAssumptionsSection: 'Global Assumptions',
        strategyDcaSection: 'Daily Deployment Model',
        strategyCostSection: 'Trading Costs',
        strategyPreviewSection: 'Realtime Preview',
        globalExpectedAnnualReturn: 'Global Expected Annual Return',
        globalMaxDrawdown: 'Global Max Drawdown',
        dailyRateStrategy: 'Daily Invest Rate Strategy',
        dailyRateFixed: 'Existing: fixed 1/252',
        dailyRateNaive: 'naive (accepted drawdown based)',
        dailyRateKelly: 'Kelly variant (r = Kelly × K / 252, Kelly = μ / σ²)',
        acceptableMaxDrawdown: 'User-accepted max drawdown (default 0)',
        volatilityLookbackDays: 'Volatility lookback window (trading days)',
        volatilityLookbackDaysHint: 'Default 20 (~past month)',
        kellyFraction: 'Kelly Fraction K',
        kellyFractionHint: 'Default 0.25 (quarter Kelly)',
        baseDailyInvestRate: 'Base Daily Invest Rate (baseDailyInvestRate)',
        baseDailyInvestRateHelp:
          'fixed_1_252: daily rate = 1/252; naive: daily rate = expectedAnnualReturn/252/(expectedMaxDrawdown - acceptedMaxDrawdown); kelly_variant: Kelly fraction = μ/σ², where μ=expected daily return (annualized/252) and σ=trailing log-return volatility over N days; daily rate r = Kelly fraction × K / 252, with K defaulting to 0.25. Final budget is additionally scaled by drawdown multiplier.',
        perInstrumentSettings:
          'Per-instrument overrides (blank = inherit global)',
        saveStrategy: 'Save Strategy Parameters',
        strategyInvalidAnnual:
          'Expected annual return must be a valid number greater than 0',
        strategyInvalidDd: 'Max drawdown must be a number in (0, 1]',
        strategyInvalidBaseDailyInvestRate:
          'baseDailyInvestRate must be a number in (0, 1]',
        strategyInvalidAcceptableDd:
          'Accepted max drawdown must be in [0, 1) and less than max drawdown',
        strategyInvalidLookbackDays:
          'Volatility lookback must be an integer >= 2',
        strategyInvalidKellyFraction:
          'Kelly fraction K must be a number in (0, 1]',
        feeRate: 'Fee Rate (global)',
        slippageRate: 'Slippage Rate (global)',
        feeDesc:
          'Total cost = gross amount × (1 + fee rate + slippage rate). Fee rate is typically 0.0005 (0.05%); slippage models bid-ask spread and market impact.',
        lotSizeRuleByInstrument: 'Lot Size Rule per Instrument',
        lotSizeRuleHeader: 'Lot Rule',
        lotFractional: 'Fractional',
        lotInteger: 'Integer',
        lotLot100: '100-Lot',
        lotInherit: 'Inherit global',
        realtimeRatePreview: 'Realtime r Preview by Instrument',
        rateFormula: 'Formula',
        rateValue: 'r (daily invest rate)',
        expectedAnnualReturnRef: 'Expected Annual Return Ref',
        maxDrawdownRef: 'Max Drawdown Ref',
        volaWindow: 'Volatility Window',
        loadingMarketData: 'Loading market data...',
        subAccountsTitle: 'Sub-account Markers (parallel within one profile)',
        subAccountPlan: 'Plan',
        subAccountDate: 'Created At',
        subAccountPrincipal: 'Current Principal',
        subAccountHint:
          'Positive cash-in creates Plan B/C...; cash-out proportionally scales down each sub-account principal (isolated sub-account method).',
      }
  const sideLabel = (side: 'buy' | 'sell') => {
    if (!isZh) return side === 'buy' ? 'buy' : 'sell'
    return side === 'buy' ? '买入' : '卖出'
  }

  const refresh = useCallback(async () => {
    const [
      profile,
      nextCashflows,
      nextTrades,
      nextHoldings,
      nextAllocations,
      nextStrategy,
      pref,
    ] = await Promise.all([
      db.profiles.get(profileId),
      db.cashflows
        .where('profileId')
        .equals(profileId)
        .reverse()
        .sortBy('date'),
      db.trades.where('profileId').equals(profileId).reverse().sortBy('date'),
      db.initialHoldings
        .where('profileId')
        .equals(profileId)
        .reverse()
        .sortBy('acquiredAt'),
      db.targetAllocations.where('profileId').equals(profileId).toArray(),
      db.strategyConfigs.get(profileId),
      db.uiPreferences.get('default'),
    ])

    const resolvedPref = pref ?? DEFAULT_UI_PREFERENCE
    let resolvedStrategy = nextStrategy
    if (profile && !resolvedStrategy) {
      resolvedStrategy = createDefaultStrategyConfig(profileId, {
        expectedAnnualReturn: resolvedPref.globalExpectedAnnualReturn,
        maxDrawdown: resolvedPref.globalMaxDrawdown,
      })
      await db.strategyConfigs.put(resolvedStrategy)
    }

    if (resolvedStrategy) {
      resolvedStrategy = {
        ...resolvedStrategy,
        baseDailyInvestRateMode:
          resolvedStrategy.baseDailyInvestRateMode ?? 'fixed_1_252',
        acceptableMaxDrawdown: resolvedStrategy.acceptableMaxDrawdown ?? 0,
        volatilityLookbackDays: Math.max(
          2,
          Math.floor(resolvedStrategy.volatilityLookbackDays ?? 20),
        ),
        kellyFraction: resolvedStrategy.kellyFraction ?? 0.25,
      }
    }

    const normalizedAllocations = nextAllocations.sort((a, b) =>
      a.instrumentCode.localeCompare(b.instrumentCode),
    )
    const draftMap = Object.fromEntries(
      normalizedAllocations.map((row) => {
        const override =
          resolvedStrategy?.instrumentOverrides?.[row.instrumentCode]
        return [
          row.instrumentCode,
          {
            expectedAnnualReturn:
              override?.expectedAnnualReturn != null
                ? String(override.expectedAnnualReturn)
                : '',
            maxDrawdown:
              override?.maxDrawdown != null ? String(override.maxDrawdown) : '',
            lotSizeRule: override?.lotSizeRule ?? '',
          },
        ]
      }),
    )

    setMarket(profile?.market ?? 'cn')
    setCashflows(nextCashflows)
    setTrades(nextTrades)
    setHoldings(nextHoldings)
    setAllocations(normalizedAllocations)
    setStrategyConfig(resolvedStrategy ?? null)
    setStrategyDraftByInstrument(draftMap)
    setStrategySaveError('')
  }, [profileId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!newTradeCode && defaultInstrumentCode) {
      setNewTradeCode(defaultInstrumentCode)
    }
  }, [defaultInstrumentCode, newTradeCode])

  useEffect(() => {
    if (!newAllocationCode && defaultInstrumentCode) {
      setNewAllocationCode(defaultInstrumentCode)
    }
  }, [defaultInstrumentCode, newAllocationCode])

  useEffect(() => {
    const run = async () => {
      if (allocations.length === 0) {
        setMarketDataByInstrument({})
        return
      }
      const codes = [...new Set(allocations.map((row) => row.instrumentCode))]
      const loaded = await loadMarketDataBatch(codes)
      setMarketDataByInstrument(loaded)
    }
    void run()
  }, [allocations])

  const realtimeRateRows = useMemo(() => {
    if (!strategyConfig) return []
    const mode = strategyConfig.baseDailyInvestRateMode ?? 'fixed_1_252'
    return allocations.map((row) => {
      const override = strategyConfig.instrumentOverrides?.[row.instrumentCode]
      const expectedAnnualReturn =
        override?.expectedAnnualReturn ?? strategyConfig.expectedAnnualReturn
      const maxDrawdown = override?.maxDrawdown ?? strategyConfig.maxDrawdown
      const rate = resolveBaseDailyInvestRate({
        strategy: strategyConfig,
        expectedAnnualReturn,
        maxDrawdown,
        candles: marketDataByInstrument[row.instrumentCode] ?? [],
      })

      return {
        instrumentCode: row.instrumentCode,
        mode,
        rate,
        expectedAnnualReturn,
        maxDrawdown,
        lookbackDays: strategyConfig.volatilityLookbackDays ?? 20,
        kellyFraction: strategyConfig.kellyFraction ?? 0.25,
      }
    })
  }, [allocations, marketDataByInstrument, strategyConfig])

  const subAccountRows = useMemo(
    () => deriveSubAccountsFromCashflows(cashflows),
    [cashflows],
  )

  const buildStrategyConfigForSave = useCallback(
    (
      config: StrategyConfig,
      drafts: Record<string, InstrumentStrategyDraft>,
    ): { next?: StrategyConfig; error?: string } => {
      if (
        !Number.isFinite(config.expectedAnnualReturn) ||
        config.expectedAnnualReturn <= 0
      ) {
        return { error: text.strategyInvalidAnnual }
      }
      if (
        !Number.isFinite(config.maxDrawdown) ||
        config.maxDrawdown <= 0 ||
        config.maxDrawdown > 1
      ) {
        return { error: text.strategyInvalidDd }
      }

      const mode = config.baseDailyInvestRateMode ?? 'fixed_1_252'
      if (mode === 'fixed_1_252') {
        if (
          !Number.isFinite(config.baseDailyInvestRate) ||
          config.baseDailyInvestRate <= 0 ||
          config.baseDailyInvestRate > 1
        ) {
          return { error: text.strategyInvalidBaseDailyInvestRate }
        }
      }
      if (mode === 'naive') {
        const accepted = config.acceptableMaxDrawdown ?? 0
        if (
          !Number.isFinite(accepted) ||
          accepted < 0 ||
          accepted >= 1 ||
          accepted >= config.maxDrawdown
        ) {
          return { error: text.strategyInvalidAcceptableDd }
        }
      }
      if (mode === 'kelly_variant') {
        const lookback = Math.floor(config.volatilityLookbackDays ?? 20)
        if (!Number.isFinite(lookback) || lookback < 2) {
          return { error: text.strategyInvalidLookbackDays }
        }
        const kellyFraction = config.kellyFraction ?? 0.25
        if (
          !Number.isFinite(kellyFraction) ||
          kellyFraction <= 0 ||
          kellyFraction > 1
        ) {
          return { error: text.strategyInvalidKellyFraction }
        }
      }

      const overrides: NonNullable<StrategyConfig['instrumentOverrides']> = {}
      for (const [code, draft] of Object.entries(drafts)) {
        const nextOverride: NonNullable<
          StrategyConfig['instrumentOverrides']
        >[string] = {}
        if (draft.expectedAnnualReturn.trim() !== '') {
          const value = Number(draft.expectedAnnualReturn)
          if (!Number.isFinite(value) || value <= 0) {
            return { error: `${code}: ${text.strategyInvalidAnnual}` }
          }
          nextOverride.expectedAnnualReturn = value
        }
        if (draft.maxDrawdown.trim() !== '') {
          const value = Number(draft.maxDrawdown)
          if (!Number.isFinite(value) || value <= 0 || value > 1) {
            return { error: `${code}: ${text.strategyInvalidDd}` }
          }
          nextOverride.maxDrawdown = value
        }
        if (draft.lotSizeRule !== '') {
          nextOverride.lotSizeRule = draft.lotSizeRule as BacktestLotSizeRule
        }
        if (Object.keys(nextOverride).length > 0) overrides[code] = nextOverride
      }

      return {
        next: {
          ...config,
          baseDailyInvestRateMode: mode,
          acceptableMaxDrawdown: config.acceptableMaxDrawdown ?? 0,
          volatilityLookbackDays: Math.max(
            2,
            Math.floor(config.volatilityLookbackDays ?? 20),
          ),
          kellyFraction: config.kellyFraction ?? 0.25,
          instrumentOverrides: overrides,
        },
      }
    },
    [
      text.strategyInvalidAcceptableDd,
      text.strategyInvalidAnnual,
      text.strategyInvalidBaseDailyInvestRate,
      text.strategyInvalidDd,
      text.strategyInvalidKellyFraction,
      text.strategyInvalidLookbackDays,
    ],
  )

  const persistStrategyConfig = useCallback(
    async (
      config: StrategyConfig,
      drafts: Record<
        string,
        InstrumentStrategyDraft
      > = strategyDraftByInstrument,
      syncState = true,
    ) => {
      const result = buildStrategyConfigForSave(config, drafts)
      if (result.error || !result.next) {
        setStrategySaveError(result.error ?? '')
        return
      }
      if (syncState) setStrategyConfig(result.next)
      setStrategySaveError('')
      await db.strategyConfigs.put(result.next)
    },
    [buildStrategyConfigForSave, strategyDraftByInstrument],
  )

  const updateStrategyConfig = useCallback(
    (updater: (current: StrategyConfig) => StrategyConfig) => {
      setStrategyConfig((current) => {
        if (!current) return current
        const next = updater(current)
        void persistStrategyConfig(next, strategyDraftByInstrument, false)
        return next
      })
    },
    [persistStrategyConfig, strategyDraftByInstrument],
  )

  const updateInstrumentStrategyDraft = useCallback(
    (
      instrumentCode: string,
      updater: (current: InstrumentStrategyDraft) => InstrumentStrategyDraft,
    ) => {
      setStrategyDraftByInstrument((current) => {
        const nextDrafts = {
          ...current,
          [instrumentCode]: updater(
            current[instrumentCode] ?? {
              expectedAnnualReturn: '',
              maxDrawdown: '',
              lotSizeRule: '',
            },
          ),
        }
        if (strategyConfig)
          void persistStrategyConfig(strategyConfig, nextDrafts)
        return nextDrafts
      })
    },
    [persistStrategyConfig, strategyConfig],
  )

  return (
    <section>
      <h2>{text.title}</h2>

      <h3>{text.addCashflow}</h3>
      <div className="actions-row">
        <label>
          {text.date}
          <input
            type="date"
            value={newCashflowDate}
            onChange={(event) => setNewCashflowDate(event.target.value)}
          />
        </label>
        <label>
          {text.amountIncrement}
          <input
            type="number"
            step="0.01"
            value={newCashflowAmount}
            onChange={(event) => setNewCashflowAmount(event.target.value)}
          />
        </label>
        <button
          onClick={async () => {
            const inputValue = Number(newCashflowAmount)
            if (!isValidDate(newCashflowDate)) {
              setCashflowAddError(text.dateFormat)
              return
            }
            if (!Number.isFinite(inputValue)) {
              setCashflowAddError(text.amountInvalid)
              return
            }
            await db.cashflows.add({
              id: createId(),
              profileId,
              date: newCashflowDate,
              amount: inputValue,
            })
            setCashflowAddError('')
            setNewCashflowAmount('')
            await refresh()
          }}
        >
          {text.addCashflowButton}
        </button>
      </div>
      {cashflowAddError && <p className="error">{cashflowAddError}</p>}

      <h3>{text.addTrade}</h3>
      <div className="actions-row">
        <label>
          {text.date}
          <input
            type="date"
            value={newTradeDate}
            onChange={(event) => setNewTradeDate(event.target.value)}
          />
        </label>
        <label>
          {text.instrument}
          <select
            value={newTradeCode}
            onChange={(event) => setNewTradeCode(event.target.value)}
          >
            {instrumentOptions.map((item) => (
              <option value={item.code} key={item.code}>
                {item.code}
              </option>
            ))}
          </select>
        </label>
        <label>
          {text.quantity}
          <input
            type="number"
            step="0.0001"
            value={newTradeQuantity}
            onChange={(event) => setNewTradeQuantity(event.target.value)}
          />
        </label>
        <label>
          {text.tradePrice}
          <input
            type="number"
            step="0.0001"
            value={newTradePrice}
            onChange={(event) => setNewTradePrice(event.target.value)}
          />
        </label>
        <button
          onClick={async () => {
            const quantity = Number(newTradeQuantity)
            const price = Number(newTradePrice)
            if (!isValidDate(newTradeDate)) {
              setTradeAddError(text.tradeDateFormat)
              return
            }
            if (!newTradeCode.trim()) {
              setTradeAddError(text.tradeCodeRequired)
              return
            }
            if (!Number.isFinite(quantity) || quantity <= 0) {
              setTradeAddError(text.tradeQuantityInvalid)
              return
            }
            await db.trades.add({
              id: createId(),
              profileId,
              date: newTradeDate,
              instrumentCode: newTradeCode.trim(),
              side: 'buy',
              quantity,
              price: Number.isFinite(price) && price > 0 ? price : null,
            })
            setTradeAddError('')
            setNewTradeCode(defaultInstrumentCode)
            setNewTradeQuantity('1')
            setNewTradePrice('')
            await refresh()
          }}
        >
          {text.addTradeButton}
        </button>
      </div>
      {tradeAddError && <p className="error">{tradeAddError}</p>}

      <h3>{text.allocation}</h3>
      <p className="helper">
        {text.allocationSum}:{' '}
        {allocations.reduce((sum, row) => sum + row.targetWeight, 0).toFixed(4)}
        （{text.allocationHint}）
      </p>
      <ul>
        {allocations.map((row) => (
          <li key={`${row.profileId}-${row.instrumentCode}`}>
            {editingAllocationCode === row.instrumentCode ? (
              <>
                {row.instrumentCode}
                <input
                  type="number"
                  step="0.0001"
                  min="0"
                  value={editingAllocationWeight}
                  onChange={(event) =>
                    setEditingAllocationWeight(event.target.value)
                  }
                />
                <button
                  onClick={async () => {
                    const targetWeight = Number(editingAllocationWeight)
                    if (!Number.isFinite(targetWeight) || targetWeight <= 0) {
                      setAllocationError(text.allocationPositive)
                      return
                    }
                    await db.targetAllocations.put({
                      profileId,
                      instrumentCode: row.instrumentCode,
                      targetWeight,
                    })
                    setEditingAllocationCode(null)
                    setEditingAllocationWeight('')
                    setAllocationError('')
                    await refresh()
                  }}
                >
                  {text.save}
                </button>
                <button
                  onClick={() => {
                    setEditingAllocationCode(null)
                    setEditingAllocationWeight('')
                    setAllocationError('')
                  }}
                >
                  {text.cancel}
                </button>
              </>
            ) : (
              <>
                {row.instrumentCode} - {row.targetWeight.toFixed(4)}
                <button
                  onClick={() => {
                    setEditingAllocationCode(row.instrumentCode)
                    setEditingAllocationWeight(String(row.targetWeight))
                    setAllocationError('')
                  }}
                >
                  {text.edit}
                </button>
                <button
                  onClick={async () => {
                    await db.targetAllocations.delete([
                      profileId,
                      row.instrumentCode,
                    ])
                    setAllocationError('')
                    await refresh()
                  }}
                >
                  {text.delete}
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      <div className="actions-row">
        <label>
          {text.instrument}
          <select
            value={newAllocationCode}
            onChange={(event) => setNewAllocationCode(event.target.value)}
          >
            {instrumentOptions.map((item) => (
              <option value={item.code} key={item.code}>
                {item.code}
              </option>
            ))}
          </select>
        </label>
        <label>
          {text.weight}
          <input
            type="number"
            step="0.0001"
            min="0"
            value={newAllocationWeight}
            onChange={(event) => setNewAllocationWeight(event.target.value)}
          />
        </label>
        <button
          onClick={async () => {
            const targetWeight = Number(newAllocationWeight)
            if (!newAllocationCode.trim()) {
              setAllocationError(text.allocationCodeRequired)
              return
            }
            if (!Number.isFinite(targetWeight) || targetWeight <= 0) {
              setAllocationError(text.allocationPositive)
              return
            }
            await db.targetAllocations.put({
              profileId,
              instrumentCode: newAllocationCode,
              targetWeight,
            })
            setAllocationError('')
            setNewAllocationWeight('')
            await refresh()
          }}
        >
          {text.addAllocationButton}
        </button>
      </div>
      {allocationError && <p className="error">{allocationError}</p>}

      {strategyConfig ? (
        <>
          <h3>{text.strategySettings}</h3>
          <p className="helper">{text.strategyAutoSaveHint}</p>
          {strategySaveError ? (
            <p className="error">{strategySaveError}</p>
          ) : null}

          <div className="detail-input-group">
            <h4>{text.strategyAssumptionsSection}</h4>
            <div className="detail-input-row">
              <span>{text.globalExpectedAnnualReturn}</span>
              <input
                type="number"
                step="0.0001"
                value={strategyConfig.expectedAnnualReturn}
                onChange={(event) =>
                  updateStrategyConfig((current) => ({
                    ...current,
                    expectedAnnualReturn: Number(event.target.value),
                  }))
                }
              />
            </div>
            <div className="detail-input-row">
              <span>{text.globalMaxDrawdown}</span>
              <input
                type="number"
                min="0"
                max="1"
                step="0.0001"
                value={strategyConfig.maxDrawdown}
                onChange={(event) =>
                  updateStrategyConfig((current) => ({
                    ...current,
                    maxDrawdown: Number(event.target.value),
                  }))
                }
              />
            </div>
          </div>

          <div className="detail-input-group">
            <h4>{text.strategyDcaSection}</h4>
            <div className="detail-input-row">
              <span>{text.dailyRateStrategy}</span>
              <select
                value={strategyConfig.baseDailyInvestRateMode ?? 'fixed_1_252'}
                onChange={(event) =>
                  updateStrategyConfig((current) => ({
                    ...current,
                    baseDailyInvestRateMode: event.target.value as
                      | 'fixed_1_252'
                      | 'naive'
                      | 'kelly_variant',
                  }))
                }
              >
                <option value="fixed_1_252">{text.dailyRateFixed}</option>
                <option value="naive">{text.dailyRateNaive}</option>
                <option value="kelly_variant">{text.dailyRateKelly}</option>
              </select>
            </div>
            {(strategyConfig.baseDailyInvestRateMode ?? 'fixed_1_252') ===
            'fixed_1_252' ? (
              <div className="detail-input-row">
                <span>{text.baseDailyInvestRate}</span>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.0001"
                  value={strategyConfig.baseDailyInvestRate}
                  onChange={(event) =>
                    updateStrategyConfig((current) => ({
                      ...current,
                      baseDailyInvestRate: Number(event.target.value),
                    }))
                  }
                />
              </div>
            ) : null}
            {(strategyConfig.baseDailyInvestRateMode ?? 'fixed_1_252') ===
            'naive' ? (
              <div className="detail-input-row">
                <span>{text.acceptableMaxDrawdown}</span>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.0001"
                  value={strategyConfig.acceptableMaxDrawdown ?? 0}
                  onChange={(event) =>
                    updateStrategyConfig((current) => ({
                      ...current,
                      acceptableMaxDrawdown: Number(event.target.value),
                    }))
                  }
                />
              </div>
            ) : null}
            {(strategyConfig.baseDailyInvestRateMode ?? 'fixed_1_252') ===
            'kelly_variant' ? (
              <>
                <div className="detail-input-row">
                  <span>{text.volatilityLookbackDays}</span>
                  <input
                    type="number"
                    min="2"
                    step="1"
                    value={strategyConfig.volatilityLookbackDays ?? 20}
                    onChange={(event) =>
                      updateStrategyConfig((current) => ({
                        ...current,
                        volatilityLookbackDays: Math.floor(
                          Number(event.target.value),
                        ),
                      }))
                    }
                  />
                </div>
                <div className="detail-input-row">
                  <span>{text.kellyFraction}</span>
                  <input
                    type="number"
                    min="0.0001"
                    max="1"
                    step="0.01"
                    value={strategyConfig.kellyFraction ?? 0.25}
                    onChange={(event) =>
                      updateStrategyConfig((current) => ({
                        ...current,
                        kellyFraction: Number(event.target.value),
                      }))
                    }
                  />
                </div>
                <p className="helper">
                  {text.volatilityLookbackDaysHint}; {text.kellyFractionHint}
                </p>
              </>
            ) : null}
            <p className="helper">{text.baseDailyInvestRateHelp}</p>
          </div>

          <div className="detail-input-group">
            <h4>{text.strategyCostSection}</h4>
            <div className="detail-input-row">
              <span>{text.feeRate}</span>
              <input
                type="number"
                step="0.0001"
                min="0"
                value={strategyConfig.feeRate ?? 0.0005}
                onChange={(event) =>
                  updateStrategyConfig((current) => ({
                    ...current,
                    feeRate: Number(event.target.value),
                  }))
                }
              />
            </div>
            <div className="detail-input-row">
              <span>{text.slippageRate}</span>
              <input
                type="number"
                step="0.0001"
                min="0"
                value={strategyConfig.slippageRate ?? 0.0005}
                onChange={(event) =>
                  updateStrategyConfig((current) => ({
                    ...current,
                    slippageRate: Number(event.target.value),
                  }))
                }
              />
            </div>
            <p className="helper">{text.feeDesc}</p>
          </div>

          <div className="detail-input-group">
            <h4>{text.perInstrumentSettings}</h4>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{text.instrument}</th>
                    <th>{text.globalExpectedAnnualReturn}</th>
                    <th>{text.globalMaxDrawdown}</th>
                    <th>{text.lotSizeRuleHeader}</th>
                  </tr>
                </thead>
                <tbody>
                  {allocations.map((row) => (
                    <tr key={`strategy-${row.instrumentCode}`}>
                      <td>{row.instrumentCode}</td>
                      <td>
                        <input
                          type="number"
                          step="0.0001"
                          placeholder={String(
                            strategyConfig.expectedAnnualReturn,
                          )}
                          value={
                            strategyDraftByInstrument[row.instrumentCode]
                              ?.expectedAnnualReturn ?? ''
                          }
                          onChange={(event) => {
                            const next = event.target.value
                            updateInstrumentStrategyDraft(
                              row.instrumentCode,
                              (current) => ({
                                ...current,
                                expectedAnnualReturn: next,
                              }),
                            )
                          }}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          max="1"
                          step="0.0001"
                          placeholder={String(strategyConfig.maxDrawdown)}
                          value={
                            strategyDraftByInstrument[row.instrumentCode]
                              ?.maxDrawdown ?? ''
                          }
                          onChange={(event) => {
                            const next = event.target.value
                            updateInstrumentStrategyDraft(
                              row.instrumentCode,
                              (current) => ({
                                ...current,
                                maxDrawdown: next,
                              }),
                            )
                          }}
                        />
                      </td>
                      <td>
                        <select
                          value={
                            strategyDraftByInstrument[row.instrumentCode]
                              ?.lotSizeRule ?? ''
                          }
                          onChange={(event) => {
                            const next = event.target.value
                            updateInstrumentStrategyDraft(
                              row.instrumentCode,
                              (current) => ({
                                ...current,
                                lotSizeRule: next,
                              }),
                            )
                          }}
                        >
                          <option value="">{text.lotInherit}</option>
                          <option value="fractional">
                            {text.lotFractional}
                          </option>
                          <option value="integer">{text.lotInteger}</option>
                          <option value="lot100">{text.lotLot100}</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="detail-input-group">
            <h4>{text.strategyPreviewSection}</h4>
            <h5>{text.realtimeRatePreview}</h5>
            {allocations.length > 0 &&
            Object.keys(marketDataByInstrument).length === 0 ? (
              <p className="helper">{text.loadingMarketData}</p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{text.instrument}</th>
                      <th>{text.rateFormula}</th>
                      <th>{text.rateValue}</th>
                      <th>{text.expectedAnnualReturnRef}</th>
                      <th>{text.maxDrawdownRef}</th>
                      <th>{text.volaWindow}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {realtimeRateRows.map((row) => (
                      <tr key={`rate-preview-${row.instrumentCode}`}>
                        <td>{row.instrumentCode}</td>
                        <td>{row.mode}</td>
                        <td>{(row.rate * 100).toFixed(4)}%</td>
                        <td>{(row.expectedAnnualReturn * 100).toFixed(2)}%</td>
                        <td>{(row.maxDrawdown * 100).toFixed(2)}%</td>
                        <td>
                          {row.mode === 'kelly_variant'
                            ? `${row.lookbackDays}d / K=${row.kellyFraction}`
                            : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <h5>{text.subAccountsTitle}</h5>
            <p className="helper">{text.subAccountHint}</p>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{text.subAccountPlan}</th>
                    <th>{text.subAccountDate}</th>
                    <th>{text.subAccountPrincipal}</th>
                  </tr>
                </thead>
                <tbody>
                  {subAccountRows.map((row) => (
                    <tr key={`sub-${row.id}-${row.label}`}>
                      <td>{row.label}</td>
                      <td>{row.createdAt || '-'}</td>
                      <td>{row.currentPrincipal.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}

      <h3>{text.holdings}</h3>
      <ul>
        {holdings.map((row) => (
          <li key={row.id}>
            {editingHoldingId === row.id ? (
              <>
                <select
                  value={editingHoldingCode}
                  onChange={(event) =>
                    setEditingHoldingCode(event.target.value)
                  }
                >
                  {instrumentOptions.map((item) => (
                    <option value={item.code} key={item.code}>
                      {item.code}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  step="0.0001"
                  value={editingHoldingQuantity}
                  onChange={(event) =>
                    setEditingHoldingQuantity(event.target.value)
                  }
                />
                <input
                  type="date"
                  value={editingHoldingDate}
                  onChange={(event) =>
                    setEditingHoldingDate(event.target.value)
                  }
                />
                <button
                  onClick={async () => {
                    const quantity = Number(editingHoldingQuantity)
                    if (!Number.isFinite(quantity) || quantity <= 0) {
                      setHoldingEditError(text.holdingQtyInvalid)
                      return
                    }
                    if (!isValidDate(editingHoldingDate)) {
                      setHoldingEditError(text.holdingDateInvalid)
                      return
                    }
                    await db.initialHoldings.put({
                      ...row,
                      instrumentCode: editingHoldingCode,
                      acquiredAt: editingHoldingDate,
                      quantity,
                    })
                    setEditingHoldingId(null)
                    setEditingHoldingCode('')
                    setEditingHoldingDate('')
                    setEditingHoldingQuantity('')
                    setHoldingEditError('')
                    await refresh()
                  }}
                >
                  {text.save}
                </button>
                <button
                  onClick={() => {
                    setEditingHoldingId(null)
                    setEditingHoldingCode('')
                    setEditingHoldingDate('')
                    setEditingHoldingQuantity('')
                    setHoldingEditError('')
                  }}
                >
                  {text.cancel}
                </button>
              </>
            ) : (
              <>
                {row.acquiredAt} - {row.instrumentCode} - {row.quantity}
                <button
                  onClick={() => {
                    setEditingHoldingId(row.id)
                    setEditingHoldingCode(row.instrumentCode)
                    setEditingHoldingDate(row.acquiredAt)
                    setEditingHoldingQuantity(String(row.quantity))
                    setHoldingEditError('')
                  }}
                >
                  {text.edit}
                </button>
                <button
                  onClick={async () => {
                    await db.initialHoldings.delete(row.id)
                    await refresh()
                  }}
                >
                  {text.delete}
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      {holdingEditError && <p className="error">{holdingEditError}</p>}

      <h3>{text.cashflows}</h3>
      <ul>
        {cashflows.map((row) => (
          <li key={row.id}>
            {editingCashflowId === row.id ? (
              <>
                <input
                  type="date"
                  value={editingCashflowDate}
                  onChange={(event) =>
                    setEditingCashflowDate(event.target.value)
                  }
                />
                <input
                  type="number"
                  step="0.01"
                  value={editingCashflowAmount}
                  onChange={(event) =>
                    setEditingCashflowAmount(event.target.value)
                  }
                />
                <button
                  onClick={async () => {
                    const amount = Number(editingCashflowAmount)
                    if (
                      !dayjs(editingCashflowDate, 'YYYY-MM-DD', true).isValid()
                    ) {
                      setCashflowEditError(text.cashflowDateFormat)
                      return
                    }
                    if (!Number.isFinite(amount)) {
                      setCashflowEditError(text.amountInvalid)
                      return
                    }
                    await db.cashflows.put({
                      ...row,
                      date: editingCashflowDate,
                      amount,
                    })
                    setEditingCashflowId(null)
                    setEditingCashflowDate('')
                    setEditingCashflowAmount('')
                    setCashflowEditError('')
                    await refresh()
                  }}
                >
                  {text.save}
                </button>
                <button
                  onClick={() => {
                    setEditingCashflowId(null)
                    setEditingCashflowDate('')
                    setEditingCashflowAmount('')
                    setCashflowEditError('')
                  }}
                >
                  {text.cancel}
                </button>
              </>
            ) : (
              <>
                {row.date} - {row.amount}
                <button
                  onClick={() => {
                    setEditingCashflowId(row.id)
                    setEditingCashflowDate(row.date)
                    setEditingCashflowAmount(String(row.amount))
                    setCashflowEditError('')
                  }}
                >
                  {text.edit}
                </button>
                <button
                  onClick={async () => {
                    await db.cashflows.delete(row.id)
                    await refresh()
                  }}
                >
                  {text.delete}
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      {cashflowEditError && <p className="error">{cashflowEditError}</p>}

      <h3>{text.trades}</h3>
      <ul>
        {trades.map((row) => (
          <li key={row.id}>
            {editingTradeId === row.id ? (
              <>
                {row.date} - {sideLabel(row.side)} {row.instrumentCode}
                <input
                  type="number"
                  step="0.0001"
                  value={editingTradeQuantity}
                  onChange={(event) =>
                    setEditingTradeQuantity(event.target.value)
                  }
                />
                @ {row.price ?? text.marketPrice}
                <button
                  onClick={async () => {
                    const quantity = Number(editingTradeQuantity)
                    if (!Number.isFinite(quantity) || quantity <= 0) {
                      setTradeEditError(text.tradeQtyInvalid)
                      return
                    }
                    await db.trades.put({ ...row, quantity })
                    setEditingTradeId(null)
                    setEditingTradeQuantity('')
                    setTradeEditError('')
                    await refresh()
                  }}
                >
                  {text.save}
                </button>
                <button
                  onClick={() => {
                    setEditingTradeId(null)
                    setEditingTradeQuantity('')
                    setTradeEditError('')
                  }}
                >
                  {text.cancel}
                </button>
              </>
            ) : (
              <>
                {row.date} - {sideLabel(row.side)} {row.instrumentCode}{' '}
                {row.quantity} @ {row.price ?? text.marketPrice}
                <button
                  onClick={() => {
                    setEditingTradeId(row.id)
                    setEditingTradeQuantity(String(row.quantity))
                    setTradeEditError('')
                  }}
                >
                  {text.edit}
                </button>
                <button
                  onClick={async () => {
                    await db.trades.delete(row.id)
                    await refresh()
                  }}
                >
                  {text.delete}
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      {tradeEditError && <p className="error">{tradeEditError}</p>}
    </section>
  )
}
