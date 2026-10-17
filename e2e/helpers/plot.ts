// The only place that reads Plotly's internal graph-div fields (test-only). Every reader looks at the
// focused pane: the toolbar and the inspector act on its plot.
import { expect, type Page } from '@playwright/test'

/** The focused pane (the only pane in the single layout). */
export const FOCUSED_PANE = '[data-plot-pane][data-focused]'

export const focusedPane = (page: Page) => page.locator(FOCUSED_PANE)

/** The Plotly graph of the focused pane, e.g. `plot(page).locator('.nsewdrag')`. */
export const plot = (page: Page) => page.locator(`${FOCUSED_PANE} .js-plotly-plot`)

/** An inspector tab by its exact name ("Plot" must not match a plot tab such as "Plot 2"). */
export const inspectorTab = (page: Page, name: string) =>
  page.locator('aside [data-slot="tabs-list"]').getByRole('tab', { name, exact: true })

/** A plot tab by its exact label. */
export const plotTab = (page: Page, name: string) =>
  page.getByRole('tablist', { name: /^(Plots|Grafici)$/ }).getByRole('tab', { name, exact: true })

export interface TraceInfo {
  uid?: string
  type?: string
  mode?: string
  name?: string
  x: unknown[]
  y: unknown[]
  visible?: unknown
  selectedpoints?: number[] | null
  error_y?: { array?: number[]; visible?: boolean; type?: string }
  error_x?: { array?: number[]; visible?: boolean }
  xaxis?: string
  yaxis?: string
  showlegend?: boolean
  /** Colour (one, or one per point) and symbol of the markers. */
  marker?: { color?: unknown; symbol?: unknown }
  line?: { color?: string; dash?: string; width?: number }
}

/** `panes` plots drawn (one per pane showing a plot; 1 in the single layout). */
export async function waitForPlot(page: Page, opts: { panes?: number } = {}) {
  const n = opts.panes ?? 1
  await expect(page.locator('[data-plot-ready]')).toHaveCount(n, { timeout: 20_000 })
  await expect(page.locator('.js-plotly-plot')).toHaveCount(n)
}

/** Traces of the focused pane's plot, or of pane `pane` (its index) when given. */
export async function traces(page: Page, pane?: number): Promise<TraceInfo[]> {
  return page.evaluate((selector) => {
    const gd = document.querySelector(selector) as unknown as {
      data: Record<string, unknown>[]
    } | null
    if (!gd) return []
    return gd.data.map((t) => ({
      uid: t.uid as string,
      type: t.type as string,
      mode: t.mode as string,
      name: t.name as string,
      x: Array.from((t.x as ArrayLike<unknown>) ?? []),
      y: Array.from((t.y as ArrayLike<unknown>) ?? []),
      visible: t.visible,
      selectedpoints: (t.selectedpoints as number[] | null | undefined) ?? null,
      error_y: t.error_y as TraceInfo['error_y'],
      error_x: t.error_x as TraceInfo['error_x'],
      xaxis: t.xaxis as string,
      yaxis: t.yaxis as string,
      showlegend: t.showlegend as boolean,
      marker: t.marker
        ? {
            color: (t.marker as { color?: unknown }).color,
            symbol: (t.marker as { symbol?: unknown }).symbol,
          }
        : undefined,
      line: t.line
        ? {
            color: (t.line as { color?: string }).color,
            dash: (t.line as { dash?: string }).dash,
            width: (t.line as { width?: number }).width,
          }
        : undefined,
    }))
  }, paneSelector(pane))
}

const paneSelector = (pane?: number) =>
  pane === undefined ? `${FOCUSED_PANE} .js-plotly-plot` : `[data-plot-pane="${pane}"] .js-plotly-plot`

export async function layout(page: Page, pane?: number): Promise<Record<string, unknown>> {
  return page.evaluate((selector) => {
    const gd = document.querySelector(selector) as unknown as {
      _fullLayout: Record<string, unknown>
    }
    const fl = gd._fullLayout
    const pick = (ax: string) => {
      const a = fl[ax] as
        { title?: { text?: string }; type?: string; range?: number[]; domain?: number[] } | undefined
      return a ? { title: a.title?.text ?? '', type: a.type, range: a.range, domain: a.domain } : null
    }
    return {
      xaxis: pick('xaxis'),
      yaxis: pick('yaxis'),
      yaxis2: pick('yaxis2'),
      width: fl.width,
      height: fl.height,
      dragmode: fl.dragmode,
    }
  }, paneSelector(pane))
}

export async function pointsTrace(page: Page, pane?: number): Promise<TraceInfo> {
  const ts = await traces(page, pane)
  const p = ts.find((t) => t.uid?.endsWith('__points'))
  if (!p) throw new Error('no points trace')
  return p
}

/** Collects console errors and CSP violations for the whole test. */
export async function guardPage(page: Page) {
  const errors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(e.message))
  await page.addInitScript(() => {
    ;(window as unknown as { __csp: string[] }).__csp = []
    document.addEventListener('securitypolicyviolation', (e) => {
      ;(window as unknown as { __csp: string[] }).__csp.push(
        `${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}`,
      )
    })
  })
  return {
    errors,
    csp: () => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp),
  }
}

export async function loadExample(page: Page, id: string) {
  await page.locator(`[data-example="${id}"]`).first().click()
  await waitForPlot(page)
}
