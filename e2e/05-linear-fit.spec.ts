import { test, expect, type Page } from '@playwright/test'
import { inspectorTab, layout, loadExample, traces, waitForPlot } from './helpers/plot'

test('adding a linear fit shows correct parameters, R², residual plot; excluding a row updates n', async ({
  page,
}) => {
  await page.goto('/')
  await loadExample(page, 'ohm')
  await inspectorTab(page, 'Fit').click()
  await page.getByTestId('add-fit').click()

  // Reference (independent oracle): slope 47.1472727273, SE 0.0750720498733 → PDG "47.15 ± 0.08".
  await expect(page.getByTestId('fit-parameters')).toContainText('47.15 ± 0.08')
  await expect(page.getByTestId('fit-r2')).toHaveText('> 0.9999')
  await expect(page.getByTestId('fit-n')).toHaveText('10 of 10')
  await expect(page.getByText(/does not show that the model is correct/)).toBeVisible()

  await expect.poll(async () => (await traces(page)).some((t) => t.uid?.endsWith('__fit'))).toBe(true)
  await expect
    .poll(async () => (await traces(page)).some((t) => t.uid?.endsWith('__residuals') && t.yaxis === 'y2'))
    .toBe(true)
  expect((await layout(page)).yaxis2).not.toBeNull()

  // Exclude file row 4 (third data row) from the table: the fit now uses 9 observations.
  await page.locator('[role="row"][data-row-id]').nth(2).click()
  await page.getByRole('button', { name: 'Exclude from analysis' }).click()
  await page.getByTestId('confirm-exclusion').click()
  await expect(page.getByTestId('fit-n')).toHaveText('9 of 10')
  await expect(page.getByRole('toolbar').getByText('9 of 10', { exact: true })).toBeVisible()
  await expect.poll(async () => (await traces(page)).some((t) => t.uid?.endsWith('__excluded'))).toBe(true)
})

test('a fit with constant x gives a readable error and no curve', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /Paste from a spreadsheet/ }).click()
  await page.getByLabel('Table text').fill('x\ty\n2\t1\n2\t3\n2\t5\n2\t7')
  await page.getByRole('button', { name: 'Continue' }).click()
  await waitForPlot(page)
  await inspectorTab(page, 'Fit').click()
  await page.getByTestId('add-fit').click()
  await expect(page.getByText('All x values are equal.')).toBeVisible()
  expect((await traces(page)).some((t) => t.uid?.endsWith('__fit'))).toBe(false)
})

/** The "?" next to "Residual SD (s)" and the explanation it opens. */
function residualSdTip(page: Page) {
  return {
    button: page.getByRole('button', { name: /^Residual SD \(s\):/ }),
    popup: page.getByRole('dialog').filter({ hasText: 'typical distance of the points from the curve' }),
  }
}

test('the ? next to the residual SD opens on click and closes with Escape, focus back on it', async ({
  page,
}) => {
  await page.goto('/')
  await loadExample(page, 'ohm')
  await inspectorTab(page, 'Fit').click()
  await page.getByTestId('add-fit').click()
  const tip = residualSdTip(page)
  await tip.button.click()
  await expect(tip.popup).toBeVisible()
  // It stays open after the pointer leaves (a click pins it, unlike a tooltip).
  await page.mouse.move(0, 0)
  await expect(tip.popup).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(tip.popup).toBeHidden()
  await expect(tip.button).toBeFocused()
  // From the keyboard too.
  await page.keyboard.press('Enter')
  await expect(tip.popup).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(tip.popup).toBeHidden()
})

test('a click on the ? after the resting mouse showed the explanation keeps it open', async ({ page }) => {
  await page.goto('/')
  await loadExample(page, 'ohm')
  await inspectorTab(page, 'Fit').click()
  await page.getByTestId('add-fit').click()
  const tip = residualSdTip(page)
  await tip.button.hover()
  await expect(tip.popup).toBeVisible()
  // The pointer can rest on the explanation itself without it closing (WCAG 1.4.13).
  const box = (await tip.popup.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 })
  await page.waitForTimeout(400)
  await expect(tip.popup).toBeVisible()
  await tip.button.hover()
  // Read for a moment, then click: the click must not take the explanation away.
  await page.waitForTimeout(800)
  await tip.button.click()
  await page.mouse.move(0, 0)
  await page.waitForTimeout(400)
  await expect(tip.popup).toBeVisible()
  await tip.button.click()
  await expect(tip.popup).toBeHidden()
})

test.describe('on a touch screen', () => {
  test.use({ hasTouch: true })

  test('tapping the ? next to the residual SD shows the explanation; tapping elsewhere hides it', async ({
    page,
  }) => {
    await page.goto('/')
    await loadExample(page, 'ohm')
    await inspectorTab(page, 'Fit').tap()
    await page.getByTestId('add-fit').tap()
    const tip = residualSdTip(page)
    await tip.button.tap()
    await expect(tip.popup).toBeVisible()
    await page.getByTestId('fit-equation').tap()
    await expect(tip.popup).toBeHidden()
  })
})
