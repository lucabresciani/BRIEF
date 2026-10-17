import { test, expect } from '@playwright/test'
import { guardPage, loadExample, pointsTrace, traces } from './helpers/plot'

test('loading an example shows a scatter plot immediately, marked as an example, with no automatic fit', async ({
  page,
}) => {
  const guard = await guardPage(page)
  await page.goto('/')
  const t0 = Date.now()
  await loadExample(page, 'ohm')
  expect(Date.now() - t0).toBeLessThan(8000)
  const p = await pointsTrace(page)
  expect(p.mode).toBe('markers')
  expect(p.x).toHaveLength(10)
  expect((await traces(page)).some((t) => t.uid?.endsWith('__fit'))).toBe(false)
  await expect(page.getByText('Example (simulated data)').first()).toBeVisible()
  await expect(page.getByRole('note').filter({ hasText: /scatter plot helps you explore/i })).toBeVisible()
  expect(guard.errors).toEqual([])
})
