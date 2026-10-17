import { test, expect, type Page } from '@playwright/test'
import { inspectorTab, loadExample, pointsTrace, traces, waitForPlot } from './helpers/plot'

async function choose(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label }).first().click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

test('save a project and reopen it in a fresh browser: data, fit, error bars and exclusion restored', async ({
  page,
  browser,
}) => {
  await page.goto('/')
  await loadExample(page, 'free-fall')
  await inspectorTab(page, 'Uncertainty').click()
  await choose(page, 'What the bars show', 'Measurement uncertainty')
  await choose(page, 'Source', 'From a column')
  await choose(page, 'Column', 'u(y) (m)')
  await inspectorTab(page, 'Fit').click()
  await page.getByTestId('add-fit').click()
  await page.locator('[role="row"][data-row-id]').nth(0).click()
  await page.getByRole('button', { name: 'Exclude from analysis' }).click()
  await page.getByTestId('confirm-exclusion').click()
  await expect(page.getByTestId('fit-n')).toHaveText('14 of 15')
  const equation = await page.getByTestId('fit-equation').textContent()

  await page.getByRole('button', { name: /Project/ }).click()
  const dl = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: /Save project/ }).click()
  const file = await (await dl).path()

  const ctx = await browser.newContext()
  const p2 = await ctx.newPage()
  await p2.goto('/')
  await p2.getByRole('button', { name: /Project/ }).click()
  const chooser = p2.waitForEvent('filechooser')
  await p2.getByRole('menuitem', { name: /Open project/ }).click()
  await (await chooser).setFiles(file)
  await waitForPlot(p2)
  await inspectorTab(p2, 'Fit').click()
  await expect(p2.getByTestId('fit-n')).toHaveText('14 of 15')
  await expect(p2.getByTestId('fit-equation')).toHaveText(equation ?? '')
  expect((await pointsTrace(p2)).error_y?.array?.length).toBeGreaterThan(0)
  expect((await traces(p2)).some((t) => t.uid?.endsWith('__excluded'))).toBe(true)
  await ctx.close()
})
