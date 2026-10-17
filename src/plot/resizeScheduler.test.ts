import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const relayout = vi.fn((gd: unknown, update: unknown) => Promise.resolve({ gd, update }))
vi.mock('./plotly', () => ({ default: { relayout } }))

const { requestPlotResize, cancelPlotResize } = await import('./resizeScheduler')

/** A drawn plot whose box is now w × h (Plotly last drew it at 300 × 200). */
function plotDiv(w = 400, h = 300, opts: { connected?: boolean; drawn?: [number, number] } = {}) {
  const [dw, dh] = opts.drawn ?? [300, 200]
  return {
    isConnected: opts.connected ?? true,
    offsetWidth: w,
    offsetHeight: h,
    layout: {},
    _fullLayout: { width: dw, height: dh },
  } as unknown as HTMLElement
}

const FRAME = 16

beforeEach(() => {
  relayout.mockClear()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
    setTimeout(() => cb(performance.now()), FRAME),
  )
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('resizeScheduler', () => {
  it('redraws the panes resized by one drag in separate frames, at their new size', () => {
    const panes = [plotDiv(), plotDiv(), plotDiv(), plotDiv()]
    panes.forEach(requestPlotResize)
    vi.advanceTimersByTime(FRAME)
    expect(relayout).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(3 * FRAME)
    expect(relayout).toHaveBeenCalledTimes(4)
    expect(new Set(relayout.mock.calls.map((c) => c[0]))).toEqual(new Set(panes))
    expect(relayout).toHaveBeenCalledWith(panes[0], { autosize: true })
  })

  it('a pane that keeps changing size is redrawn at most every 120 ms, then once at its final size', () => {
    const pane = plotDiv()
    // A 480 ms drag: the box changes every frame.
    for (let t = 0; t < 480; t += FRAME) {
      requestPlotResize(pane)
      vi.advanceTimersByTime(FRAME)
    }
    const duringDrag = relayout.mock.calls.length
    expect(duringDrag).toBeGreaterThanOrEqual(3) // it follows the drag
    expect(duringDrag).toBeLessThanOrEqual(5) // instead of 30 relayouts
    vi.advanceTimersByTime(200)
    expect(relayout.mock.calls.length).toBe(duringDrag + 1)
    vi.advanceTimersByTime(1000)
    expect(relayout.mock.calls.length).toBe(duringDrag + 1)
  })

  it('leaves alone a hidden, detached, already fitted or removed plot', () => {
    requestPlotResize(plotDiv(0, 0))
    requestPlotResize(plotDiv(400, 300, { connected: false }))
    requestPlotResize(plotDiv(400, 300, { drawn: [400, 300] }))
    const removed = plotDiv()
    requestPlotResize(removed)
    cancelPlotResize(removed)
    vi.advanceTimersByTime(1000)
    expect(relayout).not.toHaveBeenCalled()
  })
})
