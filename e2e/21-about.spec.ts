import { test, expect, type Page } from '@playwright/test'

async function openAbout(page: Page) {
  await page.getByRole('button', { name: 'Help' }).click()
  await page.getByRole('button', { name: 'About' }).click()
}

test('the help panel names the version and opens the licences of the bundled libraries', async ({
  page,
  context,
}) => {
  await page.goto('/')
  await openAbout(page)
  await expect(page.getByText(/^Version \d+\.\d+\.\d+/)).toBeVisible()
  await expect(page.getByRole('link', { name: /Source code on GitHub/ })).toHaveAttribute(
    'href',
    /^https:\/\/github\.com\//,
  )
  const popup = context.waitForEvent('page')
  await page.getByRole('link', { name: /Third-party licences/ }).click()
  const licences = await popup
  await expect(licences.locator('body')).toContainText('The app bundles dependencies')
  await expect(licences.locator('body')).toContainText('## react - ')
  await expect(licences.locator('body')).toContainText('## workbox-core - ')
})

test('the About section names BRIEF and credits its author, with links that open in new tabs', async ({
  page,
  context,
}) => {
  // The author's website is answered locally: the test never leaves the machine.
  await context.route('https://luca-bresciani.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Luca Bresciani</title>' }),
  )
  await page.goto('/')
  await openAbout(page)
  const about = page.getByRole('region', { name: 'About' })
  await expect(about.getByText('BRIEF', { exact: true })).toBeVisible()
  await expect(about.getByRole('heading', { name: 'Created by Luca Bresciani' })).toBeVisible()
  const links: [RegExp, string][] = [
    [/^Luca Bresciani’s website/, 'https://luca-bresciani.com'],
    [/^Luca Bresciani on GitHub/, 'https://github.com/lucabresciani'],
    [/^Luca Bresciani on LinkedIn/, 'https://linkedin.com/in/luca-bresciani-62a1313a3'],
    [/^Luca Bresciani on X/, 'https://x.com/bresciani_aero'],
    [/^Luca Bresciani on Instagram/, 'https://www.instagram.com/_luca_bresciani/'],
    [/^Contact Luca Bresciani/, 'https://luca-bresciani.com/contact'],
  ]
  for (const [name, href] of links) {
    const link = about.getByRole('link', { name })
    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute('href', href)
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  }
  // The Content-Security-Policy of the build lets the link open.
  const popup = context.waitForEvent('page')
  await about.getByRole('link', { name: /^Contact Luca Bresciani/ }).click()
  const contact = await popup
  await expect(contact).toHaveURL('https://luca-bresciani.com/contact')
  await expect(contact).toHaveTitle('Luca Bresciani')
})

test.describe('offline', () => {
  test.use({ serviceWorkers: 'allow' })

  test('the licences stay readable: the service worker never answers them with the app', async ({
    page,
    context,
  }) => {
    await page.goto('/')
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true))
    await page.reload()
    await expect
      .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 20_000 })
      .toBe(true)
    await context.setOffline(true)
    await page.goto('/THIRD_PARTY_LICENSES.md')
    await expect(page.locator('body')).toContainText('The app bundles dependencies')
    await context.setOffline(false)
  })
})
