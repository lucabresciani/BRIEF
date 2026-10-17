// Resizes the on-screen plots when their box changes size. Plotly's own `responsive` mode gives every
// plot a ResizeObserver and a 100 ms debounce of its own: dragging a split handle then leaves the plots
// stale for the whole drag and relayouts all four of them in the same frame once the pointer rests.
// Here each plot is redrawn at most every MIN_INTERVAL_MS while its box keeps changing (it follows the
// drag) and the redraws of several plots go to separate animation frames.
import type { Layout } from 'plotly.js'
import Plotly from './plotly'

const MIN_INTERVAL_MS = 120

interface PlotDiv extends HTMLElement {
  layout?: { width?: number; height?: number }
  _fullLayout?: { width?: number; height?: number }
}

const pending = new Set<PlotDiv>()
const lastRun = new WeakMap<PlotDiv, number>()
let frame = 0
let timer: ReturnType<typeof setTimeout> | null = null

const dueAt = (gd: PlotDiv) => (lastRun.get(gd) ?? -Infinity) + MIN_INTERVAL_MS

/** The plot's box changed size: redraw it at its new size soon. */
export function requestPlotResize(gd: HTMLElement): void {
  pending.add(gd as PlotDiv)
  wake()
}

/** The plot left the page. */
export function cancelPlotResize(gd: HTMLElement): void {
  pending.delete(gd as PlotDiv)
}

function wake(): void {
  if (frame || timer !== null || pending.size === 0) return
  const due = Math.min(...[...pending].map(dueAt))
  const wait = due - performance.now()
  if (wait <= 0) frame = requestAnimationFrame(step)
  else
    timer = setTimeout(() => {
      timer = null
      wake()
    }, wait)
}

function step(): void {
  frame = 0
  const now = performance.now()
  const next = [...pending].find((gd) => dueAt(gd) <= now)
  if (next) {
    pending.delete(next)
    lastRun.set(next, now)
    resizeNow(next)
  }
  wake()
}

function resizeNow(gd: PlotDiv): void {
  const w = gd.offsetWidth
  const h = gd.offsetHeight
  // Hidden, detached, or a fixed-size (export) figure: nothing to fit.
  if (!gd.isConnected || !w || !h || !gd.layout || (gd.layout.width && gd.layout.height)) return
  const drawn = gd._fullLayout
  if (drawn && Math.abs((drawn.width ?? 0) - w) <= 1 && Math.abs((drawn.height ?? 0) - h) <= 1) return
  // What Plotly.Plots.resize does, without its 100 ms debounce.
  Plotly.relayout(gd, { autosize: true } as Partial<Layout>).catch(() => {
    // The plot was purged meanwhile (its pane closed): nothing to resize.
  })
}
