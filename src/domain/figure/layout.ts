/**
 * Layout pieces: axes with explicit titles ({text} objects), exponentformat 'power'
 * (Plotly's default writes 1e9 as "1B"), separators from the locale, per-axis uirevision (changing the
 * variable, the scale or pressing "Reset view" resets the zoom; style changes do not), the residual
 * panel geometry, the legend position and the export annotations (indicator + caption).
 */
import type { Annotation, Layout, LayoutAxis, Legend, Shape } from 'plotly.js'
import type { LegendSpec } from '@/domain/model'
import type { FigureContext } from './context'
import { escapePlotText } from './escape'
import { NEUTRAL } from './palette'

export type AxisType = 'linear' | 'log' | 'date'

/** Main panel and residual panel y domains (the residual panel sits below, sharing x). */
export const MAIN_DOMAIN: [number, number] = [0.34, 1]
export const RESIDUAL_DOMAIN: [number, number] = [0, 0.24]

/**
 * Below this pane height (CSS px, FigureContext.paneHeight) a residual panel is compact: the residual
 * panel gets a larger share of the height, ticks are smaller and fewer, and the residual axis title is
 * left out (a rotated title cannot fit beside a panel a few tens of pixels tall; the hover still names
 * the residual and its unit). Exports have their own size and are never compact. 300 px: at 240 px (a
 * 2 × 2 grid on a 1080 px screen with the data table open) the full residual panel is about 40 px tall
 * and its five tick labels overlap.
 */
export const COMPACT_PANE_HEIGHT = 300
/**
 * Below this pane width (CSS px, FigureContext.paneWidth) a titled legend group stays above the plot:
 * at the right it would take half the width of a phone screen, where height is the cheaper dimension.
 */
export const NARROW_PANE_WIDTH = 560
export const COMPACT_MAIN_DOMAIN: [number, number] = [0.42, 1]
export const COMPACT_RESIDUAL_DOMAIN: [number, number] = [0, 0.3]

/** layout.separators: decimal mark then thousands separator. */
export const separatorsFor = (decimal: '.' | ',') => (decimal === ',' ? ',.' : '.,')

/**
 * Per-axis uirevision: `${plotId}|${columns}|${scale}|${viewResetCounter}`. The plot id keeps the zoom of
 * one plot from carrying over to another plot of the same columns drawn in the same place (tabs).
 */
export const axisRevision = (plotId: string, columns: string, scale: string, reset: number) =>
  `${plotId}|${columns}|${scale}|${reset}`

export interface AxisPlan {
  /** Plain text; escaped here. */
  title: string
  type: AxisType
  range: [number, number] | null
  showGrid: boolean
  uirevision: string
  tickvals?: number[]
  ticktext?: string[]
  showticklabels?: boolean
  domain?: [number, number]
  anchor?: 'x' | 'y' | 'x2' | 'y2'
  matches?: 'x' | 'y'
  zeroline?: boolean
  /** Small pane: 10 px ticks, 11 px title, tighter standoff. */
  compact?: boolean
  /** Upper bound on the number of ticks. */
  nticks?: number
}

export function axisLayout(p: AxisPlan): Partial<LayoutAxis> {
  const axis: Partial<LayoutAxis> = {
    title: {
      text: escapePlotText(p.title),
      font: { size: p.compact ? 11 : 13, color: NEUTRAL.text },
      standoff: p.compact ? 4 : 8,
    },
    type: p.type,
    exponentformat: 'power',
    showgrid: p.showGrid,
    gridcolor: NEUTRAL.grid,
    gridwidth: 1,
    showline: true,
    linecolor: NEUTRAL.axis,
    linewidth: 1,
    ticks: 'outside',
    tickcolor: NEUTRAL.axis,
    ticklen: p.compact ? 3 : 4,
    tickfont: { size: p.compact ? 10 : 12, color: NEUTRAL.mutedText },
    zeroline: p.zeroline ?? false,
    automargin: true,
    uirevision: p.uirevision,
  }
  // A matching axis (the residual panel's x) takes its range from the axis it matches.
  if (p.matches) axis.matches = p.matches
  else if (p.range) {
    axis.range = [p.range[0], p.range[1]]
    axis.autorange = false
  } else axis.autorange = true
  if (p.tickvals) {
    axis.tickmode = 'array'
    axis.tickvals = [...p.tickvals]
    axis.ticktext = (p.ticktext ?? []).map(escapePlotText)
  }
  if (p.nticks !== undefined) axis.nticks = p.nticks
  if (p.showticklabels === false) axis.showticklabels = false
  if (p.domain) axis.domain = [p.domain[0], p.domain[1]]
  if (p.anchor) axis.anchor = p.anchor
  return axis
}

/**
 * Legend placement. 'auto' = a horizontal legend above the plot (never covers data); corner positions
 * sit inside the main panel on a translucent white box; 'outside' = to the right.
 */
export function legendLayout(spec: LegendSpec, mainBottom: number): Partial<Legend> {
  const inside = { bgcolor: 'rgba(255, 255, 255, 0.85)', bordercolor: NEUTRAL.grid, borderwidth: 1 }
  const font = { size: 12, color: NEUTRAL.text }
  switch (spec.position) {
    case 'top-left':
      return { ...inside, font, x: 0.01, y: 0.99, xanchor: 'left', yanchor: 'top' }
    case 'top-right':
      return { ...inside, font, x: 0.99, y: 0.99, xanchor: 'right', yanchor: 'top' }
    case 'bottom-left':
      return { ...inside, font, x: 0.01, y: mainBottom + 0.01, xanchor: 'left', yanchor: 'bottom' }
    case 'bottom-right':
      return { ...inside, font, x: 0.99, y: mainBottom + 0.01, xanchor: 'right', yanchor: 'bottom' }
    case 'outside':
      return { font, x: 1.02, y: 1, xanchor: 'left', yanchor: 'top' }
    case 'auto':
      return { font, orientation: 'h', x: 0, y: 1.02, xanchor: 'left', yanchor: 'bottom' }
  }
}

/** Dashed zero line across the residual panel. */
export function residualZeroLine(): Partial<Shape> {
  return {
    type: 'line',
    xref: 'x2 domain',
    x0: 0,
    x1: 1,
    yref: 'y2',
    y0: 0,
    y1: 0,
    line: { color: NEUTRAL.zero, width: 1, dash: 'dash' },
    layer: 'below',
  }
}

export const CAPTION_FONT_SIZE = 12
export const CAPTION_LINE_HEIGHT = 16
/** Space below the plot area for x tick labels and the x title, before the caption block. */
export const CAPTION_OFFSET = 54

/**
 * Greedy word wrap to an approximate character budget (Plotly annotations do not wrap; the domain has
 * no text metrics, so the average glyph width is taken as 0.55 em — conservative for IBM Plex Sans).
 */
export function wrapCaption(
  lines: readonly string[],
  widthPx: number,
  fontSize = CAPTION_FONT_SIZE,
): string[] {
  const budget = Math.max(20, Math.floor(widthPx / (0.55 * fontSize)))
  const out: string[] = []
  for (const line of lines) {
    let cur = ''
    for (const word of line.split(' ')) {
      const next = cur ? `${cur} ${word}` : word
      if (cur && next.length > budget) {
        out.push(cur)
        cur = word
      } else cur = next
    }
    out.push(cur)
  }
  return out
}

/**
 * Export annotations below the plot: the sample indicator (always, when not null) and the caption
 * lines (when enabled). Returns the extra bottom margin they need.
 */
export function exportAnnotations(
  indicator: string | null,
  caption: readonly string[],
  ctx: FigureContext,
  plotWidthPx: number,
): { annotations: Partial<Annotation>[]; marginBottom: number } {
  const lines = [...(indicator ? [indicator] : []), ...caption]
  if (lines.length === 0) return { annotations: [], marginBottom: 0 }
  const wrapped = wrapCaption(lines, plotWidthPx)
  const base = {
    xref: 'paper' as const,
    yref: 'paper' as const,
    x: 0,
    y: 0,
    xanchor: 'left' as const,
    yanchor: 'top' as const,
    align: 'left' as const,
    showarrow: false,
    font: { size: CAPTION_FONT_SIZE, color: NEUTRAL.text, family: ctx.fontFamily },
  }
  const annotations: Partial<Annotation>[] = []
  let shift = CAPTION_OFFSET
  const indicatorLines = indicator ? wrapCaption([indicator], plotWidthPx) : []
  if (indicator) {
    annotations.push({
      ...base,
      name: 'indicator',
      yshift: -shift,
      text: indicatorLines.map(escapePlotText).join('<br>'),
    })
    shift += indicatorLines.length * CAPTION_LINE_HEIGHT + 4
  }
  const captionLines = wrapped.slice(indicatorLines.length)
  if (captionLines.length > 0)
    annotations.push({
      ...base,
      name: 'caption',
      yshift: -shift,
      text: captionLines.map(escapePlotText).join('<br>'),
      font: { ...base.font, color: NEUTRAL.mutedText },
    })
  return { annotations, marginBottom: shift + captionLines.length * CAPTION_LINE_HEIGHT + 8 }
}

/** Export annotations (exportAnnotations) that move with the caption block. */
export const isCaptionAnnotation = (a: Partial<Annotation>) => a.name === 'indicator' || a.name === 'caption'

/** Room kept between the lowest x-axis text (tick labels, title) and the first caption line. */
export const CAPTION_CLEARANCE = 8

/**
 * CAPTION_OFFSET leaves room for one line of x tick labels and the x title. Taller axis text (two-line
 * date ticks, rotated category labels) is only known once Plotly has drawn the figure. From the
 * measured bottom of that text and top of the first caption line (pixels, same origin), the caption
 * annotations move down and the bottom margin grows by the same amount, so the caption keeps its place
 * in the image and the plot area shrinks above it. null when the caption already clears the axis.
 */
export function clearCaption(
  layout: Partial<Layout>,
  measured: { axisBottom: number; captionTop: number },
): Partial<Layout> | null {
  const shift = Math.ceil(measured.axisBottom + CAPTION_CLEARANCE - measured.captionTop)
  const annotations = layout.annotations ?? []
  if (!(shift > 0) || !annotations.some(isCaptionAnnotation)) return null
  const margin = layout.margin ?? {}
  return {
    ...layout,
    margin: { ...margin, b: (margin.b ?? 0) + shift },
    annotations: annotations.map((a) =>
      isCaptionAnnotation(a) ? { ...a, yshift: (a.yshift ?? 0) - shift } : a,
    ),
  }
}
