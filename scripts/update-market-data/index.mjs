import fs from 'node:fs/promises'
import path from 'node:path'

const MARKET_DATA_LAYOUT = {
  us: ['FXAIX', 'QQQM'],
  cn: ['159399', '159222', '563020', '510050', '510300'],
}

const CN_SECID = {
  159399: '0.159399',
  159222: '0.159222',
  563020: '1.563020',
  510050: '1.510050',
  510300: '1.510300',
}

const parseArgs = () => {
  const args = new Map()
  for (let i = 2; i < process.argv.length; i += 1) {
    const [key, value] = process.argv[i].split('=')
    args.set(key, value ?? 'true')
  }
  return {
    marketDir:
      args.get('--market-dir') ??
      path.resolve(process.cwd(), 'public/market-data'),
    fixMode: args.get('--fix-mode') === 'true',
  }
}

const toCsv = (rows) =>
  [
    'date,close,open',
    ...rows.map((row) => `${row.date},${row.close},${row.open ?? ''}`),
  ].join('\n')

const parseCsv = (csv) => {
  const lines = csv.trim().split(/\r?\n/)
  if (lines.length === 0) return []
  if (lines[0].trim() !== 'date,close,open') {
    throw new Error('Invalid CSV header')
  }

  return lines
    .slice(1)
    .filter(Boolean)
    .map((line) => {
      const [date, close, open] = line.split(',')
      return {
        date,
        close: Number(close),
        open: open === '' || open == null ? null : Number(open),
      }
    })
}

const validateRows = (rows) => {
  let prevDate = ''
  const seen = new Set()

  for (const row of rows) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date))
      throw new Error(`Invalid date ${row.date}`)
    if (seen.has(row.date)) throw new Error(`Duplicate date ${row.date}`)
    if (prevDate && row.date < prevDate)
      throw new Error('Dates are not ascending')
    if (!(row.close > 0)) throw new Error(`Invalid close for ${row.date}`)
    if (!(row.open == null || row.open >= 0))
      throw new Error(`Invalid open for ${row.date}`)
    seen.add(row.date)
    prevDate = row.date
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const RETRYABLE_ERROR_CODES = new Set([
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'ECONNRESET',
  'ETIMEDOUT',
  'EAI_AGAIN',
])

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Safari/605.1.15'

const isRetryableFetchError = (error) => {
  if (error?.name === 'AbortError') return true
  const code = error?.cause?.code ?? error?.code
  return RETRYABLE_ERROR_CODES.has(code)
}

const fetchWithRetry = async (
  url,
  { label, retries = 4, timeoutMs = 12000, headers } = {},
) => {
  let lastError = null

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': DEFAULT_USER_AGENT,
          ...headers,
        },
      })

      if (
        (response.status === 429 || response.status >= 500) &&
        attempt < retries
      ) {
        await sleep(attempt * 400)
        continue
      }

      return response
    } catch (error) {
      lastError = error
      if (attempt === retries || !isRetryableFetchError(error)) {
        throw error
      }
      await sleep(attempt * 400)
    } finally {
      clearTimeout(timer)
    }
  }

  throw lastError ?? new Error(`Failed to fetch ${label ?? url}`)
}

const fetchUSFromStooq = async (code) => {
  const stooqApiKey = process.env.STOOQ_API_KEY?.trim()
  if (!stooqApiKey) {
    throw new Error('Missing STOOQ_API_KEY for Stooq request')
  }
  const url = `https://stooq.com/q/d/l/?s=${code.toLowerCase()}.us&i=d&apikey=${encodeURIComponent(stooqApiKey)}`
  const response = await fetchWithRetry(url, {
    label: `US ${code} from stooq`,
  })
  if (!response.ok) throw new Error(`Failed to fetch US ${code} from stooq`)
  const text = await response.text()
  if (text.includes('Get your apikey')) {
    throw new Error(`Stooq now requires an API key for ${code}`)
  }
  const lines = text.trim().split(/\r?\n/).slice(1)
  return lines
    .filter(Boolean)
    .map((line) => {
      const [date, open, , , close] = line.split(',')
      return { date, close: Number(close), open: open ? Number(open) : null }
    })
    .filter((row) => row.date && Number.isFinite(row.close) && row.close > 0)
}

const fetchUSFromAlphaVantage = async (code) => {
  const alphaVantageApiKey = process.env.ALPHA_VANTAGE_API_KEY?.trim()
  if (!alphaVantageApiKey) {
    throw new Error(
      'Missing ALPHA_VANTAGE_API_KEY for Alpha Vantage request',
    )
  }

  const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY_ADJUSTED&symbol=${encodeURIComponent(
    code.toUpperCase(),
  )}&outputsize=full&apikey=${encodeURIComponent(alphaVantageApiKey)}`
  const response = await fetchWithRetry(url, {
    label: `US ${code} from alpha vantage`,
    retries: 3,
    timeoutMs: 10000,
    headers: { Accept: 'application/json,text/plain,*/*' },
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const detail = (
      payload?.['Error Message'] ??
      payload?.Note ??
      payload?.Information ??
      ''
    )
      .toString()
      .slice(0, 200)
    throw new Error(
      `Failed to fetch US ${code} from alpha vantage: HTTP ${response.status}${detail ? ` ${detail}` : ''}`,
    )
  }

  const explicitError = payload?.['Error Message']
  if (typeof explicitError === 'string' && explicitError.trim()) {
    throw new Error(`Alpha Vantage error for ${code}: ${explicitError}`)
  }

  const limitMessage = payload?.Note ?? payload?.Information
  if (typeof limitMessage === 'string' && limitMessage.trim()) {
    throw new Error(
      `Alpha Vantage rate limit/info for ${code}: ${limitMessage.slice(0, 200)}`,
    )
  }

  const series = payload?.['Time Series (Daily)']
  if (!series || typeof series !== 'object') {
    throw new Error(`Unexpected Alpha Vantage payload for ${code}`)
  }

  return Object.entries(series)
    .map(([date, point]) => {
      const openValue = point?.['1. open']
      return {
        date,
        close: Number(point?.['4. close']),
        open: openValue == null || openValue === '' ? null : Number(openValue),
      }
    })
    .filter(
      (row) =>
        row.date &&
        Number.isFinite(row.close) &&
        row.close > 0 &&
        (row.open == null || Number.isFinite(row.open)),
    )
    .sort((a, b) => a.date.localeCompare(b.date))
}

const getYahooCrumb = async () => {
  const cookieResp = await fetchWithRetry('https://fc.yahoo.com', {
    label: 'yahoo cookie',
    retries: 2,
    timeoutMs: 8000,
  })
  const rawCookie = cookieResp.headers.get('set-cookie') ?? ''
  const cookie = rawCookie
    .split(',')
    .map((s) => s.trim().split(';')[0])
    .filter((s) => /^[A-Za-z0-9_]+=/.test(s))
    .join('; ')

  const crumbResp = await fetchWithRetry(
    'https://query1.finance.yahoo.com/v1/test/getcrumb',
    {
      label: 'yahoo crumb',
      retries: 2,
      timeoutMs: 8000,
      headers: { Cookie: cookie },
    },
  )

  if (!crumbResp.ok) {
    throw new Error(`Failed to get Yahoo crumb: HTTP ${crumbResp.status}`)
  }

  const crumb = await crumbResp.text()
  if (!crumb || crumb.includes('Requests') || crumb.length > 20) {
    throw new Error(`Unexpected Yahoo crumb response: ${crumb.slice(0, 50)}`)
  }

  return { crumb, cookie }
}

const fetchUSFromYahoo = async (code) => {
  const { crumb, cookie } = await getYahooCrumb()

  const start = new Date('1988-01-01T00:00:00Z')
  const end = new Date()
  const rowsByDate = new Map()

  for (
    let current = new Date(start);
    current <= end;
    current.setUTCFullYear(current.getUTCFullYear() + 3)
  ) {
    const period1 = Math.floor(current.getTime() / 1000)
    const periodEnd = new Date(current)
    periodEnd.setUTCFullYear(periodEnd.getUTCFullYear() + 3)
    const period2 = Math.floor(
      Math.min(periodEnd.getTime(), end.getTime()) / 1000,
    )
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${code}?period1=${period1}&period2=${period2}&interval=1d&includePrePost=false&events=history&crumb=${encodeURIComponent(crumb)}`
    const response = await fetchWithRetry(url, {
      label: `US ${code} from yahoo`,
      headers: { Cookie: cookie },
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => null)
      const message = payload?.chart?.error?.description ?? ''
      if (response.status === 400 && message.includes("Data doesn't exist")) {
        continue
      }
      throw new Error(
        `Failed to fetch US ${code} from yahoo: HTTP ${response.status}`,
      )
    }
    const payload = await response.json()
    const result = payload?.chart?.result?.[0]
    const timestamps = result?.timestamp ?? []
    const quote = result?.indicators?.quote?.[0] ?? {}
    for (let index = 0; index < timestamps.length; index += 1) {
      const ts = timestamps[index]
      const date = new Date(ts * 1000).toISOString().slice(0, 10)
      const close = Number(quote.close?.[index])
      const open =
        quote.open?.[index] == null ? null : Number(quote.open[index])
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
    const gap = Math.round(
      (curr.getTime() - prev.getTime()) / (24 * 60 * 60 * 1000),
    )
    if (gap > maxGap) maxGap = gap
  }
  return maxGap <= 10
}

const fetchUS = async (code) => {
  const sources = [fetchUSFromYahoo, fetchUSFromAlphaVantage, fetchUSFromStooq]
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

const fetchCNFromEastmoney = async (code) => {
  const secid = CN_SECID[code]
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&klt=101&fqt=0&fields1=f1,f2,f3&fields2=f51,f52,f53`
  const response = await fetchWithRetry(url, {
    label: `CN ${code}`,
    retries: 2,
    timeoutMs: 6000,
    headers: {
      'User-Agent': DEFAULT_USER_AGENT,
      Accept: 'application/json,text/plain,*/*',
      Referer: 'https://quote.eastmoney.com/',
    },
  })
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 200)
    throw new Error(
      `Failed to fetch CN ${code}: HTTP ${response.status}${detail ? ` ${detail}` : ''}`,
    )
  }
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

const decodeEastmoneyContent = (content) =>
  content
    .replace(/\\\//g, '/')
    .replace(/\\"/g, '"')
    .replace(/\\r\\n/g, '')

const parseFundHistoryRows = (html) => {
  const rows = []
  const trRegex = /<tr>([\s\S]*?)<\/tr>/g

  for (const match of html.matchAll(trRegex)) {
    const tr = match[1]
    const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((cell) =>
      cell[1]
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .trim(),
    )
    if (cells.length < 2) continue

    const date = cells[0].replace(/\//g, '-')
    const close = Number(cells[1])
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    if (!Number.isFinite(close) || close <= 0) continue

    rows.push({
      date,
      close,
      open: null,
    })
  }

  return rows
}

const fetchCNFromEastmoneyFundHistory = async (code) => {
  const pageSize = 49
  const rowsByDate = new Map()
  let totalPages = 1

  for (let page = 1; page <= totalPages; page += 1) {
    const url = `https://fundf10.eastmoney.com/F10DataApi.aspx?type=lsjz&code=${code}&page=${page}&per=${pageSize}&sdate=&edate=`
    const response = await fetchWithRetry(url, {
      label: `CN ${code} from eastmoney fund history page ${page}`,
      retries: 2,
      timeoutMs: 8000,
      headers: {
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        Referer: `https://fundf10.eastmoney.com/jjjz_${code}.html`,
      },
    })

    if (!response.ok) {
      throw new Error(
        `Failed to fetch CN ${code} fund history page ${page}: HTTP ${response.status}`,
      )
    }

    const payload = await response.text()
    const contentMatch = payload.match(/content:\"([\s\S]*?)\",records:/)
    if (!contentMatch) break

    const html = decodeEastmoneyContent(contentMatch[1])
    const rows = parseFundHistoryRows(html)
    for (const row of rows) {
      rowsByDate.set(row.date, row)
    }

    const pagesMatch = payload.match(/pages:(\d+)/)
    if (pagesMatch) {
      totalPages = Number(pagesMatch[1])
    }

    if (rows.length === 0) {
      break
    }
  }

  return [...rowsByDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

const toSinaSymbol = (code) => {
  const secid = CN_SECID[code]
  if (!secid) throw new Error(`Unsupported CN code ${code}`)
  const [market] = secid.split('.')
  return `${market === '0' ? 'sz' : 'sh'}${code}`
}

const toTencentSymbol = (code) => toSinaSymbol(code)

const pickTencentQuoteNode = (payload, symbol) => {
  const direct = payload?.data?.[symbol]
  if (direct) return direct
  const values = Object.values(payload?.data ?? {})
  return values[0]
}

const fetchCNFromTencentKline = async (code) => {
  const symbol = toTencentSymbol(code)
  const url = `https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param=${symbol},day,,,1200`
  const response = await fetchWithRetry(url, {
    label: `CN ${code} from tencent kline`,
    headers: {
      'User-Agent': DEFAULT_USER_AGENT,
      Accept: 'application/json,text/plain,*/*',
      Referer: 'https://gu.qq.com/',
    },
  })

  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 200)
    throw new Error(
      `Failed to fetch CN ${code} from tencent kline: HTTP ${response.status}${detail ? ` ${detail}` : ''}`,
    )
  }

  const payload = await response.json()
  const quoteNode = pickTencentQuoteNode(payload, symbol)
  const rows = quoteNode?.day ?? []

  return rows
    .map((item) => ({
      date: item[0],
      open: item[1] == null ? null : Number(item[1]),
      close: Number(item[2]),
    }))
    .filter((row) => row.date && Number.isFinite(row.close) && row.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
}

const fetchCNFromTencentFq = async (code) => {
  const symbol = toTencentSymbol(code)
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},day,,,1200,qfq`
  const response = await fetchWithRetry(url, {
    label: `CN ${code} from tencent fqkline`,
    headers: {
      'User-Agent': DEFAULT_USER_AGENT,
      Accept: 'application/json,text/plain,*/*',
      Referer: 'https://gu.qq.com/',
    },
  })

  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 200)
    throw new Error(
      `Failed to fetch CN ${code} from tencent fqkline: HTTP ${response.status}${detail ? ` ${detail}` : ''}`,
    )
  }

  const payload = await response.json()
  const quoteNode = pickTencentQuoteNode(payload, symbol)
  const rows = quoteNode?.day ?? []

  return rows
    .map((item) => ({
      date: item[0],
      open: item[1] == null ? null : Number(item[1]),
      close: Number(item[2]),
    }))
    .filter((row) => row.date && Number.isFinite(row.close) && row.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
}

const fetchCNFromSina = async (code) => {
  const symbol = toSinaSymbol(code)
  const url = `https://quotes.sina.cn/cn/api/openapi.php/CN_MarketDataService.getKLineData?symbol=${symbol}&scale=240&ma=no&datalen=1023`
  const response = await fetchWithRetry(url, {
    label: `CN ${code} from sina`,
    headers: {
      'User-Agent': DEFAULT_USER_AGENT,
      Accept: 'application/json,text/plain,*/*',
      Referer: 'https://finance.sina.com.cn/',
    },
  })

  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 200)
    throw new Error(
      `Failed to fetch CN ${code} from sina: HTTP ${response.status}${detail ? ` ${detail}` : ''}`,
    )
  }

  const payload = await response.json()
  const rows = payload?.result?.data ?? []
  return rows
    .map((row) => ({
      date: row.day,
      close: Number(row.close),
      open: row.open == null ? null : Number(row.open),
    }))
    .filter((row) => row.date && Number.isFinite(row.close) && row.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
}

const compareByDate = (baseRows, refRows) => {
  const refByDate = new Map(refRows.map((row) => [row.date, row]))
  let overlap = 0
  let mismatches = 0
  let maxRelativeDiff = 0

  for (const row of baseRows) {
    const ref = refByDate.get(row.date)
    if (!ref) continue
    overlap += 1
    const relativeDiff =
      Math.abs(row.close - ref.close) / Math.max(row.close, ref.close, 1e-9)
    if (relativeDiff > 0.02) mismatches += 1
    if (relativeDiff > maxRelativeDiff) maxRelativeDiff = relativeDiff
  }

  return {
    overlap,
    mismatches,
    mismatchRate: overlap > 0 ? mismatches / overlap : 0,
    maxRelativeDiff,
  }
}

const verifyCNRows = (code, chosen, candidates) => {
  const comparable = candidates.filter(
    (candidate) => candidate.name !== chosen.name,
  )
  let strictComparisons = 0

  for (const candidate of comparable) {
    const stats = compareByDate(chosen.rows, candidate.rows)
    if (stats.overlap < 60) {
      continue
    }

    strictComparisons += 1
    if (stats.mismatchRate > 0.05) {
      throw new Error(
        `CN ${code} data mismatch between ${chosen.name} and ${candidate.name} (overlap=${stats.overlap}, mismatchRate=${(stats.mismatchRate * 100).toFixed(2)}%)`,
      )
    }
  }

  if (strictComparisons === 0) {
    console.warn(
      `[warn] ${code}: no independent CN source with enough overlap for strict verification`,
    )
  }
}

const fetchCN = async (code) => {
  const sources = [
    { name: 'eastmoney-fund-history', fetch: fetchCNFromEastmoneyFundHistory },
    { name: 'tencent-kline', fetch: fetchCNFromTencentKline },
    { name: 'sina', fetch: fetchCNFromSina },
    { name: 'eastmoney', fetch: fetchCNFromEastmoney },
    { name: 'tencent-fqkline', fetch: fetchCNFromTencentFq },
  ]

  const candidates = []
  let lastError
  for (const source of sources) {
    try {
      const rows = await source.fetch(code)
      if (rows.length > 0) {
        candidates.push({ name: source.name, rows })
      }
    } catch (error) {
      lastError = error
    }
  }

  if (candidates.length === 0) {
    throw (
      lastError ?? new Error(`No daily CN data source available for ${code}`)
    )
  }

  candidates.sort((a, b) => b.rows.length - a.rows.length)
  const chosen = candidates[0]

  verifyCNRows(code, chosen, candidates)
  console.log(`[cn] ${code}: source=${chosen.name}, rows=${chosen.rows.length}`)
  return chosen.rows
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

  const merged = [...existingByDate.values()].sort((a, b) =>
    a.date.localeCompare(b.date),
  )

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

  let fetchedRows
  try {
    fetchedRows = market === 'us' ? await fetchUS(code) : await fetchCN(code)
  } catch (error) {
    if (existingRows.length > 0) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(
        `[warn] ${code}: fetch failed, keeping existing rows (${message})`,
      )
      return {
        code,
        before: existingRows.length,
        after: existingRows.length,
        skipped: true,
      }
    }
    throw error
  }

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
      console.log(
        `${code}: ${summary.before} -> ${summary.after}${summary.skipped ? ' (fetch skipped)' : ''}`,
      )
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
