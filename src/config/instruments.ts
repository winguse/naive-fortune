import type { Instrument, Market } from '../types/models'

export const INSTRUMENTS: Instrument[] = [
  {
    code: 'FXAIX',
    market: 'us',
    displayName: 'FIDELITY 500 INDEX FUND',
    currency: 'USD',
    dataPath: '/market-data/us/FXAIX.csv',
  },
  {
    code: 'QQQM',
    market: 'us',
    displayName: 'NASDAQ 100 INDEX FUND',
    currency: 'USD',
    dataPath: '/market-data/us/QQQM.csv',
  },
  {
    code: '159399',
    market: 'cn',
    displayName: '现金流ETF国泰（富时中国A股自由现金流聚焦指数）',
    currency: 'CNY',
    dataPath: '/market-data/cn/159399.csv',
  },
  {
    code: '159222',
    market: 'cn',
    displayName: '自由现金流ETF易方达（国证自由现金流指数）',
    currency: 'CNY',
    dataPath: '/market-data/cn/159222.csv',
  },
  {
    code: '563020',
    market: 'cn',
    displayName: '易方达场内ETF 563020',
    currency: 'CNY',
    dataPath: '/market-data/cn/563020.csv',
  },
  {
    code: '510050',
    market: 'cn',
    displayName: '上证50ETF',
    currency: 'CNY',
    dataPath: '/market-data/cn/510050.csv',
  },
  {
    code: '510300',
    market: 'cn',
    displayName: '沪深300ETF',
    currency: 'CNY',
    dataPath: '/market-data/cn/510300.csv',
  },
]

export const INSTRUMENT_BY_CODE = Object.fromEntries(INSTRUMENTS.map((item) => [item.code, item]))

export const instrumentsByMarket = (market: Market) =>
  INSTRUMENTS.filter((item) => item.market === market)
