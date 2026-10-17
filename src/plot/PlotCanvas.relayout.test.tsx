import { createRef, useEffect } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { PlotCanvas, type PlotCanvasHandle } from './PlotCanvas'

// Plotly rejects a relayout on a plot that was purged meanwhile (the pane unmounted or redrew). A plain
// function, not vi.fn: a spy observes the promises it returns, which would mark the rejection handled.
const plotly = vi.hoisted(() => ({
  calls: 0,
  relayout() {
    plotly.calls++
    return Promise.reject(new Error('This element is not a Plotly plot'))
  },
  Fx: { hover: () => undefined, unhover: () => undefined },
}))
vi.mock('./plotly', () => ({ default: plotly }))

/** A graph div as Plotly leaves it after a draw: linear axes with ranges. */
const gd = Object.assign(document.createElement('div'), {
  layout: { xaxis: { range: [0, 10] }, yaxis: { range: [0, 4] } },
})
vi.mock('react-plotly.js/factory', () => ({
  default:
    () =>
    ({ layout, onInitialized }: { layout: unknown; onInitialized: (f: object, el: HTMLElement) => void }) => {
      useEffect(() => onInitialized({ layout }, gd), [layout, onInitialized])
      return null
    },
}))

async function settle() {
  await new Promise((r) => setTimeout(r, 20))
}

describe('relayouts the canvas asks Plotly for', () => {
  it('a rejected zoom or restored view is dropped quietly: no unhandled rejection', async () => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      const ref = createRef<PlotCanvasHandle>()
      render(
        <PlotCanvas
          ref={ref}
          data={[]}
          layout={{ uirevision: 'r1' }}
          config={{}}
          ariaLabel="plot"
          initialView={{ x: [1, 2], y: [1, 2], rev: 'r1' }}
        />,
      )
      ref.current!.zoom(0.5)
      expect(plotly.calls).toBe(2)
      await settle()
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })
})
