import fs from 'node:fs/promises'
import path from 'node:path'

const src = process.argv[2]
const dest = process.argv[3] ?? path.resolve(process.cwd(), 'public/market-data')

if (!src) {
  throw new Error('Usage: node scripts/sync-market-data.mjs <market-data-dir> [dest]')
}

await fs.rm(dest, { recursive: true, force: true })
await fs.mkdir(dest, { recursive: true })
await fs.cp(src, dest, { recursive: true })

console.log(`Synced market data from ${src} to ${dest}`)
