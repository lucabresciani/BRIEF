import { test, expect } from '@playwright/test'
import { guardPage, inspectorTab, loadExample } from './helpers/plot'

test('no Content-Security-Policy violation while plotting, fitting and exporting', async ({ page }) => {
  const guard = await guardPage(page)
  await page.goto('/')
  await loadExample(page, 'ohm')
  await inspectorTab(page, 'Fit').click()
  await page.getByTestId('add-fit').click()
  await expect(page.getByTestId('fit-equation')).toBeVisible()
  await page.getByRole('button', { name: 'Export figure' }).click()
  const download = page.waitForEvent('download')
  await page.getByTestId('export-png').click()
  await download
  expect(await guard.csp()).toEqual([])
  expect(guard.errors).toEqual([])
})
