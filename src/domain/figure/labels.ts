/**
 * Plain-text labels shared by the traces, the layout, the caption and the accessible summary. Nothing
 * here is escaped: callers escape (escapePlotText) when the text goes into Plotly.
 */
import type { DerivedSeries } from '@/domain/derive/pipeline'
import { blockOf, recordPositionOf } from '@/domain/derive/recordPosition'
import {
  CELL,
  type ErrorBarArrays,
  type ParsedColumn,
  type UncertaintyDescriptor,
} from '@/domain/derive/types'
import { formatFull, formatNumber, type NumberFormatLocale } from '@/domain/format/number'
import type {
  AxisSpec,
  ColumnId,
  ColumnMeta,
  Dataset,
  FitModel,
  PlotSpec,
  SeriesId,
  XYSeriesSpec,
} from '@/domain/model'
import type { FigureInput, Translate } from './context'
import { escapePlotText } from './escape'

/**
 * Display names of the series of a plot, by id (legend, caption, accessible summary; the panels too):
 * the typed name, else the y column name, prefixed by the dataset name when the plot shows several
 * datasets. An automatic name that another series also has becomes "{y} vs {x}" (same prefix), and
 * automatic names still equal after that get their position in the plot. A typed name is kept as typed.
 */
export function seriesLabels(
  series: readonly XYSeriesSpec[],
  datasets: readonly Dataset[],
  t: Translate,
): Map<SeriesId, string> {
  const severalDatasets = new Set(series.map((s) => s.datasetId)).size > 1
  const info = series.map((s) => {
    const ds = datasets.find((d) => d.id === s.datasetId)
    const column = (id: ColumnId) => ds?.columns.find((c) => c.id === id)?.name ?? ''
    return {
      typed: s.name?.trim() ?? '',
      prefix: severalDatasets && ds ? `${ds.name} · ` : '',
      x: column(s.x),
      y: column(s.y),
    }
  })
  const repeated = (labels: readonly string[]) => {
    const seen = new Map<string, number>()
    for (const l of labels) seen.set(l, (seen.get(l) ?? 0) + 1)
    return (k: number) => !info[k].typed && seen.get(labels[k])! > 1
  }
  let labels = info.map((i) => i.typed || `${i.prefix}${i.y}`)
  let clash = repeated(labels)
  labels = labels.map((l, k) =>
    clash(k) ? `${info[k].prefix}${t('plot.label.versus', { y: info[k].y, x: info[k].x })}` : l,
  )
  clash = repeated(labels)
  labels = labels.map((l, k) => (clash(k) ? t('legend.numbered', { name: l, n: k + 1 }) : l))
  return new Map(series.map((s, k) => [s.id, labels[k]]))
}

/** seriesLabels of the plot of a figure. */
export const figureSeriesLabels = (derived: Pick<FigureInput, 'plot' | 'doc'>, t: Translate) =>
  seriesLabels(derived.plot?.series ?? [], derived.doc.datasets, t)

function sharedUnit(columns: readonly ColumnMeta[]): string | null {
  if (columns.length === 0) return null
  const u = columns[0].unit
  return u !== null && columns.every((c) => c.unit === u) ? u : null
}

/**
 * Axis title "name (unit)". AxisSpec.label / unit override the column name / unit (an empty unit
 * string removes it). Several columns on one axis: their names, with one shared unit or each its own.
 */
export function axisTitle(spec: AxisSpec, columns: readonly ColumnMeta[]): string {
  const seen = new Set<string>()
  const cols = columns.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)))
  const withUnit = (label: string, unit: string | null) => (unit ? `${label} (${unit})` : label)
  const label = spec.label?.trim() ? spec.label.trim() : null
  if (label !== null) return withUnit(label, spec.unit !== null ? spec.unit : sharedUnit(cols))
  if (cols.length === 0) return spec.unit ? `(${spec.unit})` : ''
  const names = [...new Set(cols.map((c) => c.name))]
  if (spec.unit !== null) return withUnit(names.join(', '), spec.unit)
  const unit = sharedUnit(cols)
  if (unit !== null || cols.every((c) => c.unit === null)) return withUnit(names.join(', '), unit)
  return cols.map((c) => withUnit(c.name, c.unit)).join(', ')
}

/**
 * Axis titles of the active plot. XY plots use the given series (the shown ones); histogram: the value
 * column and "Count"; box: the group column (if any) and the value column; bar: category and value.
 */
export function plotTitles(
  derived: Pick<FigureInput, 'plot' | 'doc'>,
  series: readonly DerivedSeries[],
  t: Translate,
): { x: string; y: string } {
  const plot = derived.plot
  if (!plot) return { x: '', y: '' }
  const column = (datasetId: string | null, id: string | null) =>
    datasetId && id
      ? derived.doc.datasets.find((d) => d.id === datasetId)?.columns.find((c) => c.id === id)
      : undefined
  const one = (m: ColumnMeta | undefined) => (m ? [m] : [])
  switch (plot.type) {
    case 'scatter':
    case 'line':
      return {
        x: axisTitle(
          plot.xAxis,
          series.map((s) => s.xColumn),
        ),
        y: axisTitle(
          plot.yAxis,
          series.map((s) => s.yColumn),
        ),
      }
    case 'histogram': {
      const o = plot.histogram
      return {
        x: axisTitle(plot.xAxis, one(column(o.datasetId, o.value))),
        y: plot.yAxis.label?.trim() || t('figure.axis.count'),
      }
    }
    case 'box': {
      const o = plot.box
      const g = column(o.datasetId, o.groupBy)
      return {
        x: g ? axisTitle(plot.xAxis, [g]) : (plot.xAxis.label?.trim() ?? ''),
        y: axisTitle(plot.yAxis, one(column(o.datasetId, o.value))),
      }
    }
    case 'bar': {
      const o = plot.bar
      return {
        x: axisTitle(plot.xAxis, one(column(o.datasetId, o.category))),
        y: axisTitle(plot.yAxis, one(column(o.datasetId, o.value))),
      }
    }
  }
}

/**
 * Tab and pane label of a plot (`index` = its position in doc.plots): its name, else its title, else
 * "{y} vs {x}" with the names its axes show (axis label, else the column names; a histogram or a box
 * plot without groups names its one variable), else "Plot {n}". An axis label names a variable only
 * while the plot draws one on that axis: the axes are shared by every plot type, so a bar plot with no
 * columns chosen yet would otherwise be named after the scatter plot it was switched from.
 */
export function plotLabel(plot: PlotSpec, index: number, datasets: readonly Dataset[], t: Translate): string {
  const own = plot.name.trim() || plot.title.trim()
  if (own) return own
  const column = (datasetId: string | null, id: string | null) =>
    datasetId && id
      ? datasets.find((d) => d.id === datasetId)?.columns.find((c) => c.id === id)?.name
      : undefined
  const shown = (axis: AxisSpec, names: (string | undefined)[]) => {
    const plotted = [...new Set(names.filter((n): n is string => !!n))]
    return plotted.length ? axis.label?.trim() || plotted.join(', ') : ''
  }
  let y = ''
  let x = ''
  switch (plot.type) {
    case 'scatter':
    case 'line': {
      const pairs = plot.series
        .map((s) => [column(s.datasetId, s.x), column(s.datasetId, s.y)] as const)
        .filter(([a, b]) => a !== undefined && b !== undefined)
      x = shown(
        plot.xAxis,
        pairs.map(([a]) => a),
      )
      y = shown(
        plot.yAxis,
        pairs.map(([, b]) => b),
      )
      break
    }
    case 'histogram':
      // The one variable (drawn along x) takes the place of y: "T", never "Count vs T".
      y = shown(plot.xAxis, [column(plot.histogram.datasetId, plot.histogram.value)])
      break
    case 'box':
      y = shown(plot.yAxis, [column(plot.box.datasetId, plot.box.value)])
      if (plot.box.groupBy) x = shown(plot.xAxis, [column(plot.box.datasetId, plot.box.groupBy)])
      break
    case 'bar':
      y = shown(plot.yAxis, [column(plot.bar.datasetId, plot.bar.value)])
      x = shown(plot.xAxis, [column(plot.bar.datasetId, plot.bar.category)])
      break
  }
  if (y && x) return t('plot.label.versus', { y, x })
  if (y && (plot.type === 'histogram' || plot.type === 'box')) return y
  return t('plot.label.numbered', { n: index + 1 })
}

/** Short model name: "linear", "polynomial (degree 2)", "exponential", "power-law". */
export function modelLabel(model: FitModel, t: Translate): string {
  if (model.type === 'polynomial') return t('figure.model.polynomial', { degree: model.degree })
  return t(`fit.modelShort.${model.type}`)
}

/** The translated meaning of an error bar ("± u (Instrument)", "± SEM (n = 3 per group)"…). */
export function uncertaintyLabel(d: UncertaintyDescriptor, t: Translate): string {
  const params: Record<string, string | number> = { ...d.params }
  if (typeof params.origin === 'string') params.origin = t(`uncertainty.origins.${params.origin}`)
  return t(d.labelKey, params)
}

/** A number without float noise (10 significant digits), localized; "—" when not finite. */
export function cleanNumber(v: number, loc: NumberFormatLocale, sig = 10): string {
  if (!Number.isFinite(v)) return formatFull(v, loc)
  return formatFull(Number(v.toPrecision(sig)), loc)
}

const PLAIN_DECIMAL = /^[+\-−]?\d+(?:([.,])(\d+))?$/

/**
 * Display text of a cell value (hover, tooltips): a plain decimal keeps the decimals it was recorded
 * with ("1.70" stays "1.70", localized) when its separator is the column's decimal separator and the
 * re-formatted text gives back exactly the analysed value; otherwise the value without float noise.
 * Datetimes show the recorded text (or ISO 8601 UTC). Non-finite → "—".
 */
export function valueText(col: ParsedColumn | undefined, i: number, loc: NumberFormatLocale): string {
  if (!col) return '—'
  const v = col.values[i]
  const raw = (col.text[i] ?? '').trim()
  if (!Number.isFinite(v)) return '—'
  if (col.settings.kind === 'datetime') return raw || new Date(v).toISOString()
  const m = PLAIN_DECIMAL.exec(raw)
  if (m) {
    const sep = m[1]
    const decimal = col.settings.decimal
    const sepIsDecimal =
      sep === undefined || decimal === 'mixed' || (decimal === 'dot' ? sep === '.' : sep === ',')
    if (sepIsDecimal) {
      const decimals = m[2]?.length ?? 0
      const text = formatNumber(v, { decimals, loc })
      if (Number(text.replace('−', '-').replace(',', '.')) === v) return text
    }
  }
  return cleanNumber(v, loc)
}

/**
 * True when at least one bar exists (status ok, a zero-length bar included). Bars that are all missing
 * or refused draw nothing, so their meaning is neither drawn nor described (legend, hover, caption).
 */
export function anyBar(b: Pick<ErrorBarArrays, 'status'> | null | undefined): boolean {
  if (!b) return false
  for (let i = 0; i < b.status.length; i++) if (b.status[i] === CELL.ok) return true
  return false
}

/** Half-lengths of a bar as hover text: " ± 0.002" or " +0.003 / −0.002"; '' when there is no bar. */
export function barText(plus: number, minus: number | null, loc: NumberFormatLocale): string {
  if (!Number.isFinite(plus)) return ''
  if (minus === null) return ` ± ${cleanNumber(plus, loc, 6)}`
  if (!Number.isFinite(minus)) return ''
  return ` +${cleanNumber(plus, loc, 6)} / −${cleanNumber(minus, loc, 6)}`
}

/**
 * Hover field of a RowId's source position: the row number (file line / sheet row), or the sheet column
 * letters of a transposed block; NaN when the row is not in the view.
 */
export function sourcePositionOf(view: DerivedSeries['view'], rowId: number): number | string {
  const p = recordPositionOf(view, rowId)
  if (!p) return NaN
  return p.axis === 'row' ? p.index : p.text
}

/** The table a RowId came from in a dataset stacked from several tables; null otherwise. */
export function recordBlockOf(view: DerivedSeries['view'], rowId: number): string | null {
  return view.recordBlocks?.length ? blockOf(view.recordBlocks, rowId) : null
}

/**
 * The hover field of a RowId (see recordTemplate): its source position, or in a stacked dataset, where
 * every table has its own row 5, the whole line with the table, "oak plank 1 · row 5", escaped.
 */
export function recordField(view: DerivedSeries['view'], rowId: number, t: Translate): number | string {
  const block = recordBlockOf(view, rowId)
  const p = block === null ? null : recordPositionOf(view, rowId)
  if (!p) return sourcePositionOf(view, rowId)
  return escapePlotText(t('table.blockRecord', { block: block!, axis: p.axis, pos: p.text }))
}

/** "Row 12" / "Column D" (figure.hover.*) of a RowId in a view; with its table in a stacked dataset. */
export function recordLabel(view: DerivedSeries['view'], rowId: number, t: Translate): string {
  const p = recordPositionOf(view, rowId)
  const block = p ? recordBlockOf(view, rowId) : null
  if (p && block !== null) return t('table.blockRecord', { block, axis: p.axis, pos: p.text })
  if (p?.axis === 'column') return t('figure.hover.column', { column: p.text })
  return t('figure.hover.row', { row: p ? p.index : NaN })
}
