import { test, expect } from '@playwright/test'
import { inspectorTab, loadExample } from './helpers/plot'

test('switching to Italian translates the interface and uses decimal commas', async ({ page }) => {
  await page.goto('/')
  await page
    .getByRole('radio', { name: 'Italiano' })
    .or(page.getByRole('button', { name: 'Italiano' }))
    .first()
    .click()
  await expect(page.getByRole('heading', { name: 'Comincia dalle tue misure' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'it')
  await loadExample(page, 'ohm')
  await inspectorTab(page, 'Fit').click()
  await page.getByTestId('add-fit').click()
  await expect(page.getByTestId('fit-parameters')).toContainText('47,15 ± 0,08')
})
