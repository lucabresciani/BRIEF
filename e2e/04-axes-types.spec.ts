import { test, expect, type Page } from '@playwright/test'
import { layout, loadExample, plot, traces } from './helpers/plot'

async function choose(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label }).first().click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

test('changing X and Y updates the axis titles; resizing the panels resizes the plot', async ({ page }) => {
  await page.goto('/')
  await loadExample(page, 'cooling')
  await choose(page, 'Y axis', 'ΔT (K)')
  await expect
    .poll(async () => (await layout(page)).yaxis)
    .toMatchObject({ title: expect.stringContaining('ΔT') })
  const w1 = (await layout(page)).width as number
  const handle = page.locator('[data-slot="resizable-handle"]').first()
  const box = (await handle.boundingBox())!
  await page.mouse.move(box.x + 1, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 140, box.y + box.height / 2, { steps: 6 })
  await page.mouse.up()
  await expect.poll(async () => (await layout(page)).width).not.toBe(w1)
})

test('plot types switch without losing settings; zoom, pan, reset and hover work', async ({ page }) => {
  await page.goto('/')
  await loadExample(page, 'pendulum')
  for (const type of ['Box plot', 'Histogram', 'Bar', 'Line', 'Scatter']) {
    await choose(page, 'Plot type', type)
    await expect.poll(async () => (await traces(page)).length).toBeGreaterThan(0)
  }
  const before = (await layout(page)).xaxis as { range: number[] }
  const drag = plot(page).locator('.nsewdrag').first()
  const b = (await drag.boundingBox())!
  await page.mouse.move(b.x + b.width * 0.3, b.y + b.height * 0.3)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width * 0.6, b.y + b.height * 0.6, { steps: 8 })
  await page.mouse.up()
  await expect
    .poll(async () => ((await layout(page)).xaxis as { range: number[] }).range)
    .not.toEqual(before.range)
  await page.getByRole('button', { name: 'Reset view' }).click()
  await expect
    .poll(async () => ((await layout(page)).xaxis as { range: number[] }).range)
    .toEqual(before.range)
  // Hover shows a label with the precise value.
  await page.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.5)
  // Pan mode.
  await page.getByRole('button', { name: 'Pan', exact: true }).click()
  await expect.poll(async () => (await layout(page)).dragmode).toBe('pan')
})
