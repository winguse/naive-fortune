import ReactECharts from 'echarts-for-react'

interface Point {
  date: string
  series: Record<string, number>
}

export const AssetAreaChart = ({ points, seriesKeys }: { points: Point[]; seriesKeys: string[] }) => (
  <ReactECharts
    style={{ height: 360 }}
    option={{
      tooltip: { trigger: 'axis' },
      legend: { data: seriesKeys },
      xAxis: { type: 'category', data: points.map((point) => point.date) },
      yAxis: { type: 'value' },
      series: seriesKeys.map((key) => ({
        name: key,
        type: 'line',
        stack: 'total',
        areaStyle: {},
        showSymbol: false,
        data: points.map((point) => point.series[key] ?? 0),
      })),
    }}
  />
)
