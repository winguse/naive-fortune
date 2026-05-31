import fs from 'node:fs/promises'
import path from 'node:path'

const MARKET_DATA_LAYOUT = {
  us: ['FXAIX', 'QQQM'],
  cn: ['159399', '159222', '563020', '510050', '510300'],
}

const CN_SECID = {
  '159399': '0.159399',
  '159222': '0.159222',
  '563020': '1.563020',
  '510050': '1.510050',
  '510300': '1.510300',
}

const parseArgs = () => {
  const args = new Map()
  for (let i = 2; i < process.argv.length; i += 1) {
    const [key, value] = process.argv[i].split('=')
    args.set(key, value ?? 'true')
  }
  return {
    marketDir: args.get('--market-dir') ?? path.resolve(process.cwd(), 'public/market-data'),
    fixMode: args.get('--fix-mode') === 'true',
  }
}

const toCsv = (rows) => ['date,close,open', ...rows.map((row) => `${row.date},${row.close},${row.open ?? ''}`)].join('\n')

const parseCsv = (csv) => {
  const lines = csv.trim().split(/\r?\n/)
  if (lines.length === 0) return []
  if (lines[0].trim() !== 'date,close,open') {
    throw new Error('Invalid CSV header')
  }

  return lines.slice(1).filter(Boolean).map((line) => {
    const [date, close, open] = line.split(',')
    return { date, close: Number(close), open: open === '' || open == null ? null : Number(open) }
  })
}

const validateRows = (rows) => {
  let prevDate = ''
  const seen = new Set()

  for (const row of rows) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) throw new Error(`Invalid date ${row.date}`)
    if (seen.has(row.date)) throw new Error(`Duplicate date ${row.date}`)
    if (prevDate && row.date < prevDate) throw new Error('Dates are not ascending')
    if (!(row.close > 0)) throw new Error(`Invalid close for ${row.date}`)
    if (!(row.open == null || row.open >= 0)) throw new Error(`Invalid open for ${row.date}`)
    seen.add(row.date)
    prevDate = row.date
  }
}

const fetchUSFromStooq = async (code) => {
  const url = `https://stooq.com/q/d/l/?s=${code.toLowerCase()}.us&i=d`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to fetch US ${code} from stooq`)
  const text = await response.text()
  const lines = text.trim().split(/\r?\n/).slice(1)
  return lines
    .filter(Boolean)
    .map((line) => {
      const [date, open, , , close] = line.split(',')
      return { date, close: Number(close), open: open ? Number(open) : null }
    })
    .filter((row) => row.date && Number.isFinite(row.close) && row.close > 0)
}

const fetchUSFromYahoo = async (code) => {
  const start = new Date('2010-01-01T00:00:00Z')
  const end = new Date()
  const rowsByDate = new Map()

  for (let current = new Date(start); current <= end; current.setUTCFullYear(current.getUTCFullYear() + 2)) {
    const period1 = Math.floor(current.getTime() / 1000)
    const periodEnd = new Date(current)
    periodEnd.setUTCFullYear(periodEnd.getUTCFullYear() + 2)
    const period2 = Math.floor(Math.min(periodEnd.getTime(), end.getTime()) / 1000)
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${code}?period1=${period1}&period2=${period2}&interval=1d&includePrePost=false&events=history`
    const response = await fetch(url)
    if (!response.ok) {
      const payload = await response.json().catch(() => null)
      const message = payload?.chart?.error?.description ?? ''
      if (response.status === 400 && message.includes("Data doesn't exist")) {
        continue
      }
      throw new Error(`Failed to fetch US ${code} from yahoo`)
    }
    const payload = await response.json()
    const result = payload?.chart?.result?.[0]
    const timestamps = result?.timestamp ?? []
    const quote = result?.indicators?.quote?.[0] ?? {}
    for (let index = 0; index < timestamps.length; index += 1) {
      const ts = timestamps[index]
      const date = new Date(ts * 1000).toISOString().slice(0, 10)
      const close = Number(quote.close?.[index])
      const open = quote.open?.[index] == null ? null : Number(quote.open[index])
      if (date && Number.isFinite(close) && close > 0) {
        rowsByDate.set(date, { date, close, open })
      }
    }
  }

  return [...rowsByDate.values()]
}

const isLikelyDaily = (rows) => {
  if (rows.length < 30) return false
  let maxGap = 0
  for (let i = 1; i < rows.length; i += 1) {
    const prev = new Date(`${rows[i - 1].date}T00:00:00Z`)
    const curr = new Date(`${rows[i].date}T00:00:00Z`)
    const gap = Math.round((curr.getTime() - prev.getTime()) / (24 * 60 * 60 * 1000))
    if (gap > maxGap) maxGap = gap
  }
  return maxGap <= 10
}

const fetchUS = async (code) => {
  const sources = [fetchUSFromYahoo, fetchUSFromStooq]
  let lastError
  for (const source of sources) {
    try {
      const rows = await source(code)
      if (rows.length > 0 && isLikelyDaily(rows)) {
        return rows.sort((a, b) => a.date.localeCompare(b.date))
      }
    } catch (error) {
      lastError = error
    }
  }
  throw lastError ?? new Error(`No daily US data source available for ${code}`)
}

const fetchCN = async (code) => {
  const secid = CN_SECID[code]
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&klt=101&fqt=1&fields1=f1,f2,f3&fields2=f51,f52,f53`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to fetch CN ${code}`)
  const data = await response.json()
  const klines = data?.data?.klines ?? []
  return klines
    .map((line) => {
      const [date, open, close] = line.split(',')
      return {
        date,
        close: Number(close),
        open: open ? Number(open) : null,
      }
    })
    .filter((row) => row.date && Number.isFinite(row.close) && row.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
}

const loadExisting = async (file) => {
  try {
    const raw = await fs.readFile(file, 'utf-8')
    return parseCsv(raw)
  } catch {
    return []
  }
}

const mergeRows = ({ existingRows, fetchedRows, fixMode }) => {
  const existingByDate = new Map(existingRows.map((row) => [row.date, row]))
  for (const row of fetchedRows) {
    if (!existingByDate.has(row.date)) {
      existingByDate.set(row.date, row)
      continue
    }
    if (fixMode) {
      existingByDate.set(row.date, row)
    }
  }

  const merged = [...existingByDate.values()].sort((a, b) => a.date.localeCompare(b.date))

  const existingDates = new Set(existingRows.map((row) => row.date))
  const mergedDates = new Set(merged.map((row) => row.date))
  for (const date of existingDates) {
    if (!mergedDates.has(date)) {
      throw new Error(`Historical date removed: ${date}`)
    }
  }

  if (merged.length < existingRows.length) {
    throw new Error('Merged rows unexpectedly reduced')
  }

  return merged
}

const ensureLayout = async (marketDir) => {
  await fs.mkdir(path.join(marketDir, 'us'), { recursive: true })
  await fs.mkdir(path.join(marketDir, 'cn'), { recursive: true })

  const allFiles = await fs.readdir(marketDir)
  for (const entry of allFiles) {
    if (!['us', 'cn'].includes(entry)) {
      throw new Error(`Unexpected path in market-data root: ${entry}`)
    }
  }
}

const updateOne = async ({ marketDir, market, code, fixMode }) => {
  const file = path.join(marketDir, market, `${code}.csv`)
  const existingRows = await loadExisting(file)
  validateRows(existingRows)

  const fetchedRows = market === 'us' ? await fetchUS(code) : await fetchCN(code)
  validateRows(fetchedRows)

  const mergedRows = mergeRows({ existingRows, fetchedRows, fixMode })
  validateRows(mergedRows)

  await fs.writeFile(file, `${toCsv(mergedRows)}\n`, 'utf-8')
  return { code, before: existingRows.length, after: mergedRows.length }
}

const main = async () => {
  const { marketDir, fixMode } = parseArgs()
  await ensureLayout(marketDir)

  const results = []
  for (const [market, codes] of Object.entries(MARKET_DATA_LAYOUT)) {
    for (const code of codes) {
      const summary = await updateOne({ marketDir, market, code, fixMode })
      results.push(summary)
      console.log(`${code}: ${summary.before} -> ${summary.after}`)
    }
  }

  for (const [market, codes] of Object.entries(MARKET_DATA_LAYOUT)) {
    const allowed = new Set(codes.map((code) => `${code}.csv`))
    const files = await fs.readdir(path.join(marketDir, market))
    for (const file of files) {
      if (!allowed.has(file)) {
        await fs.unlink(path.join(marketDir, market, file))
      }
    }
  }

  console.log('Market data update complete')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
