import Papa from 'papaparse'
import dayjs from 'dayjs'
import type { MarketCandle } from '../../types/models'

const rowSchema = (row: Record<string, string>) => {
  const date = row.date?.trim()
  if (!date || !dayjs(date, 'YYYY-MM-DD', true).isValid()) return null

  const close = Number(row.close)
  if (!Number.isFinite(close) || close <= 0) return null

  const rawOpen = row.open?.trim()
  const open = rawOpen ? Number(rawOpen) : null
  if (rawOpen && (!Number.isFinite(open ?? Number.NaN) || (open ?? 0) < 0)) return null

  return { date, close, open }
}

export const parseMarketCsv = (csv: string): MarketCandle[] => {
  const { data } = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true })
  const rows = data
    .map(rowSchema)
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((a, b) => a.date.localeCompare(b.date))

  const uniqueRows: MarketCandle[] = []
  let prevDate = ''
  for (const row of rows) {
    if (row.date === prevDate) continue
    uniqueRows.push(row)
    prevDate = row.date
  }

  return uniqueRows
}
