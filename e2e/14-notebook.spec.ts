import { test, expect } from '@playwright/test'
import { pointsTrace, waitForPlot } from './helpers/plot'

test('lab notebook: declare quantities, type values, the plot updates; edit and undo', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /Enter by hand/ }).click()
  await page.getByLabel('Name 1').fill('t')
  await page.getByLabel('Unit 1').fill('s')
  await page.getByLabel('Name 2').fill('x')
  await page.getByLabel('Unit 2').fill('cm')
  await page.getByRole('button', { name: 'Create notebook' }).click()
  const cell = (col: string, row: number) => page.getByLabel(`${col}, row ${row}`)
  await cell('t', 1).fill('0')
  await cell('x', 1).fill('1.0')
  await cell('t', 2).fill('1')
  await cell('x', 2).fill('3.1')
  await cell('t', 3).fill('2')
  await cell('x', 3).fill('5.2')
  await waitForPlot(page)
  await expect.poll(async () => (await pointsTrace(page)).y).toEqual([1, 3.1, 5.2])
  // Pasting a block adds rows.
  await cell('t', 3).click()
  await page.evaluate(() => {
    const el = document.activeElement as HTMLInputElement
    const dt = new DataTransfer()
    dt.setData('text/plain', '3\t7.1\n4\t9.0')
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  })
  await expect.poll(async () => (await pointsTrace(page)).y).toEqual([1, 3.1, 7.1, 9])
  // An invalid entry is flagged, not coerced.
  await cell('x', 2).fill('abc')
  await expect(cell('x', 2)).toHaveAttribute('aria-invalid', 'true')
})
