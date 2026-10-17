/**
 * Plotly does not run in jsdom: tests replace PlotCanvasLazy with this stand-in, e.g.
 *   vi.mock('@/plot/PlotCanvasLazy', async () => ({ PlotCanvasLazy: (await import('@/test/fakePlotCanvas')).FakePlotCanvas }))
 * It shows what the pane hands to the canvas (the selected points of each trace, the zoom to restore,
 * which figure) as data attributes, reports a zoom when its button is pressed, and records table → plot hovers.
 */
import { forwardRef, useImperativeHandle } from 'react'
import type { AxisView, PlotCanvasHandle, PlotCanvasProps } from '@/plot/PlotCanvas'

export const ZOOM: AxisView = { x: [1, 2], y: [3, 4] }

/** One number per figure the canvas was handed: the same number means the figure was not rebuilt. */
const figureIds = new WeakMap<object, number>()
let nextFigure = 0
const figureId = (data: object) => {
  if (!figureIds.has(data)) figureIds.set(data, ++nextFigure)
  return figureIds.get(data)!
}

/** Hover labels asked for, by the uirevision of the canvas that showed them (it starts with the plot id). */
export const hovers: string[] = []

export const FakePlotCanvas = forwardRef<PlotCanvasHandle, PlotCanvasProps & { fallback?: unknown }>(
  function FakePlotCanvas(props, ref) {
    useImperativeHandle(ref, () => ({
      hover: () => void hovers.push(String(props.layout.uirevision ?? '')),
      unhover: () => {},
      zoom: () => {},
      graphDiv: () => null,
    }))
    const selected = props.data.map((t) => (t as { selectedpoints?: number[] | null }).selectedpoints ?? null)
    return (
      <div
        data-testid="fake-canvas"
        data-uirevision={String(props.layout.uirevision ?? '')}
        data-figure={figureId(props.data)}
        data-selected={JSON.stringify(selected)}
        data-initial-view={props.initialView ? JSON.stringify(props.initialView) : ''}
      >
        <button type="button" onClick={() => props.onViewChange?.(ZOOM)}>
          zoom on canvas
        </button>
      </div>
    )
  },
)
