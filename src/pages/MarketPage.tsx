import { useEffect, useState, useMemo } from 'react'
import { INSTRUMENTS } from '../config/instruments'
import { loadMarketDataBatch } from '../features/market-data/service'
import { isZh } from '../i18n/language'
import type { MarketCandle } from '../types/models'
import ReactECharts from 'echarts-for-react'

export const MarketPage = () => {
  const [marketData, setMarketData] = useState<Record<string, MarketCandle[]>>({})
  const [loading, setLoading] = useState(true)

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

  // Aggregate points for each code
  // Each line is an ETF
  const seriesKeys = Object.keys(marketData)

  const chartOption = useMemo(() => {
    const series = seriesKeys.map((code) => {
      const data = marketData[code].map((c) => [c.date, c.close])
      return {
        name: code,
        type: 'line',
        showSymbol: false,
        data,
      }
    })

    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
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
          start: 50,
          end: 100
        },
        {
          start: 50,
          end: 100
        }
      ],
      series,
    }
  }, [marketData, seriesKeys])

  if (loading) return <p>{text.loading}</p>

  return (
    <section>
      <h2>{text.title}</h2>
      <div style={{ background: '#fff', padding: '16px', borderRadius: '8px' }}>
        <ReactECharts option={chartOption} style={{ height: 600, width: '100%' }} />
      </div>
    </section>
  )
}
