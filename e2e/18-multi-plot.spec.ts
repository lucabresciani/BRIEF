import { test, expect, type Page } from '@playwright/test'
import {
  focusedPane,
  inspectorTab,
  layout,
  loadExample,
  plot,
  plotTab,
  pointsTrace,
  traces,
  waitForPlot,
} from './helpers/plot'

async function choose(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label }).first().click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

/** "New plot" → "From dataset" → the dataset: the suggested plot of that dataset, in a new tab. */
async function newPlotFrom(page: Page, dataset: string) {
  await page.getByRole('button', { name: 'New plot' }).first().click()
  await page.getByRole('menuitem', { name: 'From dataset' }).click()
  await page.getByRole('menuitem', { name: dataset, exact: true }).click()
}

/** The actions menu of a tab (an inactive tab shows its menu button on hover). */
async function tabMenu(page: Page, tab: string, action: string) {
  await plotTab(page, tab).hover()
  await page.getByRole('button', { name: `Actions for ${tab}`, exact: true }).click()
  await page.getByRole('menuitem', { name: action, exact: true }).click()
}

const tabLabels = (page: Page) =>
  page.getByRole('tablist', { name: 'Plots' }).getByRole('tab').allTextContents()
const editing = (page: Page) => page.getByTestId('inspector-editing')
/** A histogram counts along y. */
const yTitle = async (page: Page) => ((await layout(page)).yaxis as { title: string }).title
const xRange = async (page: Page) => ((await layout(page)).xaxis as { range: number[] }).range

/** Drag-zooms the focused pane's plot over the middle of its area. */
async function dragZoom(page: Page) {
  const b = (await plot(page).locator('.nsewdrag').first().boundingBox())!
  await page.mouse.move(b.x + b.width * 0.3, b.y + b.height * 0.3)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width * 0.6, b.y + b.height * 0.6, { steps: 8 })
  await page.mouse.up()
}

test('plot tabs: another type from the same data, rename, duplicate, a zoom per plot, delete and undo', async ({
  page,
}) => {
  await page.goto('/')
  await loadExample(page, 'ohm')
  expect(await tabLabels(page)).toEqual(['V vs I'])

  // A second plot of the same dataset, as a histogram; the first one stays a scatter plot.
  await newPlotFrom(page, "Ohm's law")
  await expect(plotTab(page, "Ohm's law")).toHaveAttribute('aria-selected', 'true')
  await choose(page, 'Plot type', 'Histogram')
  await expect.poll(() => yTitle(page)).toBe('Count')
  await plotTab(page, 'V vs I').click()
  await expect.poll(async () => (await pointsTrace(page)).mode).toBe('markers')

  // Rename by double click; Escape would cancel, Enter commits.
  await plotTab(page, "Ohm's law").dblclick()
  await page.getByRole('textbox', { name: 'Plot name' }).fill('Distribution of V')
  await page.keyboard.press('Enter')
  expect(await tabLabels(page)).toEqual(['V vs I', 'Distribution of V'])
  await expect(plotTab(page, 'Distribution of V')).toBeFocused()

  // Duplicate: the copy comes after its source and is shown.
  await tabMenu(page, 'V vs I', 'Duplicate')
  expect(await tabLabels(page)).toEqual(['V vs I', 'V vs I (copy)', 'Distribution of V'])
  await expect(plotTab(page, 'V vs I (copy)')).toHaveAttribute('aria-selected', 'true')

  // Each plot keeps its own zoom while another plot is shown in its place.
  await plotTab(page, 'V vs I').click()
  await waitForPlot(page)
  const full = await xRange(page)
  await dragZoom(page)
  await expect.poll(() => xRange(page)).not.toEqual(full)
  const zoomed = await xRange(page)
  await plotTab(page, 'Distribution of V').click()
  await expect.poll(() => yTitle(page)).toBe('Count')
  await plotTab(page, 'V vs I').click()
  await expect.poll(async () => (await traces(page)).some((t) => t.uid?.endsWith('__points'))).toBe(true)
  await expect
    .poll(async () => (await xRange(page)).map((v) => Number(v.toPrecision(6))))
    .toEqual(zoomed.map((v) => Number(v.toPrecision(6))))
  // The copy was never zoomed.
  await plotTab(page, 'V vs I (copy)').click()
  await expect.poll(() => xRange(page)).toEqual(full)

  // Delete, then Undo from the notice.
  await tabMenu(page, 'V vs I (copy)', 'Delete')
  expect(await tabLabels(page)).toEqual(['V vs I', 'Distribution of V'])
  const notice = page.locator('[data-slot="toast"]').filter({ hasText: 'Plot deleted: V vs I (copy)' })
  await notice.getByRole('button', { name: 'Undo' }).click()
  expect(await tabLabels(page)).toEqual(['V vs I', 'V vs I (copy)', 'Distribution of V'])

  // Keyboard: arrows move the focus, Enter shows the plot.
  await plotTab(page, 'V vs I (copy)').focus()
  await page.keyboard.press('ArrowRight')
  await expect(plotTab(page, 'Distribution of V')).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(plotTab(page, 'Distribution of V')).toHaveAttribute('aria-selected', 'true')

  // Pressing another tab while typing a name commits the name and shows that tab, although the strip
  // reflows under the pointer when the field closes (the release lands beside the pressed tab).
  await plotTab(page, 'V vs I').dblclick()
  await page.getByRole('textbox', { name: 'Plot name' }).fill('First')
  const target = (await plotTab(page, 'V vs I (copy)').boundingBox())!
  await page.mouse.move(target.x + target.width - 40, target.y + target.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(100)
  await page.mouse.up()
  expect(await tabLabels(page)).toEqual(['First', 'V vs I (copy)', 'Distribution of V'])
  await expect(plotTab(page, 'V vs I (copy)')).toHaveAttribute('aria-selected', 'true')
  await expect(plotTab(page, 'V vs I (copy)')).toBeFocused()
})

test('two and four panes: the focused pane drives the toolbar and the inspector; a selection shows in every pane of its dataset', async ({
  page,
}) => {
  await page.goto('/')
  await loadExample(page, 'ohm')
  await newPlotFrom(page, "Ohm's law")
  await choose(page, 'Plot type', 'Line')

  await page.getByRole('button', { name: 'Two side by side' }).click()
  await waitForPlot(page, { panes: 2 })
  await expect(page.locator('[data-plot-pane]')).toHaveCount(2)
  // The focused plot keeps its place; the other plot fills the new pane.
  await expect(focusedPane(page)).toHaveAttribute('data-plot-pane', '0')
  await expect(editing(page)).toHaveText("Editing: Ohm's law")
  await expect(page.getByRole('combobox', { name: 'Plot type' })).toContainText('Line')

  // Clicking the other pane makes it the focused pane.
  const second = page.locator('[data-plot-pane="1"]')
  const box = (await second.boundingBox())!
  await second.click({ position: { x: box.width - 40, y: 14 } })
  await expect(second).toHaveAttribute('data-focused', '')
  await expect(editing(page)).toHaveText('Editing: V vs I')
  await expect(page.getByRole('combobox', { name: 'Plot type' })).toContainText('Scatter')

  // One selection, shown by both plots of the dataset.
  await page.locator('[role="row"][data-row-id]').nth(4).click()
  await expect.poll(async () => (await pointsTrace(page, 0)).selectedpoints).toEqual([4])
  await expect.poll(async () => (await pointsTrace(page, 1)).selectedpoints).toEqual([4])

  // Four panes: the two plots, then two empty panes until two more plots fill them.
  await page.getByRole('button', { name: 'Four in a grid' }).click()
  await expect(page.locator('[data-plot-pane]')).toHaveCount(4)
  await expect(page.getByText('Choose a plot', { exact: true }).first()).toBeVisible()
  await newPlotFrom(page, "Ohm's law")
  await newPlotFrom(page, "Ohm's law")
  await waitForPlot(page, { panes: 4 })
  await expect(page.locator('[data-plot-ready]')).toHaveCount(4)

  // Back to one pane: the focused plot stays on screen.
  const focusedPlot = await focusedPane(page).getAttribute('data-plot-id')
  await page.getByRole('button', { name: 'One plot' }).click()
  await waitForPlot(page)
  await expect(focusedPane(page)).toHaveAttribute('data-plot-id', focusedPlot!)
})

test('tabs and layout come back from a saved .sciplot file and after a reload', async ({ page, browser }) => {
  await page.goto('/')
  await loadExample(page, 'ohm')
  await newPlotFrom(page, "Ohm's law")
  await plotTab(page, "Ohm's law").dblclick()
  await page.getByRole('textbox', { name: 'Plot name' }).fill('Second')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Two side by side' }).click()
  await waitForPlot(page, { panes: 2 })

  await page.getByRole('button', { name: /Project/ }).click()
  const dl = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: /Save project/ }).click()
  const file = await (await dl).path()

  const ctx = await browser.newContext()
  const p2 = await ctx.newPage()
  await p2.goto('/')
  await p2.getByRole('button', { name: /Project/ }).click()
  const chooser = p2.waitForEvent('filechooser')
  await p2.getByRole('menuitem', { name: /Open project/ }).click()
  await (await chooser).setFiles(file)
  await waitForPlot(p2, { panes: 2 })
  expect(await tabLabels(p2)).toEqual(['V vs I', 'Second'])
  await expect(p2.getByRole('button', { name: 'Two side by side' })).toHaveAttribute('aria-pressed', 'true')
  await expect(plotTab(p2, 'Second')).toHaveAttribute('aria-selected', 'true')
  await ctx.close()

  // Browser storage: the layout is written with the next saved edit.
  await page.getByRole('button', { name: 'Four in a grid' }).click()
  await plotTab(page, 'V vs I').dblclick()
  await page.getByRole('textbox', { name: 'Plot name' }).fill('First')
  await page.keyboard.press('Enter')
  await expect(page.getByText('Saved in this browser')).toBeHidden()
  await expect(page.getByText('Saved in this browser')).toBeVisible({ timeout: 10_000 })
  await page.reload()
  await waitForPlot(page, { panes: 2 })
  expect(await tabLabels(page)).toEqual(['First', 'Second'])
  await expect(page.locator('[data-plot-pane]')).toHaveCount(4)
  await expect(page.getByRole('button', { name: 'Four in a grid' })).toHaveAttribute('aria-pressed', 'true')
})

test('a short pane gets the compact residual panel; back in one pane, the full one', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/')
  await loadExample(page, 'ohm')
  await inspectorTab(page, 'Fit').click()
  await page.getByTestId('add-fit').click()
  const residualAxis = async () => (await layout(page)).yaxis2 as { title: string; domain: number[] } | null
  await expect.poll(async () => (await residualAxis())?.domain).toEqual([0, 0.24])
  expect((await residualAxis())!.title).toMatch(/Residual/)

  // Four panes on a 720 px screen with the data table open: the plot area is under 240 px tall.
  await page.getByRole('button', { name: 'Four in a grid' }).click()
  const area = await focusedPane(page)
    .locator('.js-plotly-plot')
    .evaluate((el) => el.clientHeight)
  expect(area).toBeLessThan(240)
  await expect.poll(async () => (await residualAxis())?.domain).toEqual([0, 0.3])
  expect((await residualAxis())!.title).toBe('')

  await page.getByRole('button', { name: 'One plot' }).click()
  await waitForPlot(page)
  await expect.poll(async () => (await residualAxis())?.domain).toEqual([0, 0.24])
})
