// One-off generator for the fixtures Excel and LibreOffice cannot produce (they always cache formula results).
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
const XLSX = await import(
  pathToFileURL(join(import.meta.dirname, '..', '..', 'node_modules', 'xlsx', 'xlsx.mjs')).href
)
const out = process.argv[2]

// formula-no-cache.xlsx: column C holds formulas whose results were never computed (as written by openpyxl & co.)
const ws = XLSX.utils.aoa_to_sheet([
  ['x (s)', 'y (m)', 'twice y (m)'],
  [1, 0.5, null],
  [2, 1.25, null],
  [3, 2, null],
])
ws['C2'] = { t: 'n', f: 'B2*2' }
ws['C3'] = { t: 'n', f: 'B3*2' }
ws['C4'] = { t: 'n', v: 4, f: 'B4*2' } // this one has a cached value
const wb = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
writeFileSync(join(out, 'formula-no-cache.xlsx'), XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))

// legacy.xls: only the OLE2 compound-file signature + empty header sector (enough for format rejection tests)
const ole = Buffer.alloc(512)
Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(ole)
writeFileSync(join(out, 'legacy.xls'), ole)
console.log('ok')
