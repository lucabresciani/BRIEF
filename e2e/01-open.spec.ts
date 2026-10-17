import { test, expect } from '@playwright/test'
import { guardPage, waitForPlot } from './helpers/plot'

test('opens without an account, offers four ways to start and never calls another origin', async ({
  page,
}) => {
  const external: string[] = []
  page.on('request', (r) => {
    const u = new URL(r.url())
    if (
      u.origin !== 'http://localhost:4173' &&
      !u.protocol.startsWith('data') &&
      !u.protocol.startsWith('blob')
    )
      external.push(r.url())
  })
  const guard = await guardPage(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Start with your measurements' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Paste from a spreadsheet/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Open a file/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Enter by hand/ })).toBeVisible()
  await expect(page.locator('[data-example]')).toHaveCount(5)
  await expect(page.getByText(/Nothing is uploaded/)).toBeVisible()
  await expect(page.getByText(/sign in|log in|create an account/i)).toHaveCount(0)
  expect(guard.errors).toEqual([])
  expect(external).toEqual([])
})

test('reduced motion: the app still works', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await page.locator('[data-example="ohm"]').click()
  await waitForPlot(page)
})
