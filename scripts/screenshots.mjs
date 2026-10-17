// Regenerates the README screenshots in docs/images/ from the production build:
//
//   npm run build && npm run screenshots
//
// It serves the existing dist/ with `vite preview` on a free port (never 4173, which the end-to-end
// tests use), drives Chromium with Playwright and uses only the bundled examples and the synthetic
// fixtures in tests/fixtures/, so the images can be rebuilt on any machine with the same result.
// Pass shot names to rebuild only some of them: `npm run screenshots -- hero-fit sheet-picker`.
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { preview } from 'vite'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'docs', 'images')
const fixtures = join(root, 'tests', 'fixtures', 'import')
const VIEWPORT = { width: 1440, height: 900 }
// GitHub shows README images at most about 900 px wide: scale 1.5 stays sharp on high-density
// screens and keeps each file near 200 KB (scale 2 roughly doubles that).
const SCALE = 1.5
const SIZE_LIMIT = 300 * 1024

if (!existsSync(join(root, 'dist', 'index.html'))) {
  console.error('dist/ is missing: run `npm run build` first.')
  process.exit(1)
}

/** First free TCP port from `from` on, skipping the one the end-to-end tests use. */
async function freePort(from) {
  for (let port = from; port < from + 100; port++) {
    if (port === 4173) continue
    const free = await new Promise((resolve) => {
      const probe = createServer()
      probe.once('error', () => resolve(false))
      probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)))
    })
    if (free) return port
  }
  throw new Error(`no free port in ${from}-${from + 99}`)
}

// ---------------------------------------------------------------------------------------------------
// Page helpers

/** No hover label, focus ring or half-loaded font in the picture. */
async function tidy(page) {
  await page.evaluate(() => document.fonts.ready)
  await page.mouse.move(VIEWPORT.width - 2, VIEWPORT.height - 2)
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  })
}

/** Every pane shows its plot and the autosave has finished, so nothing is captured half drawn. */
async function settle(page, panes = 1) {
  await page
    .locator('[data-plot-ready]')
    .nth(panes - 1)
    .waitFor({ timeout: 30_000 })
  // Autosave runs after every edit; wait for it so the top bar does not show a spinner.
  await page
    .getByText(/^(Saved in this browser|Salvato in questo browser)$/)
    .waitFor({ timeout: 10_000 })
    .catch(() => {})
  await tidy(page)
  // Plotly redraws once more after the panels settle.
  await page.waitForTimeout(600)
}

async function choose(page, label, option) {
  await page.getByRole('combobox', { name: label, exact: true }).first().click()
  await page
    .getByRole('option', typeof option === 'string' ? { name: option, exact: true } : { name: option })
    .click()
}

const inspectorTab = (page, name) =>
  page.locator('aside [data-slot="tabs-list"]').getByRole('tab', { name, exact: true })

async function loadExample(page, id) {
  await page.locator(`[data-example="${id}"]`).first().click()
  await settle(page)
}

async function nameProject(page, name) {
  const field = page.getByRole('textbox', { name: /^(Project name|Nome del progetto)$/ })
  await field.fill(name)
  await field.press('Enter')
}

/** Moves the divider between the plot and the data table down by `dy` pixels (a smaller table). */
async function resizeTable(page, dy) {
  const handle = page.locator('[data-slot="resizable-handle"][aria-orientation="horizontal"]').first()
  const b = await handle.boundingBox()
  if (!b) throw new Error('the divider above the data table is not on screen')
  const x = b.x + b.width / 2
  const y = b.y + b.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, y + dy, { steps: 6 })
  await page.mouse.up()
}

/** Makes pane `index` the focused pane (a click on its header, away from the plot and its menus). */
async function focusPane(page, index) {
  const pane = page.locator(`[data-plot-pane="${index}"]`)
  const box = await pane.boundingBox()
  await pane.click({ position: { x: box.width / 2, y: 12 } })
}

async function save(page, name) {
  const path = join(outDir, `${name}.png`)
  await page.screenshot({ path, animations: 'disabled', caret: 'hide' })
  const size = statSync(path).size
  const note = size > SIZE_LIMIT ? '  (over 300 KB: crop it or lower the scale)' : ''
  console.log(`${relative(root, path)}  ${Math.round(size / 1024)} KB${note}`)
}

// ---------------------------------------------------------------------------------------------------
// Shots

const SHOTS = {
  /** Ohm's law: scatter, linear fit, residual panel and the parameter table. */
  async 'hero-fit'(page) {
    await loadExample(page, 'ohm')
    await nameProject(page, 'Resistor characteristic')
    await inspectorTab(page, 'Fit').click()
    await page.getByTestId('add-fit').click()
    await page.getByTestId('fit-parameters').waitFor()
    await resizeTable(page, 130)
    await settle(page)
    await save(page, 'hero-fit')
  },

  /** Four plot types from four examples in the 2 × 2 layout. */
  async 'multi-plot'(page) {
    await loadExample(page, 'free-fall')
    await nameProject(page, 'Mechanics and chemistry lab')
    await page.getByRole('button', { name: 'Four in a grid' }).click()
    // Each example added to the project opens in a plot of its own, in the next empty pane.
    for (const id of ['cooling', 'beer-lambert', 'pendulum']) {
      await page.getByRole('button', { name: 'Add data' }).click()
      await page.getByRole('menuitem', { name: 'Example datasets' }).click()
      await page.getByRole('dialog').locator(`[data-example="${id}"]`).click()
      await page.getByRole('dialog').waitFor({ state: 'hidden' })
    }
    await settle(page, 4)
    // Free fall with a quadratic fit.
    await focusPane(page, 0)
    await inspectorTab(page, 'Fit').click()
    await page.getByTestId('add-fit').click()
    await choose(page, 'Model', 'Polynomial')
    // The cooling cup as a line plot.
    await focusPane(page, 1)
    await choose(page, 'Plot type', 'Line')
    // Calibration replicates as bars of the mean per concentration.
    await focusPane(page, 2)
    await choose(page, 'Plot type', 'Bar')
    // Pendulum timings, one box per observer.
    await focusPane(page, 3)
    await choose(page, 'Plot type', 'Box plot')
    // Back to the free fall plot, so the data panel, the table and the inspector all describe the
    // focused pane.
    await focusPane(page, 0)
    await inspectorTab(page, 'Plot').click()
    await settle(page, 4)
    await save(page, 'multi-plot')
  },

  /** The sheet picker on the synthetic workbook: every table outlined, all selected, merge offered. */
  async 'sheet-picker'(page) {
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: /Open a file/ }).click()
    await (await chooser).setFiles(join(fixtures, 'micro-tables.xlsx'))
    const picker = page.getByRole('dialog', { name: 'Choose the tables to import' })
    await picker.getByRole('grid', { name: /^Sheet / }).focus()
    await page.keyboard.press('ControlOrMeta+a')
    await picker.getByTestId('merge-proposal').waitFor()
    await tidy(page)
    await page.waitForTimeout(400)
    await save(page, 'sheet-picker')
  },

  /** Pendulum timings split by observer, one fit per observer and the per-group table. */
  async 'split-groups'(page) {
    await loadExample(page, 'pendulum')
    await nameProject(page, 'Pendulum timing')
    await choose(page, 'Plot type', 'Scatter')
    await inspectorTab(page, 'Plot').click()
    await choose(page, 'Split by', /^observer/)
    await inspectorTab(page, 'Fit').click()
    await page.getByTestId('add-fit').click()
    await page.getByRole('switch', { name: 'Fit each group separately' }).click()
    await page.getByTestId('fit-group-table').waitFor()
    await resizeTable(page, 130)
    await settle(page)
    await save(page, 'split-groups')
  },

  /** The Italian interface: the pendulum timings as a stacked histogram, with descriptive statistics. */
  async italian(page) {
    await loadExample(page, 'pendulum')
    await nameProject(page, 'Laboratorio di meccanica')
    await choose(page, 'Tipo di grafico', 'Istogramma')
    await inspectorTab(page, 'Grafico').click()
    await choose(page, 'Raggruppa per', /^observer/)
    await choose(page, 'Gruppi disegnati', 'Impilati')
    await inspectorTab(page, 'Statistiche').click()
    await resizeTable(page, 130)
    await settle(page)
    await save(page, 'italian')
  },
}

// ---------------------------------------------------------------------------------------------------

const wanted = process.argv.slice(2)
for (const name of wanted) {
  if (!(name in SHOTS)) {
    console.error(`unknown shot "${name}"; known: ${Object.keys(SHOTS).join(', ')}`)
    process.exit(1)
  }
}
mkdirSync(outDir, { recursive: true })

const port = await freePort(4180)
const server = await preview({
  root,
  logLevel: 'warn',
  preview: { port, strictPort: true, host: '127.0.0.1', open: false },
})
const browser = await chromium.launch()
let failed = false
try {
  for (const [name, shot] of Object.entries(SHOTS)) {
    if (wanted.length && !wanted.includes(name)) continue
    const lang = name === 'italian' ? 'it' : 'en'
    // Four panes need the height the data table would take.
    const tableOpen = name !== 'multi-plot'
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: SCALE,
      // The service worker would keep serving an older build after a rebuild.
      serviceWorkers: 'block',
      reducedMotion: 'reduce',
      colorScheme: 'light',
      locale: lang === 'it' ? 'it-IT' : 'en-GB',
    })
    // A fresh browser in the shot's language, with the contextual hints off (they cover the plot).
    await context.addInitScript(
      ({ lang, tableOpen }) => {
        localStorage.setItem('brief.lang', lang)
        localStorage.setItem(
          'brief.prefs',
          JSON.stringify({ level: 'intermediate', hints: false, tableOpen }),
        )
      },
      { lang, tableOpen },
    )
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    try {
      await page.goto(`http://127.0.0.1:${port}/`)
      await shot(page)
      if (errors.length) throw new Error(errors.join('\n'))
    } catch (e) {
      failed = true
      console.error(`${name}: ${e instanceof Error ? e.message : e}`)
    } finally {
      await context.close()
    }
  }
} finally {
  await browser.close()
  await new Promise((resolve) => server.httpServer.close(resolve))
}
process.exit(failed ? 1 : 0)
