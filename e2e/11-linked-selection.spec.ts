import { test, expect } from '@playwright/test'
import { loadExample, plot, pointsTrace } from './helpers/plot'

test('box selection on the plot highlights table rows; clicking a row highlights the point', async ({
  page,
}) => {
  await page.goto('/')
  await loadExample(page, 'ohm')
  await page
    .getByRole('button', { name: 'Select area' })
    .or(page.getByRole('radio', { name: 'Select area' }))
    .first()
    .click()
  const drag = plot(page).locator('.nsewdrag').first()
  const b = (await drag.boundingBox())!
  await page.mouse.move(b.x + 2, b.y + 2)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width * 0.45, b.y + b.height - 2, { steps: 10 })
  await page.mouse.up()
  await expect(page.locator('[role="row"][aria-selected="true"]').first()).toBeVisible()
  const nSel = await page.locator('[role="row"][aria-selected="true"]').count()
  expect(nSel).toBeGreaterThan(0)
  await expect(page.getByText(`${nSel} selected`)).toBeVisible()

  await page.getByRole('button', { name: 'Clear selection' }).click()
  await page.locator('[role="row"][data-row-id]').nth(4).click()
  await expect.poll(async () => (await pointsTrace(page)).selectedpoints).toEqual([4])
})
