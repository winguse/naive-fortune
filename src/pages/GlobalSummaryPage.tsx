import { useEffect, useMemo, useState } from 'react'
import { AssetAreaChart } from '../components/AssetAreaChart'
import { AssetPieChart } from '../components/AssetPieChart'
import { getDefaultLotSizeRuleForMarket } from '../config/defaults'
import { db } from '../db/database'
import { loadMarketDataBatch } from '../features/market-data/service'
import { buildHistoricalAssetSeries, buildPortfolioSnapshot } from '../features/portfolio/calc'
import { getProfileBundle, listProfiles } from '../features/profiles/repository'
import { DEFAULT_UI_PREFERENCE } from '../config/defaults'
import { isZh, persistLanguagePreference } from '../i18n/language'
import type { BacktestLotSizeRule, Currency, UiPreference } from '../types/models'

const lotRuleOptions: Array<{ value: BacktestLotSizeRule; labelZh: string; labelEn: string }> = [
  { value: 'fractional', labelZh: '无限制（可小数）', labelEn: 'Fractional Allowed' },
  { value: 'integer', labelZh: '必须整数份额', labelEn: 'Integer Shares Only' },
  { value: 'lot100', labelZh: '必须 100 的整数倍', labelEn: 'Must Be 100-Lot Multiple' },
]

export const GlobalSummaryPage = () => {
  const [pieData, setPieData] = useState<Array<{ name: string; value: number }>>([])
  const [series, setSeries] = useState<Array<{ date: string; series: Record<string, number> }>>([])
  const [pref, setPref] = useState<UiPreference>(DEFAULT_UI_PREFERENCE)
  const text = isZh
    ? {
        title: '全局汇总',
        currency: '汇总币种',
        fx: 'USD/CNY 汇率',
        globalSettings: '全局设置',
        language: '界面语言',
        languageAuto: '自动（跟随系统）',
        languageZh: '简体中文',
        languageEn: 'English',
        annualReturn: '预期年化收益率（默认）',
        maxDrawdown: '最大回撤（默认）',
        usLotRule: '美股/美基买入限制（默认）',
        cnLotRule: 'A 股/中基买入限制（默认）',
        profilePie: '按组合资产占比',
        totalHistory: '总资产历史',
      }
    : {
        title: 'Global Summary',
        currency: 'Summary Currency',
        fx: 'USD/CNY FX Rate',
        globalSettings: 'Global Defaults',
        language: 'Language',
        languageAuto: 'Auto (follow system)',
        languageZh: 'Simplified Chinese',
        languageEn: 'English',
        annualReturn: 'Expected Annual Return (default)',
        maxDrawdown: 'Max Drawdown (default)',
        usLotRule: 'US Instrument Lot Rule (default)',
        cnLotRule: 'CN Instrument Lot Rule (default)',
        profilePie: 'Allocation by Profile',
        totalHistory: 'Total Asset History',
      }

  const savePref = async (next: UiPreference) => {
    setPref(next)
    await db.uiPreferences.put(next)
  }

  useEffect(() => {
    const run = async () => {
      const savedPref = (await db.uiPreferences.get('default')) ?? DEFAULT_UI_PREFERENCE
      setPref(savedPref)
      persistLanguagePreference(savedPref.language)

      const profiles = await listProfiles()
      const bundles = await Promise.all(profiles.map((profile) => getProfileBundle(profile.id)))
      const allCodes = [...new Set(bundles.flatMap((bundle) => bundle.targetAllocations.map((row) => row.instrumentCode)))]
      const marketData = await loadMarketDataBatch(allCodes)

      const convert = (amount: number, currency: Currency) =>
        savedPref.defaultCurrency === currency
          ? amount
          : savedPref.defaultCurrency === 'CNY'
            ? amount * savedPref.fxUsdToCny
            : amount / savedPref.fxUsdToCny

      const nextPieData: Array<{ name: string; value: number }> = []
      const timeline = new Map<string, Record<string, number>>()

      for (const bundle of bundles) {
        if (!bundle.profile) continue
        const snapshot = buildPortfolioSnapshot({
          cashflows: bundle.cashflows,
          trades: bundle.trades,
          initialHoldings: bundle.initialHoldings,
          marketData,
        })

        const profileValue = snapshot.totalMarketValue + snapshot.cash
        nextPieData.push({
          name: bundle.profile.name,
          value: convert(profileValue, bundle.profile.baseCurrency),
        })

        const history = buildHistoricalAssetSeries({
          cashflows: bundle.cashflows,
          trades: bundle.trades,
          initialHoldings: bundle.initialHoldings,
          marketData,
        })
        for (const point of history) {
          const row = timeline.get(point.date) ?? {}
          row[bundle.profile.name] = convert(
            point.cash + Object.values(point.instrumentSeries).reduce((sum, value) => sum + value, 0),
            bundle.profile.baseCurrency,
          )
          timeline.set(point.date, row)
        }
      }

      setPieData(nextPieData)
      setSeries(
        [...timeline.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, row]) => ({ date, series: row })),
      )
    }

    void run()
  }, [])

  const keys = useMemo(() => [...new Set(series.flatMap((row) => Object.keys(row.series)))], [series])

  return (
    <section>
      <h2>{text.title}</h2>
      <label>
        {text.currency}
        <select
          value={pref.defaultCurrency}
          onChange={async (event) => {
            const next = { ...pref, defaultCurrency: event.target.value as Currency }
            await savePref(next)
            window.location.reload()
          }}
        >
          <option value="CNY">CNY</option>
          <option value="USD">USD</option>
        </select>
      </label>
      <label>
        {text.fx}
        <input
          type="number"
          step="0.0001"
          value={pref.fxUsdToCny}
          onChange={async (event) => {
            const next = { ...pref, fxUsdToCny: Number(event.target.value) }
            await savePref(next)
          }}
        />
      </label>
      <label>
        {text.language}
        <select
          value={pref.language}
          onChange={async (event) => {
            const nextLanguage = event.target.value as UiPreference['language']
            await savePref({ ...pref, language: nextLanguage })
            persistLanguagePreference(nextLanguage)
            window.location.reload()
          }}
        >
          <option value="auto">{text.languageAuto}</option>
          <option value="zh-CN">{text.languageZh}</option>
          <option value="en-US">{text.languageEn}</option>
        </select>
      </label>

      <h3>{text.globalSettings}</h3>
      <div className="detail-input-group">
        <div className="detail-input-row">
          <span>{text.annualReturn}</span>
          <input
            type="number"
            step="0.0001"
            value={pref.globalExpectedAnnualReturn}
            onChange={async (event) => {
              await savePref({ ...pref, globalExpectedAnnualReturn: Number(event.target.value) })
            }}
          />
        </div>
        <div className="detail-input-row">
          <span>{text.maxDrawdown}</span>
          <input
            type="number"
            min="0"
            max="1"
            step="0.0001"
            value={pref.globalMaxDrawdown}
            onChange={async (event) => {
              await savePref({ ...pref, globalMaxDrawdown: Number(event.target.value) })
            }}
          />
        </div>
        <div className="detail-input-row">
          <span>{text.usLotRule}</span>
          <select
            value={pref.defaultLotSizeRuleByMarket.us ?? getDefaultLotSizeRuleForMarket('us')}
            onChange={async (event) => {
              await savePref({
                ...pref,
                defaultLotSizeRuleByMarket: {
                  ...pref.defaultLotSizeRuleByMarket,
                  us: event.target.value as BacktestLotSizeRule,
                },
              })
            }}
          >
            {lotRuleOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {isZh ? option.labelZh : option.labelEn}
              </option>
            ))}
          </select>
        </div>
        <div className="detail-input-row">
          <span>{text.cnLotRule}</span>
          <select
            value={pref.defaultLotSizeRuleByMarket.cn ?? getDefaultLotSizeRuleForMarket('cn')}
            onChange={async (event) => {
              await savePref({
                ...pref,
                defaultLotSizeRuleByMarket: {
                  ...pref.defaultLotSizeRuleByMarket,
                  cn: event.target.value as BacktestLotSizeRule,
                },
              })
            }}
          >
            {lotRuleOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {isZh ? option.labelZh : option.labelEn}
              </option>
            ))}
          </select>
        </div>
      </div>

      <h3>{text.profilePie}</h3>
      <AssetPieChart data={pieData} />
      <h3>{text.totalHistory}</h3>
      <AssetAreaChart points={series} seriesKeys={keys} />
    </section>
  )
}
