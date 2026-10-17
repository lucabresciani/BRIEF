import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { inspectorTab, loadExample } from './helpers/plot'

test('exports PNG (real image, ×3), SVG (titles, indicator, equation) and CSV', async ({ page }) => {
  await page.goto('/')
  await loadExample(page, 'ohm')
  await inspectorTab(page, 'Fit').click()
  await page.getByTestId('add-fit').click()
  await page.locator('[role="row"][data-row-id]').nth(2).click()
  await page.getByRole('button', { name: 'Exclude from analysis' }).click()
  await page.getByTestId('confirm-exclusion').click()

  await page.getByRole('button', { name: 'Export figure' }).click()
  let dl = page.waitForEvent('download')
  await page.getByTestId('export-png').click()
  // Named after the dataset (the project has no name) and the plot: '{dataset} – {plot}'.
  expect((await dl).suggestedFilename()).toBe('Ohm-s-law-V-vs-I.png')
  const png = readFileSync(await (await dl).path())
  expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
  expect(png.readUInt32BE(16)).toBe(3000) // IHDR width = 1000 px × 3

  dl = page.waitForEvent('download')
  await page.getByTestId('export-svg').click()
  const svg = readFileSync(await (await dl).path(), 'utf8')
  expect(svg).toContain('<svg')
  expect(svg).toMatch(/I \(A\)/)
  expect(svg).toMatch(/V \(V\)/)
  expect(svg).toMatch(/n = 9 of 10/)
  expect(svg).toMatch(/47\.1/)

  dl = page.waitForEvent('download')
  await page.getByTestId('export-csv-analysis').click()
  const csv = readFileSync(await (await dl).path(), 'utf8')
  expect(csv.split('\n')[0]).toMatch(/in_fit/)
})
