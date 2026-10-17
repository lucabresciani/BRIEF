import { test, expect } from '@playwright/test'
import { loadExample } from './helpers/plot'

test('keyboard: table navigation and selection, toolbar zoom buttons, visible focus', async ({ page }) => {
  await page.goto('/')
  await loadExample(page, 'ohm')
  const grid = page.getByRole('grid', { name: 'Data table' })
  await grid.focus()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Space')
  await expect(page.locator('[role="row"][aria-selected="true"]')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(page.locator('[role="row"][aria-selected="true"]')).toHaveCount(0)
  const zoomIn = page.getByRole('button', { name: 'Zoom in' })
  await zoomIn.focus()
  await expect(zoomIn).toBeFocused()
  const outline = await zoomIn.evaluate(
    (el) => getComputedStyle(el).boxShadow + getComputedStyle(el).outlineStyle,
  )
  expect(outline).not.toBe('nonenone')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Control+z')
})
