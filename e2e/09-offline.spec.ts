import { test, expect } from '@playwright/test'
import { inspectorTab, loadExample } from './helpers/plot'

test.use({ serviceWorkers: 'allow' })

test('after the first visit the app works offline: example, fit and PNG export', async ({
  page,
  context,
}) => {
  await page.goto('/')
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready
    return !!reg.active
  })
  // Wait until the precache is complete (the SW controls the page after a reload).
  await page.reload()
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 20_000 })
    .toBe(true)
  await context.setOffline(true)
  await page.reload()
  await loadExample(page, 'ohm')
  await inspectorTab(page, 'Fit').click()
  await page.getByTestId('add-fit').click()
  await expect(page.getByTestId('fit-parameters')).toContainText('47.15 ± 0.08')
  await page.getByRole('button', { name: 'Export figure' }).click()
  const dl = page.waitForEvent('download')
  await page.getByTestId('export-png').click()
  expect((await dl).suggestedFilename()).toMatch(/\.png$/)
  await context.setOffline(false)
})
