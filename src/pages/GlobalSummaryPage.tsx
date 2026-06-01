import { useEffect, useMemo, useState } from 'react'
import { AssetAreaChart } from '../components/AssetAreaChart'
import { AssetPieChart } from '../components/AssetPieChart'
import { db } from '../db/database'
import { loadMarketDataBatch } from '../features/market-data/service'
import { buildHistoricalAssetSeries, buildPortfolioSnapshot } from '../features/portfolio/calc'
import { getProfileBundle, listProfiles } from '../features/profiles/repository'
import { DEFAULT_UI_PREFERENCE } from '../config/defaults'
import type { Currency, UiPreference } from '../types/models'

export const GlobalSummaryPage = () => {
  const [pieData, setPieData] = useState<Array<{ name: string; value: number }>>([])
  const [series, setSeries] = useState<Array<{ date: string; series: Record<string, number> }>>([])
  const [pref, setPref] = useState<UiPreference>(DEFAULT_UI_PREFERENCE)

  useEffect(() => {
    const run = async () => {
      const savedPref = (await db.uiPreferences.get('default')) ?? DEFAULT_UI_PREFERENCE
      setPref(savedPref)

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
      <h2>全局汇总</h2>
      <label>
        汇总币种
        <select
          value={pref.defaultCurrency}
          onChange={async (event) => {
            const next = { ...pref, defaultCurrency: event.target.value as Currency }
            setPref(next)
            await db.uiPreferences.put(next)
            window.location.reload()
          }}
        >
          <option value="CNY">CNY</option>
          <option value="USD">USD</option>
        </select>
      </label>
      <label>
        USD/CNY 汇率
        <input
          type="number"
          step="0.0001"
          value={pref.fxUsdToCny}
          onChange={async (event) => {
            const next = { ...pref, fxUsdToCny: Number(event.target.value) }
            setPref(next)
            await db.uiPreferences.put(next)
          }}
        />
      </label>

      <h3>按 Profile 资产占比</h3>
      <AssetPieChart data={pieData} />
      <h3>总资产历史</h3>
      <AssetAreaChart points={series} seriesKeys={keys} />
    </section>
  )
}
