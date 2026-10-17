import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { traces, waitForPlot } from './helpers/plot'

const fixtures = join(process.cwd(), 'tests', 'fixtures', 'import')
const MICRO = 'micro-tables.xlsx'

/** Drops a fixture on the window, as a file dragged from the desktop. */
async function dropFile(page: Page, name: string) {
  const b64 = readFileSync(join(fixtures, name)).toString('base64')
  await page.evaluate(
    ({ name, b64 }) => {
      const bin = atob(b64)
      const buf = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
      const dt = new DataTransfer()
      dt.items.add(new File([buf], name))
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
    },
    { name, b64 },
  )
}

async function openFile(page: Page, name: string) {
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: /Open a file/ }).click()
  await (await chooser).setFiles(join(fixtures, name))
}

const picker = (page: Page) => page.getByRole('dialog', { name: 'Choose the tables to import' })
const blocks = (page: Page) =>
  picker(page).getByRole('listbox', { name: 'Tables on this sheet' }).getByRole('option')
const sheetGrid = (page: Page) => picker(page).getByRole('grid', { name: /^Sheet / })
const dataTable = (page: Page) => page.getByRole('grid', { name: 'Data table' })
/** The card of a dataset in the data sidebar ("<name> 6 rows, 4 columns"). */
const datasetCard = (page: Page, name: string) =>
  page.getByRole('button').filter({ has: page.getByText(name, { exact: true }) })
const pointTraces = async (page: Page) => (await traces(page)).filter((t) => t.uid?.endsWith('__points'))

/** Grid geometry of the picker (src/features/import/sheetPicker/geometry.ts). */
const ROW_H = 24
const COL_W = 96
const HEAD_H = 24
const GUTTER_W = 56
const TOP_PAD = 18

/** Centre of grid cell (r, c) of the picker's sheet grid, in page coordinates. */
async function cellPoint(page: Page, r: number, c: number) {
  const box = (await sheetGrid(page).boundingBox())!
  const scroll = await sheetGrid(page).evaluate((el) => ({ x: el.scrollLeft, y: el.scrollTop }))
  return {
    x: box.x + GUTTER_W + (c + 0.5) * COL_W - scroll.x,
    y: box.y + HEAD_H + TOP_PAD + (r + 0.5) * ROW_H - scroll.y,
  }
}

test('a dropped workbook with six small tables opens the picker; merged, they make one dataset split by wood', async ({
  page,
}) => {
  await page.goto('/')
  await dropFile(page, MICRO)
  await expect(picker(page)).toBeVisible()
  await expect(picker(page).getByText(/6 tables found on “Grid”/)).toBeVisible()
  await expect(blocks(page)).toHaveCount(6)
  await expect(sheetGrid(page)).toBeFocused()
  await sheetGrid(page).press('Control+a')
  await expect(blocks(page).and(page.locator('[aria-selected="true"]'))).toHaveCount(6)
  const proposal = picker(page).getByTestId('merge-proposal')
  await expect(proposal).toContainText('6 tables share the columns position, Width mm, Depth mm, area')
  await expect(picker(page).getByTestId('picker-preview').getByRole('table')).toBeVisible()
  await picker(page).getByTestId('picker-merge').click()
  await expect(picker(page)).toBeHidden()
  await waitForPlot(page)

  // One dataset whose label columns say which table each row came from.
  await expect(datasetCard(page, 'micro-tables · Grid')).toBeVisible()
  await expect(dataTable(page).getByRole('columnheader', { name: 'Title 1' })).toBeVisible()
  await expect(dataTable(page).getByRole('columnheader', { name: 'plank' })).toBeVisible()
  // The scatter is split by the first label column: one curve per wood, 2 tables × 6 rows each.
  const points = await pointTraces(page)
  expect(points).toHaveLength(3)
  for (const p of points) expect(p.x).toHaveLength(12)

  // "Review" reopens the picker with the same selection; merged again without the plank label, the
  // plot still shows the same columns (nothing moved to the column that took its place).
  await page.getByRole('button', { name: 'Review', exact: true }).click()
  await expect(blocks(page).and(page.locator('[aria-selected="true"]'))).toHaveCount(6)
  await picker(page).getByRole('checkbox', { name: 'Add the label column plank' }).click()
  await picker(page).getByTestId('picker-merge').click()
  await expect(picker(page)).toBeHidden()
  await expect(dataTable(page).getByRole('columnheader', { name: 'plank' })).toHaveCount(0)
  const again = await pointTraces(page)
  expect(again.map((p) => [p.x, p.y])).toEqual(points.map((p) => [p.x, p.y]))
})

test('two tables imported separately (one undo step), and a range drawn over the cells', async ({ page }) => {
  await page.goto('/')
  await openFile(page, MICRO)
  await expect(blocks(page)).toHaveCount(6)

  // Escape clears the selection first, and only then closes the dialog.
  await blocks(page).nth(0).click()
  await expect(blocks(page).nth(0)).toHaveAttribute('aria-selected', 'true')
  await sheetGrid(page).focus()
  await page.keyboard.press('Escape')
  await expect(blocks(page).nth(0)).toHaveAttribute('aria-selected', 'false')
  await expect(picker(page)).toBeVisible()

  await blocks(page).nth(0).click()
  await blocks(page)
    .nth(1)
    .click({ modifiers: ['ControlOrMeta'] })
  await expect(picker(page).getByTestId('picker-separate')).toHaveText('Import 2 separately')
  await picker(page).getByTestId('picker-separate').click()
  await expect(picker(page)).toBeHidden()
  await waitForPlot(page)
  await expect(datasetCard(page, 'micro-tables · oak plank 1')).toBeVisible()
  await expect(datasetCard(page, 'micro-tables · pine plank 1')).toBeVisible()
  // Same column names: the second table is overlaid on the same plot as a second series.
  expect(await pointTraces(page)).toHaveLength(2)
  await page.getByRole('button', { name: /^Undo/ }).first().click()
  await expect(datasetCard(page, 'micro-tables · oak plank 1')).toHaveCount(0)
  await expect(datasetCard(page, 'micro-tables · pine plank 1')).toHaveCount(0)

  // A rectangle drawn over the header and data of the first table (B3:E9), leaving out its title.
  await openFile(page, MICRO)
  await expect(blocks(page)).toHaveCount(6)
  const from = await cellPoint(page, 1, 0)
  const to = await cellPoint(page, 7, 3)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (let k = 1; k <= 8; k++)
    await page.mouse.move(from.x + ((to.x - from.x) * k) / 8, from.y + ((to.y - from.y) * k) / 8)
  await page.mouse.up()
  const drawn = blocks(page).filter({ hasText: 'Your range' })
  await expect(drawn).toHaveAttribute('aria-selected', 'true')
  await expect(drawn).toContainText('B3:E9')
  await picker(page).getByTestId('picker-separate').click()
  await expect(picker(page)).toBeHidden()
  await expect(datasetCard(page, 'micro-tables · B3:E9')).toBeVisible()
  await expect(dataTable(page).getByRole('columnheader', { name: 'Width mm' })).toBeVisible()
})

test('transposed tables stacked: one dataset whose records are named by their sheet column', async ({
  page,
}) => {
  await page.goto('/')
  await openFile(page, MICRO)
  await picker(page).getByRole('tab', { name: 'Transposed' }).click()
  await expect(picker(page).getByText(/3 tables found on “Transposed”/)).toBeVisible()
  await expect(blocks(page).first()).toContainText('layers 0')
  await expect(blocks(page).first()).toContainText('Variables in rows')
  await sheetGrid(page).focus()
  await page.keyboard.press('Control+a')
  await expect(picker(page).getByTestId('merge-proposal')).toContainText(
    '3 tables share the columns duty, input, rise, loss',
  )
  await picker(page).getByTestId('picker-merge').click()
  await expect(picker(page)).toBeHidden()
  await waitForPlot(page)
  await expect(dataTable(page).getByRole('columnheader').first()).toHaveText('Column')
  await expect(dataTable(page).getByRole('rowheader').first()).toHaveText('C')
  await expect(dataTable(page).getByRole('rowheader').first()).toHaveAccessibleName('layers 0 · column C')
  await expect(dataTable(page).getByRole('columnheader', { name: 'layers' })).toBeVisible()
  // Split by layers: one curve per value (0, 2, 4), four records each.
  const points = await pointTraces(page)
  expect(points).toHaveLength(3)
  for (const p of points) expect(p.x).toHaveLength(4)
})

test('an Excel 97–2003 workbook goes through the picker too', async ({ page }) => {
  await page.goto('/')
  await openFile(page, 'biff8-tables.xls')
  await expect(picker(page)).toBeVisible()
  await expect(picker(page).getByText(/2 tables found on “Misure”/)).toBeVisible()
  await expect(blocks(page)).toHaveCount(2)
  await expect(blocks(page).nth(1)).toContainText('Pressione è')
  await sheetGrid(page).focus()
  await page.keyboard.press('Control+a')
  // Different columns: no merge proposal, each table becomes a dataset of its own.
  await expect(picker(page).getByTestId('merge-proposal')).toHaveCount(0)
  await picker(page).getByTestId('picker-separate').click()
  await expect(picker(page)).toBeHidden()
  await waitForPlot(page)
  await expect(datasetCard(page, 'biff8-tables · A1:F5')).toBeVisible()
  await expect(datasetCard(page, 'biff8-tables · Pressione è')).toBeVisible()
  await expect(dataTable(page).getByRole('columnheader', { name: /Tensione/ })).toContainText('µV')
})
