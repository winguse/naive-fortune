import { INSTRUMENT_BY_CODE } from '../../config/instruments'
import type { MarketCandle } from '../../types/models'
import { parseMarketCsv } from './csv'

const cache = new Map<string, MarketCandle[]>()

export const loadMarketData = async (instrumentCode: string): Promise<MarketCandle[]> => {
  if (cache.has(instrumentCode)) return cache.get(instrumentCode) ?? []

  const instrument = INSTRUMENT_BY_CODE[instrumentCode]
  if (!instrument) return []

  const response = await fetch(`${import.meta.env.BASE_URL.replace(/\/$/, '')}${instrument.dataPath}`)
  if (!response.ok) throw new Error(`Failed to load market data for ${instrumentCode}`)

  const text = await response.text()
  const parsed = parseMarketCsv(text)
  cache.set(instrumentCode, parsed)
  return parsed
}

export const loadMarketDataBatch = async (codes: string[]) => {
  const entries = await Promise.all(codes.map(async (code) => [code, await loadMarketData(code)] as const))
  return Object.fromEntries(entries)
}
