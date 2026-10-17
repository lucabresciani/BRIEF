// The only React component that talks to the Plotly runtime. Everything it draws comes
// from a FigureOut built by the pure domain (src/domain/figure); it never decides what to plot.
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  type CSSProperties,
} from 'react'
import createPlotlyComponent from 'react-plotly.js/factory'
import type { Config, Data, Layout } from 'plotly.js'
import Plotly from './plotly'
import { cancelPlotResize, requestPlotResize } from './resizeScheduler'

const Plot = createPlotlyComponent(Plotly)

// Fx (hover/unhover) is exported by the runtime (src/core.js) but missing from the v4 typings.
const Fx = (
  Plotly as unknown as {
    Fx: {
      hover: (gd: HTMLElement, pts: object[], subplot?: string) => void
      unhover: (gd: HTMLElement) => void
    }
  }
).Fx

export interface PlotPoint {
  curveNumber: number
  pointNumber?: number
  pointIndex?: number
  data?: { uid?: string }
  customdata?: unknown
}

export interface AxisView {
  x: readonly [number, number] | null
  y: readonly [number, number] | null
}

/** A zoom with the layout uirevision it was recorded under. */
export type RecordedAxisView = AxisView & { rev: string }

export interface PlotCanvasProps {
  data: Data[]
  layout: Partial<Layout>
  config: Partial<Config>
  ariaLabel: string
  onSelected?: (points: readonly PlotPoint[]) => void
  onDeselect?: () => void
  onPointClick?: (point: PlotPoint) => void
  /** Return false to prevent Plotly's own legend toggling (the store decides visibility). */
  onLegendClick?: (uid: string | undefined) => boolean
  onViewChange?: (view: AxisView) => void
  onHoverPoint?: (point: PlotPoint | null) => void
  onError?: (err: Error) => void
  onReady?: () => void
  /**
   * The zoom this plot had when its canvas was last on screen (a pane remounts when it shows another
   * plot, or when the layout changes). Applied once, on the first draw, and only while the figure's
   * uirevision is still the one it was recorded under: other columns, scale or type autoscale.
   */
  initialView?: RecordedAxisView | null
}

export interface PlotCanvasHandle {
  /** Show the hover label of these points (table → plot hover). */
  hover: (points: readonly { uid: string; pointIndex: number }[]) => void
  unhover: () => void
  /** factor < 1 zooms in, > 1 zooms out, around the current centre. */
  zoom: (factor: number) => void
  graphDiv: () => HTMLElement | null
}

interface GraphDiv extends HTMLElement {
  data?: { uid?: string; xaxis?: string; yaxis?: string }[]
  layout?: {
    xaxis?: { range?: [number, number]; type?: string }
    yaxis?: { range?: [number, number]; type?: string }
  }
}

const STYLE: CSSProperties = { width: '100%', height: '100%' }

/**
 * A zoom applied by the app. It is a convenience: Plotly rejects it when the plot was purged in the
 * meantime (the pane unmounted or redrew), which must not surface as an unhandled rejection.
 */
function relayout(gd: HTMLElement, update: Record<string, unknown>): void {
  Plotly.relayout(gd, update as Partial<Layout>).catch(() => undefined)
}

/** A view in data units → Plotly axis ranges (log axes take exponents). */
function rangesOf(gd: GraphDiv, view: AxisView): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {}
  for (const [axis, r] of [
    ['xaxis', view.x],
    ['yaxis', view.y],
  ] as const) {
    if (!r) continue
    const isLog = gd.layout?.[axis]?.type === 'log'
    if (isLog && (r[0] <= 0 || r[1] <= 0)) continue
    out[`${axis}.range`] = isLog ? [Math.log10(r[0]), Math.log10(r[1])] : [r[0], r[1]]
  }
  return out
}

function readAxis(
  gd: GraphDiv,
  axis: 'xaxis' | 'yaxis',
  ev: Record<string, unknown>,
): readonly [number, number] | null | undefined {
  if (ev[`${axis}.autorange`] === true) return null
  let r0 = ev[`${axis}.range[0]`] as number | undefined
  let r1 = ev[`${axis}.range[1]`] as number | undefined
  const arr = ev[`${axis}.range`] as [number, number] | undefined
  if (arr) [r0, r1] = arr
  if (typeof r0 !== 'number' || typeof r1 !== 'number') return undefined
  const isLog = gd.layout?.[axis]?.type === 'log'
  return isLog ? [10 ** r0, 10 ** r1] : [r0, r1]
}

export const PlotCanvas = forwardRef<PlotCanvasHandle, PlotCanvasProps>(function PlotCanvas(props, ref) {
  const gdRef = useRef<GraphDiv | null>(null)
  const hostRef = useRef<HTMLDivElement | null>(null)

  useImperativeHandle(ref, () => ({
    hover(points) {
      const gd = gdRef.current
      if (!gd?.data) return
      // Fx.hover needs one subplot at a time: label only points of the main (x, y) subplot.
      const targets = points
        .map((p) => ({ curveNumber: gd.data!.findIndex((t) => t.uid === p.uid), pointNumber: p.pointIndex }))
        .filter((p) => {
          const tr =
            p.curveNumber >= 0 ? (gd.data![p.curveNumber] as { xaxis?: string; yaxis?: string }) : null
          return tr && (tr.xaxis ?? 'x') === 'x' && (tr.yaxis ?? 'y') === 'y'
        })
      if (!targets.length) return
      try {
        Fx.hover(gd, targets, 'xy')
      } catch {
        // A hover label is a convenience: never let it break the plot.
      }
    },
    unhover() {
      const gd = gdRef.current
      try {
        if (gd) Fx.unhover(gd)
      } catch {
        // ignore: nothing to unhover
      }
    },
    zoom(factor) {
      const gd = gdRef.current
      const xr = gd?.layout?.xaxis?.range
      const yr = gd?.layout?.yaxis?.range
      if (!gd || !xr || !yr) return
      const scale = (r: [number, number]): [number, number] => {
        const c = (r[0] + r[1]) / 2
        const h = ((r[1] - r[0]) / 2) * factor
        return [c - h, c + h]
      }
      relayout(gd, { 'xaxis.range': scale(xr), 'yaxis.range': scale(yr) })
    },
    graphDiv: () => gdRef.current,
  }))

  const { onReady, onViewChange, onLegendClick } = props
  // Read once: the zoom to restore belongs to the first draw only.
  const initialView = useRef(props.initialView ?? null)
  const markReady = useCallback(
    (figure: { layout?: unknown }, gd: HTMLElement) => {
      gdRef.current = gd as GraphDiv
      const view = initialView.current
      initialView.current = null
      // A plain relayout, like the zoom buttons: Plotly keeps it across later updates of the figure.
      const drawnRev = (figure.layout as { uirevision?: unknown } | undefined)?.uirevision
      if (view && view.rev === String(drawnRev ?? '')) {
        const ranges = rangesOf(gd as GraphDiv, view)
        if (Object.keys(ranges).length) relayout(gd, ranges)
      }
      hostRef.current?.setAttribute('data-plot-ready', String(Date.now()))
      onReady?.()
    },
    [onReady],
  )

  // The canvas resizes Plotly itself (resizeScheduler): Plotly's responsive mode would add its own
  // observer and debounce to every pane.
  const config = useMemo(() => ({ ...props.config, responsive: false }), [props.config])
  useEffect(() => {
    const host = hostRef.current
    if (!host || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      if (gdRef.current) requestPlotResize(gdRef.current)
    })
    ro.observe(host)
    return () => {
      ro.disconnect()
      if (gdRef.current) cancelPlotResize(gdRef.current)
    }
  }, [])

  return (
    <div
      ref={hostRef}
      role="img"
      aria-label={props.ariaLabel}
      className="relative h-full min-h-0 w-full min-w-0"
    >
      <Plot
        data={props.data as unknown[]}
        layout={props.layout}
        config={config}
        style={STYLE}
        useResizeHandler={false}
        onInitialized={markReady}
        onUpdate={markReady}
        onError={(err) => props.onError?.(err)}
        onSelected={(ev: { points?: PlotPoint[] } | undefined) => {
          // Plotly also fires plotly_selected with undefined on a plain click: ignore it.
          if (ev?.points) props.onSelected?.(ev.points)
        }}
        onDeselect={() => props.onDeselect?.()}
        onClick={(ev: { points?: PlotPoint[] }) => {
          const p = ev?.points?.[0]
          if (p) props.onPointClick?.(p)
        }}
        onHover={(ev: { points?: PlotPoint[] }) => props.onHoverPoint?.(ev?.points?.[0] ?? null)}
        onUnhover={() => props.onHoverPoint?.(null)}
        onLegendClick={(ev: { data?: { uid?: string }[]; curveNumber: number }) =>
          onLegendClick ? onLegendClick(ev.data?.[ev.curveNumber]?.uid) : true
        }
        onLegendDoubleClick={() => false}
        onRelayout={(ev: Record<string, unknown>) => {
          const gd = gdRef.current
          if (!gd || !onViewChange) return
          const x = readAxis(gd, 'xaxis', ev)
          const y = readAxis(gd, 'yaxis', ev)
          if (x === undefined && y === undefined) return
          onViewChange({
            x:
              x === undefined
                ? (readAxis(gd, 'xaxis', { 'xaxis.range': gd.layout?.xaxis?.range }) ?? null)
                : x,
            y:
              y === undefined
                ? (readAxis(gd, 'yaxis', { 'yaxis.range': gd.layout?.yaxis?.range }) ?? null)
                : y,
          })
        }}
      />
    </div>
  )
})

export default PlotCanvas
