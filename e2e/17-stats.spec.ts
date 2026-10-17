import { test, expect } from '@playwright/test'
import { inspectorTab, loadExample } from './helpers/plot'

test('descriptive statistics of the pendulum timings, with outlier candidates to investigate', async ({
  page,
}) => {
  await page.goto('/')
  await loadExample(page, 'pendulum')
  await inspectorTab(page, 'Statistics').click()
  const table = page.getByTestId('stats-table')
  await expect(table.locator('[data-stat="n"]')).toContainText('24')
  await expect(table.locator('[data-stat="sd"]')).toContainText('Standard deviation (sample)')
  await expect(table.locator('[data-stat="mean"]')).toContainText('1.74')
  await expect(table.locator('[data-stat="median"]')).toContainText('1.745')
  await expect(table.locator('[data-stat="outliers"]')).toBeVisible()
  await expect(page.getByTestId('stats-sample')).toContainText('24 of 24')

  // Each statistic's "?" explains it on click and closes on a press elsewhere.
  const sdTip = table.locator('[data-stat="sd"]').getByRole('button', { name: /^Standard deviation/ })
  const sdText = page.getByRole('dialog').filter({ hasText: 'divides by n − 1' })
  await sdTip.click()
  await expect(sdText).toBeVisible()
  await page.getByTestId('stats-sample').click()
  await expect(sdText).toBeHidden()

  // An open tip covers the "?" of the rows above it: that "?" still answers the first click.
  const meanTip = table.locator('[data-stat="mean"]').getByRole('button', { name: /^Mean/ })
  const meanText = page.getByRole('dialog').filter({ hasText: 'arithmetic average' })
  await sdTip.click()
  await expect(sdText).toBeVisible()
  await meanTip.click()
  await expect(meanText).toBeVisible()
  await expect(sdText).toBeHidden()
})
