/**
 * The SINGLE source of plot colours, marker symbols and dash patterns (the UI mirrors SERIES_COLORS
 * into CSS variables at startup for legends and swatches).
 *
 * Series colours follow the Okabe–Ito colour-blind-safe order. Every colour has at least 3:1 contrast
 * against the white plot background (WCAG 1.4.11, graphical objects); orange and sky blue are darkened
 * just enough to pass, and yellow (#F0E442, 1.32:1) is left out. WCAG contrast on #ffffff / grey value:
 *   #0072B2 blue            5.19:1 / 87     circle         solid
 *   #D55E00 vermillion      3.87:1 / 119    square         dash
 *   #009E73 bluish green    3.42:1 / 106    diamond        dot
 *   #CC79A7 reddish purple  3.06:1 / 151    triangle-up    dashdot
 *   #C08400 orange (dark)   3.21:1 / 135    triangle-down  longdash
 *   #4499D0 sky blue (dark) 3.13:1 / 134    cross          longdashdot
 *   #882255 wine            8.73:1 / 70     x
 *   #000000 black           21:1   / 0
 * Wine (from Paul Tol's palettes) and black were added to reach 8; both stay at least 20 ΔE2000 from
 * every other colour under simulated protanopia, deuteranopia and tritanopia. Some Okabe–Ito pairs come
 * closer for one deficiency (vermillion and orange for deuteranopia), and several colours collapse to
 * similar greys, so the symbol and dash cycles carry identity too. palette.test.ts re-computes all this.
 *
 * The colour comes from SeriesStyle.paletteIndex and the 'auto' symbol from the series position: 8 and
 * 7 are coprime, so the first 56 series of a plot all differ in colour or symbol.
 */
import { DEFAULT_FIT_STYLE } from '@/domain/model'
import type { FitStyle, LineDash, MarkerSymbol, PlotType, SeriesStyle } from '@/domain/model'

export const SERIES_COLORS: readonly string[] = [
  '#0072B2',
  '#D55E00',
  '#009E73',
  '#CC79A7',
  '#C08400',
  '#4499D0',
  '#882255',
  '#000000',
]

export const SERIES_SYMBOLS: readonly MarkerSymbol[] = [
  'circle',
  'square',
  'diamond',
  'triangle-up',
  'triangle-down',
  'cross',
  'x',
]

export const SERIES_DASHES: readonly LineDash[] = [
  'solid',
  'dash',
  'dot',
  'dashdot',
  'longdash',
  'longdashdot',
]

/**
 * Plot neutrals, from the design tokens in src/index.css (OKLCH converted to sRGB hex):
 * text = --foreground (16.7:1), mutedText = --muted-foreground (6.8:1), axis = --border-strong,
 * zero/reference lines 3.9:1, excluded (hollow) markers 3.2:1.
 */
export const NEUTRAL = {
  text: '#181f24',
  mutedText: '#545c62',
  grid: '#e5e8eb',
  axis: '#b8bfc3',
  zero: '#7b8186',
  excluded: '#8a9096',
  background: '#ffffff',
} as const

/** Positive modulo for cycling (NaN or non-integer indices are floored; NaN → 0). */
function cycle(i: number, n: number): number {
  const k = Number.isFinite(i) ? Math.floor(i) : 0
  return ((k % n) + n) % n
}

/**
 * Colour, symbol and dash of a series. The colour comes from style.paletteIndex (chosen when the series
 * is created, editable); 'auto' symbol and dash cycle with the series position `index`.
 */
export function seriesAppearance(
  index: number,
  style: SeriesStyle,
): { color: string; symbol: MarkerSymbol; dash: LineDash } {
  return {
    color: SERIES_COLORS[cycle(style.paletteIndex, SERIES_COLORS.length)],
    symbol: style.symbol === 'auto' ? SERIES_SYMBOLS[cycle(index, SERIES_SYMBOLS.length)] : style.symbol,
    dash: style.lineDash === 'auto' ? SERIES_DASHES[cycle(index, SERIES_DASHES.length)] : style.lineDash,
  }
}

/**
 * Colour and symbol of a group (split series, histogram / box / bar groups): by its rank in the plot's
 * order of that column's groups, so a group has the same colour in every series split by the column.
 * `seriesSymbol` (a plot with several series): the symbol tells the SERIES apart instead, else group A
 * of y and group A of z (or group B and an unsplit series of the same colour) would be drawn alike.
 * An override (SplitSpec.overrides, first match) wins for whichever of the two it sets.
 */
export function groupAppearance(
  rank: number,
  override?: { paletteIndex: number | null; symbol: MarkerSymbol | 'auto' },
  seriesSymbol?: MarkerSymbol,
): { color: string; symbol: MarkerSymbol } {
  const colour = override?.paletteIndex ?? rank
  return {
    color: SERIES_COLORS[cycle(colour, SERIES_COLORS.length)],
    symbol:
      override && override.symbol !== 'auto'
        ? override.symbol
        : (seriesSymbol ?? SERIES_SYMBOLS[cycle(rank, SERIES_SYMBOLS.length)]),
  }
}

/** Width of an automatic fit line that is the only line of its series (scatter plots). */
export const FIT_WIDTH_ALONE = 2.25
/** Candidates in order; the last two only come into play when the first three are all taken. */
const EXTRAPOLATION_DASHES: readonly LineDash[] = ['dot', 'dashdot', 'longdashdot', 'longdash', 'dash']

/** Whether the series draws a line under its markers: a line plot does, unless its line width is 0. */
export type SeriesLineMode = 'lines' | 'markers'

export interface FitAppearance {
  color: string
  dash: LineDash
  width: number
  /** Dash of the curve beyond the data (curveRange 'extend'). */
  extrapolationDash: LineDash
}

/**
 * How the fit curve of a series is drawn (`look` = seriesAppearance of the series), so that it never
 * shares a pattern with the data line or with its own extrapolation:
 * - automatic: where the series draws no line (scatter plot, line plot with line width 0) the fit is
 *   the only line, solid and FIT_WIDTH_ALONE wide; next to a data line it is dashed when that line is
 *   solid, else solid, at the default width;
 * - extrapolated parts: the first of dot, dashdot and longdashdot that neither the fit nor the data line
 *   uses, and never dot while the prediction band is drawn (its outline is dotted); longdash, then
 *   dash, when those three are all taken;
 * - an explicit FitStyle wins: a palette colour, a dash other than 'auto', a width other than the
 *   default (the stored default width stands for "automatic").
 */
export function fitAppearance(
  look: { color: string; dash: LineDash },
  plotType: PlotType,
  lineMode: SeriesLineMode,
  style: FitStyle,
  opts: { predictionBand?: boolean } = {},
): FitAppearance {
  const dataLine = plotType === 'line' && lineMode === 'lines' ? look.dash : null
  const color =
    style.color.mode === 'palette'
      ? SERIES_COLORS[cycle(style.color.index, SERIES_COLORS.length)]
      : look.color
  const dash = style.dash !== 'auto' ? style.dash : dataLine === 'solid' ? 'dash' : 'solid'
  const width = dataLine === null && style.width === DEFAULT_FIT_STYLE.width ? FIT_WIDTH_ALONE : style.width
  // At most three patterns are taken and there are five candidates: one is always left.
  const extrapolationDash = EXTRAPOLATION_DASHES.find(
    (d) => d !== dash && d !== dataLine && !(opts.predictionBand && d === 'dot'),
  )!
  return { color, dash, width, extrapolationDash }
}

/** '#rrggbb' → 'rgba(r, g, b, alpha)' (Plotly ≥ 4 accepts only CSS colours; error-bar opacity was removed). */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}
