import { useEffect, useState, useMemo } from 'react'
import { INSTRUMENTS } from '../config/instruments'
import { loadMarketDataBatch } from '../features/market-data/service'
import { isZh } from '../i18n/language'
import type { MarketCandle } from '../types/models'
import ReactECharts from 'echarts-for-react'

export const MarketPage = () => {
  const [marketData, setMarketData] = useState<Record<string, MarketCandle[]>>({})
  const [loading, setLoading] = useState(true)
  const [zoomRange, setZoomRange] = useState<{ startValue: number; endValue: number } | null>(null)

  const text = isZh
    ? {
        title: '市场行情',
        loading: '加载中...',
      }
    : {
        title: 'Market Data',
        loading: 'Loading...',
      }

  useEffect(() => {
    const fetchMarketData = async () => {
      setLoading(true)
      try {
        const codes = INSTRUMENTS.map((i) => i.code)
        const data = await loadMarketDataBatch(codes)
        setMarketData(data)
      } catch (e) {
        console.error('Failed to load market data', e)
      } finally {
        setLoading(false)
      }
    }
    void fetchMarketData()
  }, [])

  // Extract all dates
  const allDates = useMemo(() => {
    const dates = new Set<string>()
    Object.values(marketData).forEach(data => data.forEach(c => dates.add(c.date)))
    return Array.from(dates).sort()
  }, [marketData])

  useEffect(() => {
    if (allDates.length > 0 && !zoomRange) {
      // Default to last 50%
      const startIdx = Math.floor(allDates.length * 0.5)
      setZoomRange({
        startValue: new Date(allDates[startIdx]).getTime(),
        endValue: new Date(allDates[allDates.length - 1]).getTime(),
      })
    }
  }, [allDates, zoomRange])

  // Interpolate missing data
  const interpolatedData = useMemo(() => {
    const res: Record<string, Record<string, number | null>> = {}
    Object.keys(marketData).forEach(code => {
      res[code] = {}
      const data = marketData[code]
      if (data.length === 0) return

      for (let i = 0; i < allDates.length; i++) {
        const d = allDates[i]
        const tsD = new Date(d).getTime()

        let prev = null
        let next = null

        for (let j = 0; j < data.length; j++) {
          if (data[j].date === d) {
            prev = data[j]
            next = data[j]
            break
          }
          if (new Date(data[j].date).getTime() < tsD) {
            prev = data[j]
          }
          if (new Date(data[j].date).getTime() > tsD && next === null) {
            next = data[j]
            break
          }
        }

        if (prev && next && prev.date === next.date) {
          res[code][d] = prev.close
        } else if (prev && next) {
          const tsPrev = new Date(prev.date).getTime()
          const tsNext = new Date(next.date).getTime()
          const ratio = (tsD - tsPrev) / (tsNext - tsPrev)
          res[code][d] = prev.close + ratio * (next.close - prev.close)
        } else if (prev && !next) {
          res[code][d] = prev.close
        } else if (!prev && next) {
          res[code][d] = null
        }
      }
    })
    return res
  }, [marketData, allDates])

const seriesKeys = Object.keys(marketData)

  const normalizedSeries = useMemo(() => {
    if (!zoomRange || allDates.length === 0) return []

    const visibleDates = allDates.filter(d => {
      const ts = new Date(d).getTime()
      return ts >= zoomRange.startValue && ts <= zoomRange.endValue
    })

    const baselines: Record<string, number> = {}
    const startAbsolutePrices: Record<string, number> = {}

    // Compute baselines within the visible window
    visibleDates.forEach(d => {
      const codesWithBaseline = seriesKeys.filter(code => baselines[code] !== undefined)
      let avgNorm = 0
      if (codesWithBaseline.length > 0) {
        let sum = 0
        codesWithBaseline.forEach(code => {
          sum += interpolatedData[code][d]! / baselines[code]
        })
        avgNorm = sum / codesWithBaseline.length
      }

      seriesKeys.forEach(code => {
        const val = interpolatedData[code][d]
        if (val !== null && val !== undefined && baselines[code] === undefined) {
          baselines[code] = avgNorm === 0 ? val : val / avgNorm
          startAbsolutePrices[code] = val
        }
      })
    })

    // Generate series data for the whole date range
    return seriesKeys.map(code => {
      const dataPoints = allDates.map(d => {
        const val = interpolatedData[code][d]
        if (val === null || val === undefined || baselines[code] === undefined) {
          return [d, null, null, null]
        }
        return [d, val / baselines[code], val, startAbsolutePrices[code]]
      }).filter(p => p[1] !== null)

      return {
        name: code,
        type: 'line',
        showSymbol: false,
        data: dataPoints,
      }
    })
  }, [allDates, zoomRange, interpolatedData, seriesKeys])

  const chartOption = useMemo(() => {
    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (params: any) => {
          let html = `<div>${params[0].axisValue}</div>`
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          params.forEach((p: any) => {
            const [, , abs, startAbs] = p.data
            const pct = startAbs ? ((abs - startAbs) / startAbs * 100).toFixed(2) : '0.00'
            const sign = Number(pct) >= 0 ? '+' : ''
            const color = p.color
            html += `
              <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
                <span style="display: flex; align-items: center;">
                  <span style="display:inline-block;margin-right:4px;border-radius:10px;width:10px;height:10px;background-color:${color};"></span>
                  <span style="margin-right:12px;">${p.seriesName}</span>
                </span>
                <span style="font-family: monospace; font-weight: bold;">
                  ${abs.toFixed(2)} (<span style="color: ${Number(pct) >= 0 ? '#ef4444' : '#22c55e'}">${sign}${pct}%</span>)
                </span>
              </div>
            `
          })
          return html
        }
      },
      legend: {
        data: seriesKeys,
        type: 'scroll',
        bottom: 0,
      },
      xAxis: {
        type: 'time',
      },
      yAxis: {
        type: 'value',
        scale: true,
      },
      dataZoom: [
        {
          type: 'inside',
          startValue: zoomRange?.startValue,
          endValue: zoomRange?.endValue
        },
        {
          startValue: zoomRange?.startValue,
          endValue: zoomRange?.endValue
        }
      ],
      series: normalizedSeries,
    }
  }, [seriesKeys, normalizedSeries, zoomRange])

  const handleEvents = useMemo(() => {
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      datazoom: (_e: any, chart: any) => {
        const option = chart.getOption()
        let startValue, endValue

        // Sometimes the event has start/end instead of startValue/endValue
        // so it's safer to get the exact value from the echarts instance
        if (option.dataZoom && option.dataZoom.length > 0) {
          startValue = option.dataZoom[0].startValue
          endValue = option.dataZoom[0].endValue
          setZoomRange({ startValue, endValue })
        }
      }
    }
  }, [])

  if (loading) return <p>{text.loading}</p>

  return (
    <section>
      <h2>{text.title}</h2>
      <div style={{ background: '#fff', padding: '16px', borderRadius: '8px' }}>
        <ReactECharts
          option={chartOption}
          style={{ height: 600, width: '100%' }}
          onEvents={handleEvents}
        />
      </div>
    </section>
  )
}
