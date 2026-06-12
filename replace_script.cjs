const fs = require('fs');
const content = fs.readFileSync('src/pages/MarketPage.tsx', 'utf-8');

const updatedContent = content.replace(
  /\/\/ Aggregate points for each code\n  \/\/ Each line is an ETF\n  const seriesKeys = Object.keys\(marketData\)/g,
  `// Extract all dates
  const allDates = useMemo(() => {
    const dates = new Set<string>()
    Object.values(marketData).forEach(data => data.forEach(c => dates.add(c.date)))
    return Array.from(dates).sort()
  }, [marketData])

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

  const seriesKeys = Object.keys(marketData)`
);

fs.writeFileSync('src/pages/MarketPage.tsx', updatedContent);
