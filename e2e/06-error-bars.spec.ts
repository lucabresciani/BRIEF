import { test, expect, type Page } from '@playwright/test'
import { inspectorTab, loadExample, plot, pointsTrace } from './helpers/plot'

async function choose(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label }).first().click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

test('error bars from the u(y) column, shown and hidden without changing the data', async ({ page }) => {
  await page.goto('/')
  await loadExample(page, 'free-fall')
  await inspectorTab(page, 'Uncertainty').click()
  await choose(page, 'What the bars show', 'Measurement uncertainty')
  await choose(page, 'Source', 'From a column')
  await choose(page, 'Column', 'u(y) (m)')
  await expect
    .poll(async () => (await pointsTrace(page)).error_y?.array?.slice(0, 3))
    .toEqual([0.002, 0.002, 0.003])
  const before = (await pointsTrace(page)).y
  await page.getByRole('switch', { name: 'Show error bars' }).click()
  await expect.poll(async () => (await pointsTrace(page)).error_y?.visible).toBe(false)
  expect((await pointsTrace(page)).y).toEqual(before)
})

test('replicate SEM on the calibration example: bars on group means, fit on observations', async ({
  page,
}) => {
  await page.goto('/')
  await loadExample(page, 'beer-lambert')
  await inspectorTab(page, 'Uncertainty').click()
  await choose(page, 'What the bars show', 'Standard error of the mean (SEM)')
  await expect(plot(page).locator('.legend')).toContainText('SEM')
  await expect(plot(page).locator('.legend')).toContainText('n = 3')
})
