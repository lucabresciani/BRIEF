import { afterEach, describe, expect, it, vi } from 'vitest'
import { preloadPlot } from './preload'

// The plot chunk cannot be fetched (offline, or replaced by a new deployment).
vi.mock('./PlotCanvas', () => {
  throw new Error('chunk failed to load')
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('preloading the plot chunk', () => {
  it('a failed preload is dropped quietly: no unhandled rejection', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('window', {}) // no requestIdleCallback: the preload waits on a timer
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      preloadPlot()
      await vi.advanceTimersByTimeAsync(500)
      vi.useRealTimers()
      // Unhandled rejections are reported after the microtask queue drains.
      await new Promise((r) => setTimeout(r, 20))
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })
})
