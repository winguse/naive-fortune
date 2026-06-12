const fs = require('fs');
const content = fs.readFileSync('src/pages/MarketPage.tsx', 'utf-8');

const replacement = `
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
        formatter: (params: any) => {
          let html = \`<div>\${params[0].axisValue}</div>\`
          params.forEach((p: any) => {
            const [date, norm, abs, startAbs] = p.data
            const pct = startAbs ? ((abs - startAbs) / startAbs * 100).toFixed(2) : '0.00'
            const sign = Number(pct) >= 0 ? '+' : ''
            const color = p.color
            html += \`
              <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
                <span style="display: flex; align-items: center;">
                  <span style="display:inline-block;margin-right:4px;border-radius:10px;width:10px;height:10px;background-color:\${color};"></span>
                  <span style="margin-right:12px;">\${p.seriesName}</span>
                </span>
                <span style="font-family: monospace; font-weight: bold;">
                  \${abs.toFixed(2)} (<span style="color: \${Number(pct) >= 0 ? '#ef4444' : '#22c55e'}">\${sign}\${pct}%</span>)
                </span>
              </div>
            \`
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
`

const updatedContent = content.replace(
  /  const seriesKeys = Object.keys\(marketData\)\n\n  const chartOption = useMemo\(\(\) => \{\n[\s\S]*?  \}, \[marketData, seriesKeys\]\)/,
  replacement.trim()
);

fs.writeFileSync('src/pages/MarketPage.tsx', updatedContent);
