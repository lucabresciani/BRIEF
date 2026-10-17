import { test, expect } from '@playwright/test'
import { join } from 'node:path'
import { pointsTrace, traces, waitForPlot } from './helpers/plot'

const fixtures = join(process.cwd(), 'tests', 'fixtures', 'import')

test('Italian CSV (semicolon, decimal comma, cp1252) imports directly and plots', async ({ page }) => {
  await page.goto('/')
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: /Open a file/ }).click()
  await (await chooser).setFiles(join(fixtures, 'it-cp1252-semicolon.csv'))
  await waitForPlot(page)
  const p = await pointsTrace(page)
  expect(p.x.length).toBeGreaterThan(2)
  expect(p.y.every((v) => typeof v === 'number' && Number.isFinite(v))).toBe(true)
  await expect(page.locator('[role="row"][data-row-id]').first()).toBeVisible()
})

test('pasting a TSV copied from a spreadsheet imports it', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => {
    const dt = new DataTransfer()
    dt.setData('text/plain', 'time (s)\tdistance (m)\n0\t0.00\n1\t0.52\n2\t1.98\n3\t4.41\n4\t7.85\n')
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }))
  })
  await waitForPlot(page)
  const p = await pointsTrace(page)
  expect(p.x).toEqual([0, 1, 2, 3, 4])
  expect(p.y).toEqual([0, 0.52, 1.98, 4.41, 7.85])
})

test('an ambiguous file opens the preview and lets the user decide', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /Paste from a spreadsheet/ }).click()
  await page.getByLabel('Table text').fill('a;b\n1,234;2\n2,345;4\n3,456;6')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: 'Check the import' })).toBeVisible()
  await expect(page.getByText(/could be/).first()).toBeVisible()
  await page.getByTestId('confirm-import').click()
  await waitForPlot(page)
})

test('XLSX workbook (saved by LibreOffice) imports numbers from the stored values', async ({ page }) => {
  await page.goto('/')
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: /Open a file/ }).click()
  await (await chooser).setFiles(join(fixtures, 'libreoffice-saved.xlsx'))
  const dialog = page.getByRole('heading', { name: 'Check the import' })
  if (await dialog.isVisible().catch(() => false)) await page.getByTestId('confirm-import').click()
  await waitForPlot(page)
  expect((await traces(page)).length).toBeGreaterThan(0)
})

test('a binary file is refused with a readable message', async ({ page }) => {
  await page.goto('/')
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: /Open a file/ }).click()
  await (
    await chooser
  ).setFiles({
    name: 'photo.dat',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from([0, 1, 2, 3, 0, 0, 255, 254, 0, 9, 0, 0, 0, 0, 7, 0]),
  })
  await expect(page.getByText(/not supported|nothing to import|No data rows/i).first()).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Start with your measurements' })).toBeVisible()
})
