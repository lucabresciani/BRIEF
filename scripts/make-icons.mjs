// Renders public/favicon.svg to the PWA PNG icons with the locally cached Chromium (no network).
// Usage: node scripts/make-icons.mjs
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

const root = join(import.meta.dirname, '..')
const svg = readFileSync(join(root, 'public', 'favicon.svg'), 'utf8')
const browser = await chromium.launch()
const page = await browser.newPage()
for (const size of [192, 512]) {
  await page.setViewportSize({ width: size, height: size })
  // Maskable icons need a safe zone: draw the mark at 80 % on the brand-neutral background.
  await page.setContent(
    `<html><body style="margin:0;background:#f5f8fa;display:grid;place-items:center;width:${size}px;height:${size}px">` +
      `<div style="width:${Math.round(size * 0.8)}px;height:${Math.round(size * 0.8)}px">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div></body></html>`,
  )
  await page.screenshot({ path: join(root, 'public', 'icons', `icon-${size}.png`) })
  console.log(`icon-${size}.png`)
}
await browser.close()
