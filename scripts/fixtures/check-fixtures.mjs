// Fails when a test fixture carries a trace of the machine or the person that produced it. Excel saves the
// folder of the workbook (x15ac:absPath) and the Office user name (author fields, the WRITEACCESS record
// of .xls), and a path to a user folder can hide in any file. Office and OpenDocument files are zip archives
// whose XML is usually deflated, so every entry is inflated and scanned too; binary .xls files store text
// as 8-bit or UTF-16LE, so both readings are scanned.
//
// Usage: node scripts/fixtures/check-fixtures.mjs [directory]   (default: tests/fixtures)
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { inflateRawSync } from 'node:zlib'

/**
 * The git identity of whoever runs the check (full name, e-mail): fixtures are made on a contributor's
 * machine, so that is the name a regenerated file would carry. The account name is not matched on its
 * own (it is often a plain word such as "test"); in a saved path it is caught by the folder markers.
 */
function gitIdentity() {
  const out = []
  for (const key of ['user.name', 'user.email']) {
    const r = spawnSync('git', ['config', '--get', key], { encoding: 'utf8' })
    if (r.status === 0 && r.stdout.trim().length >= 5) out.push(r.stdout.trim())
  }
  return out
}

/** Case-insensitive markers of a saved folder, a user or temp folder, or the local git identity. */
const MARKERS = ['absPath', 'Users\\', 'Users/', '/home/', 'AppData', 'scratchpad', ...gitIdentity()]
/** Author fields of docProps/core.xml and docProps/app.xml (Office) and meta.xml (OpenDocument). */
const AUTHOR_FIELDS =
  /<(dc:creator|cp:lastModifiedBy|meta:initial-creator|meta:printed-by|Company|Manager)>([^<]*)</g
/** The only names a fixture may carry: none, or the placeholder excel-fixtures.ps1 saves with. */
const PLACEHOLDER_NAMES = new Set(['', 'fixture'])

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
  )
}

/**
 * UTF-16LE code units from byte `start` as Latin-1 text (other units become NUL). The markers are ASCII,
 * so this is enough to find them, at either alignment and in buffers of odd length.
 */
function utf16AsLatin1(b, start) {
  const out = Buffer.alloc(Math.max(0, Math.floor((b.length - start) / 2)))
  for (let j = 0; j < out.length; j++) out[j] = b[start + 2 * j + 1] === 0 ? b[start + 2 * j] : 0
  return out.toString('latin1')
}

function markersIn(b) {
  const found = new Set()
  for (const text of [b.toString('latin1'), utf16AsLatin1(b, 0), utf16AsLatin1(b, 1)]) {
    const lower = text.toLowerCase()
    for (const m of MARKERS) if (lower.includes(m.toLowerCase())) found.add(m)
  }
  return [...found]
}

/** The entries of a zip archive (stored or deflated), read from its central directory; null if not a zip. */
function zipEntries(b) {
  if (b.length < 22 || b.readUInt32LE(0) !== 0x04034b50) return null
  let eocd = -1
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff) && eocd < 0; i--) {
    if (b.readUInt32LE(i) === 0x06054b50) eocd = i
  }
  if (eocd < 0) throw new Error('zip without an end of central directory')
  const entries = []
  let p = b.readUInt32LE(eocd + 16)
  for (let k = b.readUInt16LE(eocd + 10); k > 0; k--) {
    if (b.readUInt32LE(p) !== 0x02014b50) throw new Error('broken zip central directory')
    const method = b.readUInt16LE(p + 10)
    const size = b.readUInt32LE(p + 20)
    const nameLen = b.readUInt16LE(p + 28)
    const local = b.readUInt32LE(p + 42)
    const name = b.subarray(p + 46, p + 46 + nameLen).toString('utf8')
    if (method !== 0 && method !== 8) throw new Error(`${name}: unsupported zip compression ${method}`)
    const start = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28)
    const raw = b.subarray(start, start + size)
    entries.push({ name, data: method === 8 ? inflateRawSync(raw) : raw })
    p += 46 + nameLen + b.readUInt16LE(p + 30) + b.readUInt16LE(p + 32)
  }
  return entries
}

/**
 * The user names in the WRITEACCESS records (type 0x5C, 112 bytes, or 32 in files of Excel 95 itself) of a
 * .xls, padded with spaces: a BIFF8 string (16-bit length, a flags byte whose bit 0 means UTF-16LE, the
 * characters) or a BIFF5 one (8-bit length, 8-bit characters).
 */
function xlsUserNames(b) {
  const names = []
  for (let i = 0; i + 8 < b.length; i++) {
    if (b[i] !== 0x5c || b[i + 1] !== 0 || b[i + 3] !== 0 || (b[i + 2] !== 0x70 && b[i + 2] !== 0x20))
      continue
    const body = b.subarray(i + 4, i + 4 + b[i + 2])
    if (body.length < b[i + 2]) continue
    if (body[1] === 0 && body[2] <= 1) {
      const cch = body.readUInt16LE(0)
      const wide = body[2] === 1
      if (3 + cch * (wide ? 2 : 1) > body.length) continue
      const chars = Array.from({ length: cch }, (_, k) => (wide ? body.readUInt16LE(3 + 2 * k) : body[3 + k]))
      names.push(String.fromCharCode(...chars))
    } else if (1 + body[0] <= body.length) {
      names.push(body.subarray(1, 1 + body[0]).toString('latin1'))
    }
  }
  return names
}

/** Every problem of one file, as "<file>[ › <zip entry>]: <what>" lines. */
function problemsOf(name, b) {
  const out = markersIn(b).map((m) => `${name}: contains "${m}"`)
  const authors = (where, data) => {
    for (const [, field, value] of data.toString('utf8').matchAll(AUTHOR_FIELDS)) {
      if (!PLACEHOLDER_NAMES.has(value.trim())) out.push(`${where}: ${field} is "${value}"`)
    }
  }
  const entries = zipEntries(b)
  for (const e of entries ?? []) {
    for (const m of markersIn(e.data)) out.push(`${name} › ${e.name}: contains "${m}"`)
    if (/(^|\/)(core|app|meta)\.xml$/.test(e.name)) authors(`${name} › ${e.name}`, e.data)
  }
  // A flat OpenDocument file (.fods) keeps the same fields inline.
  if (!entries) authors(name, b)
  if (/\.xls$/i.test(name)) {
    for (const user of xlsUserNames(b)) {
      if (!PLACEHOLDER_NAMES.has(user.trim())) out.push(`${name}: WRITEACCESS user name is "${user.trim()}"`)
    }
  }
  return out
}

const root = resolve(process.argv[2] ?? join(import.meta.dirname, '..', '..', 'tests', 'fixtures'))
const problems = files(root).flatMap((f) => problemsOf(relative(process.cwd(), f), readFileSync(f)))
if (problems.length > 0) {
  console.error(`Fixtures with personal or local traces:\n${problems.map((p) => `  ${p}`).join('\n')}`)
  process.exit(1)
}
console.log(`ok: no personal or local traces in ${relative(process.cwd(), root) || '.'}`)
