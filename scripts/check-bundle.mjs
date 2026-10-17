// Post-build guard: verifies bundle structure assumptions that the app relies on.
// - Plotly lives in its own chunk (never in the entry chunk)
// - SheetJS and its code page tables (.xls) are lazy chunks of their own: never in the entry chunk, the
//   import worker or each other (the worker and the main-thread fallback each get a copy)
// - no eval / new Function in shipped JS (CSP without 'unsafe-eval')
// - the startup JS (the entry chunk plus the chunks index.html modulepreloads) stays within budget
// - THIRD_PARTY_LICENSES.md (linked from the help panel) lists the bundled libraries, the fonts and the
//   service worker runtime
// - when a service worker is built, Plotly, the code page tables, fonts, the worker and the licences are
//   precached
// Usage: node scripts/check-bundle.mjs [distDir]   (default: dist)
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const dist = process.argv[2] ? resolve(process.argv[2]) : join(import.meta.dirname, '..', 'dist')
const assets = join(dist, 'assets')
const errors = []
const files = readdirSync(assets)
const js = files.filter((f) => f.endsWith('.js'))

const html = readFileSync(join(dist, 'index.html'), 'utf8')
const entryMatch = html.match(/<script type="module" crossorigin src="\/assets\/([^"]+\.js)"/)
if (!entryMatch) errors.push('entry script not found in dist/index.html')
const entry = entryMatch?.[1]

// String literals that survive minification: one from each library.
const isSheetJs = (src) => src.includes('Cannot find Workbook stream')
const isCodepages = (src) => src.includes('Unrecognized CP: ')

let plotlyChunk = null
const sheetJsChunks = []
const codepageChunks = []
for (const f of js) {
  const src = readFileSync(join(assets, f), 'utf8')
  if (src.includes('plotly-notifier') && src.includes('js-plotly-plot')) plotlyChunk ??= f
  if (isSheetJs(src)) sheetJsChunks.push(f)
  if (isCodepages(src)) {
    codepageChunks.push(f)
    if (isSheetJs(src))
      errors.push(`${f}: the code page tables are bundled with SheetJS (must be a lazy chunk)`)
    if (f === entry || f.startsWith('import.worker'))
      errors.push(`${f}: the code page tables are in the entry or worker chunk (must be lazy)`)
  }
  if (/\beval\s*\(/.test(src)) errors.push(`${f}: contains eval(`)
  // Function.prototype.bind polyfills use "new Function" in some deps; flag any other use.
  const nf = src.match(/new Function\(/g)?.length ?? 0
  if (nf > 0) errors.push(`${f}: contains ${nf}× "new Function(" (CSP forbids unsafe-eval)`)
}
if (!plotlyChunk) errors.push('Plotly chunk not found')
if (plotlyChunk && plotlyChunk === entry) errors.push('Plotly is bundled in the entry chunk (must be lazy)')
if (sheetJsChunks.length === 0) errors.push('SheetJS chunk not found')
for (const f of sheetJsChunks)
  if (f === entry || f.startsWith('import.worker'))
    errors.push(`${f}: SheetJS is in the entry or worker chunk`)
if (codepageChunks.length === 0) errors.push('code page chunk (xlsx/dist/cpexcel.full.mjs) not found')

if (entry) {
  const kb = (f) => statSync(join(assets, f)).size / 1024
  // Once any chunk is lazy, Rolldown moves the code it shares with the app into chunks the entry imports
  // statically (and index.html preloads): the entry file alone then understates what loads at startup,
  // so the budget applies to the entry plus every preloaded chunk.
  const preloads = [
    ...html.matchAll(/<link rel="modulepreload" crossorigin href="\/assets\/([^"]+\.js)"/g),
  ].map((m) => m[1])
  const startup = kb(entry) + preloads.reduce((n, f) => n + kb(f), 0)
  // React DOM, Base UI and the scientific domain (~330 KB gzip). Plotly, SheetJS and zod are lazy chunks.
  const budget = 1100
  if (startup > budget)
    errors.push(
      `startup JS is ${startup.toFixed(0)} KB (entry ${entry} + ${preloads.length} preloaded chunks; budget ${budget} KB)`,
    )
  for (const f of preloads)
    if (f === plotlyChunk || sheetJsChunks.includes(f) || codepageChunks.includes(f))
      errors.push(`${f}: a lazy library is preloaded at startup`)
  console.log(
    `entry ${entry}: ${kb(entry).toFixed(0)} KB; startup with ${preloads.length} preloaded chunks: ${startup.toFixed(1)} KB (budget ${budget} KB)`,
  )
}
if (plotlyChunk)
  console.log(`plotly ${plotlyChunk}: ${(statSync(join(assets, plotlyChunk)).size / 1024).toFixed(0)} KB`)
for (const f of codepageChunks)
  console.log(`code pages ${f}: ${(statSync(join(assets, f)).size / 1024).toFixed(0)} KB`)

const LICENSES = 'THIRD_PARTY_LICENSES.md'
const licensesPath = join(dist, LICENSES)
if (!existsSync(licensesPath)) errors.push(`${LICENSES} not found (build.license in vite.config.ts)`)
else {
  const text = readFileSync(licensesPath, 'utf8')
  // One package of each kind: app code, a lazy chunk, a font and the service worker runtime.
  for (const name of [
    'react',
    'plotly.js-cartesian-dist-min',
    'xlsx',
    '@fontsource/ibm-plex-mono',
    'workbox-core',
  ])
    if (!text.includes(`\n## ${name} - `)) errors.push(`${LICENSES} does not list ${name}`)
}

const sw = join(dist, 'sw.js')
if (existsSync(sw)) {
  const swSrc = readFileSync(sw, 'utf8')
  if (plotlyChunk && !swSrc.includes(plotlyChunk))
    errors.push('service worker does not precache the Plotly chunk')
  for (const f of codepageChunks)
    if (!swSrc.includes(f)) errors.push(`service worker does not precache the code page chunk ${f}`)
  if (!/\.woff2/.test(swSrc)) errors.push('service worker does not precache fonts')
  if (!swSrc.includes(LICENSES)) errors.push(`service worker does not precache ${LICENSES}`)
  console.log('service worker precache checked')
}

if (errors.length) {
  console.error('check-bundle failed:\n- ' + errors.join('\n- '))
  process.exit(1)
}
console.log('check-bundle ok')
