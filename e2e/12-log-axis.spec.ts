import { test, expect, type Page } from '@playwright/test'
import { inspectorTab, waitForPlot } from './helpers/plot'

async function choose(page: Page, label: string, option: string, nth = 0) {
  await page.getByRole('combobox', { name: label }).nth(nth).click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

test('a log axis with negative values warns, hides them only in the drawing and leaves the fit unchanged', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: /Paste from a spreadsheet/ }).click()
  await page.getByLabel('Table text').fill('x\ty\n1\t-2\n2\t3.1\n3\t5.9\n4\t8.2\n5\t9.8')
  await page.getByRole('button', { name: 'Continue' }).click()
  await waitForPlot(page)
  await inspectorTab(page, 'Fit').click()
  await page.getByTestId('add-fit').click()
  const eq = await page.getByTestId('fit-equation').textContent()
  await inspectorTab(page, 'Plot').click()
  // Y axis section is collapsed by default: open it.
  await page.getByRole('button', { name: 'Y axis' }).click()
  await choose(page, 'Scale', 'Logarithmic', 1)
  await expect(page.getByText(/cannot be shown on a log axis/).first()).toBeVisible()
  await inspectorTab(page, 'Fit').click()
  await expect(page.getByTestId('fit-equation')).toHaveText(eq ?? '')
  await expect(page.getByTestId('fit-n')).toHaveText('5 of 5')
})
