import ReactECharts from 'echarts-for-react'

export const AssetPieChart = ({ data }: { data: Array<{ name: string; value: number }> }) => (
  <ReactECharts
    style={{ height: 320 }}
    option={{
      tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
      series: [
        {
          type: 'pie',
          radius: ['40%', '75%'],
          data,
        },
      ],
    }}
  />
)
