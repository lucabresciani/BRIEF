import type { LineDash, MarkerSymbol } from '@/domain/model'
import { cn } from '@/lib/utils'

/**
 * Legend keys for the panels: the marker and the line exactly as the plot draws them (shape, colour,
 * hollow or filled, dash pattern), so a row in a panel can be matched with its curve at a glance.
 * Decorative next to a text label (aria-hidden); the label says which series or group it is.
 */

// 12 × 12 view box, centred on (6, 6), the area of Plotly's markers at the panel scale.
const SHAPES: Record<MarkerSymbol, string> = {
  circle: 'M10.5 6a4.5 4.5 0 1 1-9 0a4.5 4.5 0 1 1 9 0z',
  square: 'M2 2h8v8H2z',
  diamond: 'M6 0.8L11.2 6L6 11.2L0.8 6z',
  'triangle-up': 'M6 1.2L11 10.2H1z',
  'triangle-down': 'M1 1.8H11L6 10.8z',
  cross: 'M4.4 1h3.2v3.4H11v3.2H7.6V11H4.4V7.6H1V4.4h3.4z',
  x: 'M3.2 1.1L6 3.9l2.8-2.8l2.1 2.1L8.1 6l2.8 2.8l-2.1 2.1L6 8.1l-2.8 2.8l-2.1-2.1L3.9 6L1.1 3.2z',
}

export function MarkerSwatch({
  color,
  symbol,
  open = false,
  className,
}: {
  color: string
  symbol: MarkerSymbol
  open?: boolean
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden
      focusable="false"
      className={cn('size-3 shrink-0 overflow-visible', className)}
      data-swatch={symbol}
      data-color={color}
    >
      <path
        d={SHAPES[symbol]}
        fill={open ? 'none' : color}
        stroke={open ? color : 'none'}
        strokeWidth={open ? 1.4 : 0}
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * The key of a series or group: its marker, on its line when the plot draws one (a line plot with a
 * line width above 0), without the marker when a line plot hides markers.
 */
export function SeriesKey({
  look,
  line,
}: {
  look: { color: string; symbol: MarkerSymbol; dash: LineDash; open: boolean }
  /** The data line: its width, and whether markers are drawn on it. null on a scatter plot. */
  line: { width: number; markers: boolean } | null
}) {
  if (!line || line.width <= 0)
    return <MarkerSwatch color={look.color} symbol={look.symbol} open={look.open} />
  return (
    <LineSwatch
      color={look.color}
      dash={look.dash}
      width={line.width}
      marker={line.markers ? { symbol: look.symbol, open: look.open } : undefined}
      length={28}
    />
  )
}

/** Plotly's dash patterns (drawing.dashStyle) in units of the line width, on a smaller unit to fit. */
function dashArray(dash: LineDash, width: number): string | undefined {
  const u = Math.max(width, 1.5)
  switch (dash) {
    case 'solid':
      return undefined
    case 'dot':
      return `${u} ${u}`
    case 'dash':
      return `${3 * u} ${3 * u}`
    case 'longdash':
      return `${5 * u} ${5 * u}`
    case 'dashdot':
      return `${3 * u} ${u} ${u} ${u}`
    case 'longdashdot':
      return `${5 * u} ${2 * u} ${u} ${2 * u}`
  }
}

/** A short line in the plot's pattern, with the marker on it when there is one. */
export function LineSwatch({
  color,
  dash,
  width,
  marker,
  length = 40,
  className,
}: {
  color: string
  dash: LineDash
  width: number
  marker?: { symbol: MarkerSymbol; open: boolean }
  /** CSS px, also the view box width: the dash pattern keeps its true scale. */
  length?: number
  className?: string
}) {
  return (
    <svg
      viewBox={`0 0 ${length} 12`}
      aria-hidden
      focusable="false"
      className={cn('h-3 shrink-0 overflow-visible', className)}
      style={{ width: length }}
      data-swatch-dash={dash}
      data-color={color}
    >
      <line
        x1="0"
        y1="6"
        x2={length}
        y2="6"
        stroke={color}
        strokeWidth={Math.min(width, 4)}
        strokeDasharray={dashArray(dash, Math.min(width, 4))}
      />
      {marker ? (
        <g transform={`translate(${length / 2 - 6} 0)`}>
          <path
            d={SHAPES[marker.symbol]}
            fill={marker.open ? 'var(--panel)' : color}
            stroke={marker.open ? color : 'none'}
            strokeWidth={marker.open ? 1.4 : 0}
            strokeLinejoin="round"
          />
        </g>
      ) : null}
    </svg>
  )
}
