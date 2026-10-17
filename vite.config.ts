import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * Content-Security-Policy injected only into the production build: the dev server needs inline
 * scripts for HMR. Everything runs from 'self'; Plotly's cartesian bundle needs no eval.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ')

const packageJson = (dir: string) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))

const app = packageJson(import.meta.dirname)

/**
 * Constants the app reads from package.json (declared in src/types/app.d.ts), so a release or a moved
 * repository is changed in one place. vitest.config.ts defines the same ones for the tests.
 */
export const appDefine = {
  __APP_VERSION__: JSON.stringify(app.version),
  // "git+https://host/owner/repo.git" → "https://host/owner/repo"
  __APP_REPOSITORY__: JSON.stringify(
    String(app.repository?.url ?? '')
      .replace(/^git\+/, '')
      .replace(/\.git$/, ''),
  ),
}

const LICENSES_FILE = 'THIRD_PARTY_LICENSES.md'

/**
 * build.license lists the packages bundled into the app, the fonts included. The service worker runtime
 * is shipped too, but Workbox builds it after the bundle, so its licences are appended to the same file.
 */
const SHIPPED_OUTSIDE_CHUNKS = ['workbox-core', 'workbox-precaching', 'workbox-routing', 'workbox-strategies']

function assetLicenses(): Plugin {
  return {
    name: 'brief-asset-licenses',
    apply: 'build',
    generateBundle: {
      // After vite:license, which emits the file in its own generateBundle.
      order: 'post',
      handler(_, bundle) {
        const file = bundle[LICENSES_FILE]
        if (file?.type !== 'asset') return
        const sections = SHIPPED_OUTSIDE_CHUNKS.map((name) => {
          const dir = resolve(import.meta.dirname, 'node_modules', name)
          const { version, license } = packageJson(dir)
          const text = readdirSync(dir).find((f) => /^licen[cs]e/i.test(f))
          const body = text ? `\n${readFileSync(join(dir, text), 'utf8').trim()}\n` : ''
          return `\n## ${name} - ${version} (${license})\n${body}`
        })
        file.source = String(file.source) + sections.join('')
      },
    },
  }
}

function cspMeta(): Plugin {
  return {
    name: 'brief-csp-meta',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      )
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    cspMeta(),
    assetLicenses(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'BRIEF',
        short_name: 'BRIEF',
        description:
          'A free, open-source lab companion for STEM students: plot, fit and export measurements in your browser.',
        theme_color: '#f5f8fa',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '.',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The licences file is precached too: otherwise the navigation fallback would answer a request
        // for it with index.html once the service worker is active.
        globPatterns: ['**/*.{js,css,html,woff2,svg,png,ico,webmanifest}', LICENSES_FILE],
        // Plotly's chunk is ~1.5 MB; the default 2 MiB limit is close, so raise it explicitly.
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: { '@': resolve(import.meta.dirname, './src') },
  },
  define: appDefine,
  worker: { format: 'es' },
  build: {
    chunkSizeWarningLimit: 1600,
    // Served from the app root and linked from the help panel.
    license: { fileName: LICENSES_FILE },
  },
})
