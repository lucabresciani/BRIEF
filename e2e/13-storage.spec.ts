import { test, expect } from '@playwright/test'
import { inspectorTab, loadExample, waitForPlot } from './helpers/plot'

test('without IndexedDB the app still works and explains how to keep the work', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', {
      get() {
        throw Object.assign(new Error('blocked'), { name: 'SecurityError' })
      },
    })
  })
  await page.goto('/')
  await loadExample(page, 'ohm')
  await expect(page.getByText(/Browser storage is not available/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save project (.sciplot)' }).first()).toBeVisible()
})

test('a reload restores the last project from browser storage', async ({ page }) => {
  await page.goto('/')
  await loadExample(page, 'ohm')
  await inspectorTab(page, 'Fit').click()
  await page.getByTestId('add-fit').click()
  await expect(page.getByText('Saved in this browser')).toBeVisible({ timeout: 10_000 })
  await page.reload()
  await waitForPlot(page)
  await inspectorTab(page, 'Fit').click()
  await expect(page.getByTestId('fit-parameters')).toContainText('47.15 ± 0.08')
})

test('one tab writes a project: a reload stays writable, a second tab is read-only, can open a copy and takes over when the first closes', async ({
  page,
  context,
}) => {
  const readOnlyNote = (p: typeof page) =>
    p.getByText('This project is open in another tab: this tab is read-only.')
  await page.goto('/')
  await loadExample(page, 'ohm')
  await expect(page.getByText('Saved in this browser')).toBeVisible({ timeout: 10_000 })
  await page.reload()
  await waitForPlot(page)
  await expect(readOnlyNote(page)).toHaveCount(0)

  const second = await context.newPage()
  await second.goto('/')
  await expect(readOnlyNote(second)).toBeVisible({ timeout: 20_000 })
  await second.getByRole('button', { name: 'Open as a copy' }).click()
  await expect(readOnlyNote(second)).toHaveCount(0)
  await expect(second.getByLabel('Project name')).toHaveValue(/\(copy\)$/)
  await expect(second.getByText('Saved in this browser')).toBeVisible({ timeout: 10_000 })

  // A third tab restores the most recent project (the copy, held by the second tab): read-only until
  // the second tab closes, then writable without a reload.
  const third = await context.newPage()
  await third.goto('/')
  await expect(readOnlyNote(third)).toBeVisible({ timeout: 20_000 })
  await second.close()
  await expect(readOnlyNote(third)).toHaveCount(0, { timeout: 10_000 })
  await expect(readOnlyNote(page)).toHaveCount(0)
})

test('projects and preferences saved before the app was named BRIEF are carried over, once', async ({
  page,
  context,
}) => {
  const databases = () => page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name).sort())
  // A blank page of the same origin, to rearrange the browser storage while the app is not running.
  await context.route('**/storage-setup', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>setup</title>' }),
  )
  await page.goto('/')
  await loadExample(page, 'ohm')
  await expect(page.getByText('Saved in this browser')).toBeVisible({ timeout: 10_000 })
  const name = await page.getByLabel('Project name').inputValue()
  // A first visit creates the current database only.
  expect(await databases()).toEqual(['brief'])

  // Leave the browser as the former version would have: the same records in the database of the
  // former name, the preferences under "sde." keys, nothing under the current names.
  await page.goto('/storage-setup')
  await page.evaluate(async () => {
    const done = <T>(r: IDBRequest<T>) =>
      new Promise<T>((resolve, reject) => {
        r.onsuccess = () => resolve(r.result)
        r.onerror = () => reject(r.error)
      })
    const current = await done(indexedDB.open('brief'))
    const read = current.transaction('kv').objectStore('kv')
    const [keys, values] = await Promise.all([done(read.getAllKeys()), done(read.getAll())])
    current.close()
    const opening = indexedDB.open('scientific-data-explorer', 1)
    opening.onupgradeneeded = () => opening.result.createObjectStore('kv')
    const former = await done(opening)
    const write = former.transaction('kv', 'readwrite')
    // "adopted" is written by this version only.
    keys.forEach((key, i) => {
      if (key !== 'adopted') write.objectStore('kv').put(values[i], key)
    })
    await new Promise((resolve) => (write.oncomplete = resolve))
    former.close()
    await done(indexedDB.deleteDatabase('brief'))
    localStorage.clear()
    localStorage.setItem('sde.lang', 'it')
    localStorage.setItem('sde.prefs', JSON.stringify({ level: 'advanced', hints: false, tableOpen: true }))
  })

  await page.goto('/')
  await waitForPlot(page)
  await expect(page.getByLabel('Nome del progetto')).toHaveValue(name)
  await expect(page.locator('header').getByRole('combobox', { name: 'Livello', exact: true })).toContainText(
    'Avanzato',
  )
  expect(
    await page.evaluate(() => ['brief.lang', 'sde.lang', 'sde.prefs'].map((k) => localStorage.getItem(k))),
  ).toEqual(['it', null, null])
  // The former database is deleted once its records are copied.
  await expect.poll(databases).toEqual(['brief'])
  await page.reload()
  await waitForPlot(page)
  await expect(page.getByLabel('Nome del progetto')).toHaveValue(name)
})
