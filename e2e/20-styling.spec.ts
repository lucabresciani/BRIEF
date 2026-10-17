import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { guardPage, inspectorTab, loadExample, plot, traces, type TraceInfo } from './helpers/plot'

/** Picks `option` (an exact name, or a pattern for options that carry a hint line) in a select. */
async function choose(page: Page, label: string, option: string | RegExp) {
  await page.getByRole('combobox', { name: label, exact: true }).first().click()
  await page
    .getByRole('option', typeof option === 'string' ? { name: option, exact: true } : { name: option })
    .click()
}

const byRole = (ts: TraceInfo[], role: string) => ts.filter((t) => t.uid?.endsWith(`__${role}`))

/** The pendulum example (T measured by observers A and B) as T against trial, split by observer. */
async function pendulumByObserver(page: Page) {
  await page.goto('/')
  await loadExample(page, 'pendulum')
  await choose(page, 'Plot type', 'Scatter')
  await inspectorTab(page, 'Plot').click()
  await choose(page, 'Split by', /^observer/)
  await expect.poll(async () => byRole(await traces(page), 'points').length).toBe(2)
}

test('split by observer: two colours and markers, per-group fits, a fit line restyled', async ({ page }) => {
  const guard = await guardPage(page)
  await pendulumByObserver(page)

  // One curve per observer, told apart by colour AND marker (colour is never the only cue).
  const points = byRole(await traces(page), 'points')
  expect(points.map((t) => t.name)).toEqual(['A', 'B'])
  expect(points.map((t) => t.marker?.color)).toEqual(['#0072B2', '#D55E00'])
  expect(points.map((t) => t.marker?.symbol)).toEqual(['circle', 'square'])
  expect(points.map((t) => t.x.length)).toEqual([12, 12])
  // The Plot tab lists the groups with the same markers.
  const groups = page.getByRole('list', { name: 'Groups of T' })
  await expect(groups.getByRole('listitem')).toHaveText(['A', 'B'])

  // A pooled fit first: one neutral curve over both observers.
  await inspectorTab(page, 'Fit').click()
  await page.getByTestId('add-fit').click()
  await expect.poll(async () => byRole(await traces(page), 'fit').length).toBe(1)
  await expect(page.getByTestId('fit-n')).toHaveText('24 of 24')

  // Then one fit per observer, each in its group's colour, and a table with one row per group.
  await page.getByRole('switch', { name: 'Fit each group separately' }).click()
  await expect.poll(async () => byRole(await traces(page), 'fit').length).toBe(2)
  const fits = byRole(await traces(page), 'fit')
  expect(fits.map((t) => t.line?.color)).toEqual(['#0072B2', '#D55E00'])
  // Scatter plot: the automatic fit line is solid and 2.25 px wide.
  expect(fits.map((t) => [t.line?.dash, t.line?.width])).toEqual([
    ['solid', 2.25],
    ['solid', 2.25],
  ])
  const table = page.getByTestId('fit-group-table')
  await expect(table.getByRole('rowheader')).toHaveText(['A', 'B'])
  await expect(table.getByRole('row').nth(1).getByRole('cell').nth(3)).toHaveText('12')

  // Exports: the analysis table says each row's group and takes the prediction from its group's own
  // fit; the figure's caption names the groups.
  await page.getByRole('button', { name: 'Export figure' }).click()
  let dl = page.waitForEvent('download')
  await page.getByTestId('export-csv-analysis').click()
  const csv = readFileSync(await (await dl).path(), 'utf8')
    .trim()
    .split(/\r?\n/)
  const header = csv[0].split(',')
  expect(header.slice(-5)).toEqual(['group', 'status', 'in_fit', 'predicted', 'residual'])
  const rows = csv.slice(1).map((l) => l.split(','))
  const at = (name: string) => header.indexOf(name)
  expect(rows.filter((r) => r[at('group')] === 'A')).toHaveLength(12)
  expect(rows.filter((r) => r[at('group')] === 'B')).toHaveLength(12)
  expect(rows.every((r) => r[at('in_fit')] === '1' && r[at('predicted')] !== '')).toBe(true)
  // Same trial, different observer: two different fits, two different predictions.
  const predictedAt = (group: string) => rows.find((r) => r[at('group')] === group)![at('predicted')]
  expect(predictedAt('A')).not.toBe(predictedAt('B'))
  dl = page.waitForEvent('download')
  await page.getByTestId('export-svg').click()
  const svg = readFileSync(await (await dl).path(), 'utf8')
  expect(svg).toContain('Groups by observer: A: n = 12, B: n = 12.')
  await page.keyboard.press('Escape')

  // Style tab: a dotted, 3 px fit line in wine, for every group's fit.
  await inspectorTab(page, 'Style').click()
  const fitLine = page.getByRole('group', { name: 'Fit line' })
  await expect(page.getByRole('combobox', { name: 'Pattern', exact: true })).toContainText(
    'Automatic (Solid)',
  )
  await choose(page, 'Pattern', 'Dotted')
  // Units follow a non-breaking space.
  await choose(page, 'Width', /^3\spx$/)
  await fitLine.getByRole('radio', { name: 'Wine' }).click()
  await expect
    .poll(async () =>
      byRole(await traces(page), 'fit').map((t) => [t.line?.dash, t.line?.width, t.line?.color]),
    )
    .toEqual([
      ['dot', 3, '#882255'],
      ['dot', 3, '#882255'],
    ])

  // A group's own colour and marker win over the automatic ones.
  await choose(page, 'Colour of B', 'Black')
  await choose(page, 'Marker of B', 'Diagonal cross')
  await expect
    .poll(async () => byRole(await traces(page), 'points').map((t) => [t.marker?.color, t.marker?.symbol]))
    .toEqual([
      ['#0072B2', 'circle'],
      ['#000000', 'x'],
    ])
  // Undo puts the automatic marker back.
  await page.keyboard.press('Control+z')
  await expect
    .poll(async () => byRole(await traces(page), 'points').map((t) => t.marker?.symbol))
    .toEqual(['circle', 'square'])

  expect(guard.errors).toEqual([])
  expect(await guard.csp()).toEqual([])
})

test('histogram grouped by observer: overlaid on shared bins, then stacked', async ({ page }) => {
  const guard = await guardPage(page)
  await page.goto('/')
  await loadExample(page, 'pendulum')
  await choose(page, 'Plot type', 'Histogram')
  await inspectorTab(page, 'Plot').click()
  await choose(page, 'Group by', /^observer/)
  await expect.poll(async () => byRole(await traces(page), 'histogram').length).toBe(2)
  const bars = byRole(await traces(page), 'histogram')
  expect(bars.map((t) => t.name)).toEqual(['A', 'B'])
  // The same bin centres for both groups, and every observation counted once.
  expect(bars[0].x).toEqual(bars[1].x)
  const total = bars.flatMap((t) => t.y as number[]).reduce((a, b) => a + b, 0)
  expect(total).toBe(24)
  const barmode = () =>
    plot(page).evaluate((gd) => (gd as unknown as { _fullLayout: { barmode: string } })._fullLayout.barmode)
  expect(await barmode()).toBe('overlay')

  await choose(page, 'Groups drawn', 'Stacked')
  await expect.poll(barmode).toBe('stack')
  expect(guard.errors).toEqual([])
})
