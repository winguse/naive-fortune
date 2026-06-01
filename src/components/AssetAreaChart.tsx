import ReactECharts from 'echarts-for-react'
import * as echarts from 'echarts'

interface Point {
  date: string
  series: Record<string, number>
}

export const AssetAreaChart = ({
  points,
  seriesKeys,
  stacked = true,
  group,
  onChartReady,
}: {
  points: Point[]
  seriesKeys: string[]
  stacked?: boolean
  group?: string
  onChartReady?: (chart: echarts.ECharts) => void
}) => (
  <ReactECharts
    style={{ height: 360 }}
    onChartReady={(chart) => {
      if (group) {
        chart.group = group
        echarts.connect(group)
      }
      onChartReady?.(chart)
    }}
    option={{
      tooltip: { trigger: 'axis' },
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      legend: { data: seriesKeys },
      xAxis: { type: 'category', data: points.map((point) => point.date) },
      yAxis: { type: 'value', min: 0 },
      series: seriesKeys.map((key) => ({
        name: key,
        type: 'line',
        ...(stacked ? { stack: 'total' } : {}),
        areaStyle: {},
        showSymbol: false,
        data: points.map((point) => point.series[key] ?? 0),
      })),
    }}
  />
)
