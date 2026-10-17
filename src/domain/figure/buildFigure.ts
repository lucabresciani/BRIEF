/**
 * One derived plot + display context → a Plotly figure. Pure: the figure is DERIVED, never
 * stored; every call returns fresh, unfrozen objects (Plotly mutates traces and layout). The analysed
 * sample, statistics and fits come from the pipeline untouched: axis scales, plot type, visibility,
 * style and selection only change what is drawn here, and everything the drawing cannot show is
 * reported (log axes, many points, extrapolation) instead of being dropped silently.
 */
import type { Data, Layout } from 'plotly.js'
import type { DerivedSeries } from '@/domain/derive/pipeline'
import { MAX_SPLIT_GROUPS, NO_VALUE_KEY, columnGroups, groupUids } from '@/domain/derive/split'
import type { FitOk, Selection } from '@/domain/derive/types'
import { INACTIVE, effectiveSettings, issue } from '@/domain/model'
import type { AxisSpec, ColumnMeta, Issue, MarkerSymbol, PlotView, RowId } from '@/domain/model'
import type { HistogramResult } from '@/domain/stats/histogram'
import { describeUncertainty } from '@/domain/uncertainty/describe'
import { a11ySummary } from './a11ySummary'
import { captionLines, residualPanelRequested, sampleIndicator, sourceText } from './caption'
import { plotConfig } from './config'
import type { FigureContext, FigureInput, FigureOut, Translate } from './context'
import { escapePlotText } from './escape'
import { groupLabel, groupRanks } from './groups'
import { cleanNumber, figureSeriesLabels, modelLabel, plotTitles, uncertaintyLabel } from './labels'
import {
  type AxisPlan,
  type AxisType,
  COMPACT_MAIN_DOMAIN,
  COMPACT_PANE_HEIGHT,
  NARROW_PANE_WIDTH,
  COMPACT_RESIDUAL_DOMAIN,
  MAIN_DOMAIN,
  RESIDUAL_DOMAIN,
  axisLayout,
  axisRevision,
  exportAnnotations,
  legendLayout,
  residualZeroLine,
  separatorsFor,
} from './layout'
import { LogTally, axisRange, drawableOn } from './logDomain'
import {
  NEUTRAL,
  SERIES_COLORS,
  fitAppearance,
  groupAppearance,
  seriesAppearance,
  withAlpha,
} from './palette'
import { buildSelectionMap, selectedIndicesForTrace } from './selectionMap'
import { barTraces } from './traces/bar'
import { bandTraces } from './traces/band'
import { type BoxGroup, boxGroups, boxStatsTrace, boxTrace, smallGroupIssues } from './traces/box'
import { boxPointFilter, observationsTrace } from './traces/boxPoints'
import { type BuiltTrace, UID_SEP } from './traces/common'
import { excludedPoints } from './traces/excluded'
import { curveGrid, fitTraces } from './traces/fit'
import { groupMeansTrace } from './traces/groupMeans'
import { histogramGroupTraces, histogramTrace } from './traces/histogram'
import { legendProxy } from './traces/legendProxy'
import { linePoints } from './traces/line'
import { residualTrace } from './traces/residuals'
import { type SeriesEnv, scatterPoints } from './traces/scatter'

export type { FigureContext, FigureInput, FigureOut } from './context'

/** Above this many drawn markers the figure warns that interaction may slow down (never subsamples). */
export const MANY_POINTS = 5000

interface Body {
  traces: BuiltTrace[]
  issues: Issue[]
  /** Caption lines describing the method of histogram / box / bar plots. */
  methods: string[]
  x: AxisPlan
  y: AxisPlan
  residual: { x2: AxisPlan; y2: AxisPlan } | null
  extra?: Partial<Layout>
  counts?: { bins?: number; groups?: number; bars?: number }
}

const kindOf = (m: ColumnMeta) => effectiveSettings(m).kind
const plottable = (m: ColumnMeta) => kindOf(m) === 'numeric' || kindOf(m) === 'datetime'

/**
 * Title of the residual axis. Residuals are in the unit of y ("Residual (V)"), or of ln y for
 * log-linear fits (dimensionless). One label when every series in the panel agrees, otherwise one
 * entry per series ("Residual: V (V), P (mW)"): a single unit is never put on residuals in another.
 */
function residualAxisTitle(
  entries: readonly { name: string; unit: string | null; ln: boolean }[],
  t: Translate,
) {
  const label = t('figure.residual')
  if (entries.length === 0) return label
  if (entries.every((e) => e.ln)) return t('figure.residualLn')
  const unit = entries[0].unit
  if (entries.every((e) => !e.ln && e.unit === unit)) return unit ? `${label} (${unit})` : label
  const parts = entries.map((e) => (e.ln ? `ln ${e.name}` : e.unit ? `${e.name} (${e.unit})` : e.name))
  return `${label}: ${[...new Set(parts)].join(', ')}`
}

/** Fixed range of a date axis: epoch-ms limits as given (no log). */
function dateRange(range: AxisSpec['range']): { range: [number, number] | null; issue: Issue | null } {
  if (range.mode !== 'fixed') return { range: null, issue: null }
  if (!Number.isFinite(range.min) || !Number.isFinite(range.max) || !(range.min < range.max))
    return { range: null, issue: issue('E_RANGE_INVERTED', { min: range.min, max: range.max }) }
  return { range: [range.min, range.max], issue: null }
}

// ---- XY plots (scatter, line) -------------------------------------------------------------------------

/** XY traces by layer, in drawing order: bands under fits under the data; data-free legend entries last. */
interface Layers {
  bands: BuiltTrace[]
  fits: BuiltTrace[]
  excluded: BuiltTrace[]
  points: BuiltTrace[]
  means: BuiltTrace[]
  residuals: BuiltTrace[]
  legend: BuiltTrace[]
}
const LAYERS = ['bands', 'fits', 'excluded', 'points', 'means', 'residuals', 'legend'] as const
type Mark = Record<keyof Layers, number>
const markOf = (l: Layers) => Object.fromEntries(LAYERS.map((k) => [k, l[k].length])) as Mark
/** Traces added to the layers since `m`. */
const since = (l: Layers, m: Mark) => LAYERS.flatMap((k) => l[k].slice(m[k]))
const allTraces = (l: Layers) => LAYERS.flatMap((k) => l[k])

/** The successful fits of a series: its own, or those of its groups when it is fitted per group. */
export function okFits(s: DerivedSeries): FitOk[] {
  if (s.fit?.status === 'ok') return [s.fit]
  const out: FitOk[] = []
  for (const g of s.split?.groups ?? []) if (g.fit?.status === 'ok') out.push(g.fit)
  return out
}

/** How the fit drawn in env `e` (the series, or one of its groups) looks; see fitAppearance. */
function fitLookOf(s: DerivedSeries, e: Pick<SeriesEnv, 'color' | 'dash'>, plotType: PlotView['type']) {
  const spec = s.fitSpec!
  const lineMode = s.spec.style.lineWidth > 0 ? 'lines' : 'markers'
  return fitAppearance({ color: e.color, dash: e.dash }, plotType, lineMode, spec.style, {
    predictionBand: spec.show.predictionBand,
  })
}

/**
 * The legend entries that stand for every group of a split series (data-free traces, neutral): the
 * per-group fits ("linear fit, each group"), each kind of band, the group means. Only for what the
 * groups actually drew since `m`.
 */
function groupLegend(
  env: SeriesEnv,
  s: DerivedSeries,
  plotType: PlotView['type'],
  l: Layers,
  m: Mark,
): BuiltTrace[] {
  const { t } = env.ctx
  const out: BuiltTrace[] = []
  const drew = (layer: BuiltTrace[], from: number, role: string) =>
    layer.slice(from).some((b) => b.uid.endsWith(`__${role}`))
  const spec = s.fitSpec
  if (spec) {
    const level = Math.round(spec.confidence * 100)
    if (drew(l.fits, m.fits, 'fit')) {
      const look = fitLookOf(s, { color: NEUTRAL.text, dash: env.dash }, plotType)
      out.push(
        legendProxy(env, 'fitLegend', t('legend.fitEachGroup', { model: modelLabel(spec.model, t) }), {
          line: { color: look.color, width: look.width, dash: look.dash },
        }),
      )
    }
    if (drew(l.bands, m.bands, 'predictionBand'))
      out.push(
        legendProxy(env, 'predictionBandLegend', t('legend.band.predictionEachGroup', { level }), {
          line: { color: NEUTRAL.text, width: 1, dash: 'dot' },
          fillcolor: withAlpha(NEUTRAL.text, 0.06),
        }),
      )
    if (drew(l.bands, m.bands, 'band'))
      out.push(
        legendProxy(env, 'bandLegend', t('legend.band.confidenceEachGroup', { level }), {
          line: { color: NEUTRAL.text, width: 0 },
          fillcolor: withAlpha(NEUTRAL.text, 0.12),
        }),
      )
  }
  const ySpec = s.spec.errorBars.y
  if (l.means.length > m.means && (ySpec.kind === 'sd' || ySpec.kind === 'sem' || ySpec.kind === 'ci')) {
    const groupN = (s.split?.groups ?? []).flatMap((g) => g.replicate?.groups.map((r) => r.n) ?? [])
    const label = uncertaintyLabel(describeUncertainty(ySpec, { groupN }), t)
    const size = s.spec.style.markerSize + 4
    out.push(
      legendProxy(env, 'groupMeansLegend', t('legend.groupMeansEachGroup', { label }), {
        marker: {
          color: NEUTRAL.background,
          size,
          symbol: 'diamond',
          line: { color: NEUTRAL.text, width: 1 },
        },
      }),
    )
  }
  return out
}

/** After the groups (each with its excluded entry): the pooled or "each group" fit, the bands, the means. */
const SPLIT_LEGEND_ROLES = [
  'fit',
  'fitLegend',
  'band',
  'bandLegend',
  'predictionBand',
  'predictionBandLegend',
  'groupMeans',
  'groupMeansLegend',
]

/**
 * The legend entries of a split series in the order they should read: the groups in group order, each
 * followed by its excluded points, then SPLIT_LEGEND_ROLES.
 */
function legendOrder(traces: readonly BuiltTrace[], groups: readonly SeriesEnv[]): BuiltTrace[] {
  const position = (b: BuiltTrace) => {
    const role = b.uid.slice(b.uid.lastIndexOf(UID_SEP) + UID_SEP.length)
    const k = groups.findIndex((e) => b.uid.includes(`${UID_SEP}${e.group!.uid}${UID_SEP}`))
    if (k >= 0) return 2 * k + (role === 'excluded' ? 1 : 0)
    return 2 * groups.length + SPLIT_LEGEND_ROLES.indexOf(role)
  }
  return traces
    .filter((b) => (b.trace as { showlegend?: boolean }).showlegend !== false)
    .sort((a, b) => position(a) - position(b))
}

function buildXY(
  derived: FigureInput,
  view: Extract<PlotView, { type: 'scatter' | 'line' }>,
  ctx: FigureContext,
  tally: LogTally,
): Body | Issue[] {
  const plot = derived.plot!
  if (derived.series.length === 0) return [issue('E_PLOT_NOT_CONFIGURED')]
  const issues: Issue[] = []
  const usable: DerivedSeries[] = []
  for (const s of derived.series) {
    const bad = [s.xColumn, s.yColumn].find((c) => !plottable(c))
    if (bad) issues.push(issue('E_COLUMN_NOT_NUMERIC', { column: bad.name }, { columnId: bad.id }))
    else usable.push(s)
  }
  if (usable.length === 0) return issues

  const exportMode = ctx.mode === 'export'
  const drawn = exportMode ? usable.filter((s) => s.spec.visible) : usable
  const visibleSeries = usable.filter((s) => s.spec.visible)
  const titles = plotTitles(derived, visibleSeries.length ? visibleSeries : usable, ctx.t)
  // The scales the pipeline derived the render masks with: a date axis is linear (no log date axis).
  const scales = derived.axisScales
  const xDate = usable.every((s) => kindOf(s.xColumn) === 'datetime')
  const yDate = usable.every((s) => kindOf(s.yColumn) === 'datetime')
  // A log scale requested on a date axis is drawn linear (axisScales): reported, never dropped silently.
  if (xDate && plot.xAxis.scale === 'log' && scales.x !== 'log')
    issues.push(issue('I_DATE_AXIS_LINEAR', { axis: 'x' }))
  if (yDate && plot.yAxis.scale === 'log' && scales.y !== 'log')
    issues.push(issue('I_DATE_AXIS_LINEAR', { axis: 'y' }))
  // Scatter and line plots alike (the fit panel's switch applies to both).
  const residualPanel =
    residualPanelRequested(plot, ctx.mode) &&
    drawn.some((s) => s.spec.visible && s.fitSpec?.show.residuals && okFits(s).length > 0)

  const out: Layers = { bands: [], fits: [], excluded: [], points: [], means: [], residuals: [], legend: [] }
  const residualEntries: { name: string; unit: string | null; ln: boolean }[] = []
  const labels = figureSeriesLabels(derived, ctx.t)
  // Ranked over every usable series, so hiding one never recolours the groups of another.
  const rankOf = groupRanks(usable)
  // Next to other series the group symbol is the series' own (screen and export alike).
  const groupSymbolBySeries = usable.length > 1
  const extrapolated = new Set<string>()
  const splitLegends: BuiltTrace[][] = []
  for (const s of drawn) {
    const look = seriesAppearance(s.index, s.spec.style)
    const name = labels.get(s.spec.id) ?? s.yColumn.name
    const env: SeriesEnv = {
      s,
      name,
      seriesName: name,
      group: null,
      several: drawn.length > 1,
      color: look.color,
      symbol: look.symbol,
      dash: look.dash,
      visible: s.spec.visible ? true : 'legendonly',
      scales,
      ctx,
      tally: s.spec.visible ? tally : null,
    }
    const start = markOf(out)
    const drawFit = (e: SeriesEnv, fit: FitOk, lookOf?: Parameters<typeof residualTrace>[2]) => {
      const spec = s.fitSpec!
      const show = spec.show
      const grid =
        show.curve || show.confidenceBand || show.predictionBand ? curveGrid(fit, spec, scales.x) : null
      if (grid) {
        if (show.predictionBand) out.bands.push(...bandTraces(e, fit, grid, 'prediction'))
        if (show.confidenceBand) out.bands.push(...bandTraces(e, fit, grid, 'confidence'))
        if (show.curve) {
          const f = fitTraces(e, fit, grid, fitLookOf(s, e, view.type))
          out.fits.push(...f.traces)
          if (s.spec.visible)
            for (const i of f.issues) {
              const key = `${i.code}|${i.params?.series}|${i.params?.pattern}`
              if (i.code === 'W_EXTRAPOLATION' && extrapolated.has(key)) continue
              extrapolated.add(key)
              issues.push(i)
            }
        }
      }
      if (residualPanel && show.residuals) out.residuals.push(residualTrace(e, fit, lookOf))
    }
    const drawData = (e: SeriesEnv) => {
      if (plot.scatter.showExcluded) {
        const ex = excludedPoints(e)
        if (ex) out.excluded.push(ex)
      }
      out.points.push(view.type === 'line' ? linePoints(e, view.options) : scatterPoints(e))
      const gm = groupMeansTrace(e)
      if (gm) out.means.push(gm)
    }

    if (!s.split) {
      const fit = s.fit?.status === 'ok' ? s.fit : null
      if (fit && s.fitSpec) drawFit(env, fit)
      drawData(env)
    } else {
      const overrides = s.spec.split?.overrides ?? []
      const groups = s.split.groups.map((g): SeriesEnv => {
        // First match wins: a key listed twice keeps its first override.
        const gl = groupAppearance(
          rankOf(s, g.key),
          overrides.find((o) => o.key === g.key),
          groupSymbolBySeries ? look.symbol : undefined,
        )
        return { ...env, name: groupLabel(g, ctx.t), group: g, color: gl.color, symbol: gl.symbol }
      })
      // One pooled fit over the groups: neutral (or its own palette colour), never a group's colour;
      // its residuals keep the colour and symbol of their group.
      const pooled = s.fit?.status === 'ok' ? s.fit : null
      if (pooled && s.fitSpec) {
        const byRow = new Map<number, { color: string; symbol: MarkerSymbol }>()
        for (const e of groups) for (const i of e.group!.rows) byRow.set(s.data.rowIds[i], e)
        drawFit({ ...env, color: NEUTRAL.text }, pooled, (r) => byRow.get(r))
      }
      const groupStart = markOf(out)
      for (const e of groups) {
        const fit = e.group!.fit?.status === 'ok' ? (e.group!.fit as FitOk) : null
        if (fit && s.fitSpec) drawFit(e, fit)
        drawData(e)
      }
      out.legend.push(...groupLegend(env, s, view.type, out, groupStart))
      const title = { text: escapePlotText(name) }
      const mine = since(out, start)
      for (const b of mine) (b.trace as { legendgrouptitle?: unknown }).legendgrouptitle = title
      splitLegends.push(legendOrder(mine, groups))
    }
    // The axis describes the residuals actually drawn (hidden series are 'legendonly' on screen).
    const lnFit = okFits(s)[0]
    if (out.residuals.length > start.residuals && s.spec.visible && lnFit)
      residualEntries.push({ name: s.yColumn.name, unit: s.yColumn.unit, ln: lnFit.r2Of === 'lnY' })
  }
  // Plotly reverses every legend group once a band (fill 'tonexty') is drawn; ranks keep a split
  // series' entries in group order either way. Their lowest rank is Plotly's default (1000), so the
  // order of the series themselves is unchanged.
  const reversed = allTraces(out).some((b) => {
    const fill = (b.trace as { fill?: string }).fill
    return fill === 'tonexty' || fill === 'tonextx'
  })
  for (const list of splitLegends)
    list.forEach((b, k) => {
      ;(b.trace as { legendrank?: number }).legendrank = 1000 + (reversed ? list.length - 1 - k : k)
    })

  const reset = ctx.viewResetCounter
  const uniq = (ids: string[]) => [...new Set(ids)].join(',')
  const compact =
    residualPanel &&
    ctx.mode === 'screen' &&
    ctx.paneHeight !== undefined &&
    ctx.paneHeight < COMPACT_PANE_HEIGHT
  const xType: AxisType = xDate ? 'date' : scales.x
  const yType: AxisType = yDate ? 'date' : scales.y
  const xr = xDate ? dateRange(plot.xAxis.range) : axisRange(plot.xAxis.range, scales.x)
  const yr = yDate ? dateRange(plot.yAxis.range) : axisRange(plot.yAxis.range, scales.y)
  for (const r of [xr, yr]) if (r.issue) issues.push(r.issue)
  const xRev = axisRevision(plot.id, `${plot.type}:${uniq(usable.map((s) => s.spec.x))}`, xType, reset)
  const yRev = axisRevision(plot.id, `${plot.type}:${uniq(usable.map((s) => s.spec.y))}`, yType, reset)
  const x: AxisPlan = {
    title: residualPanel ? '' : titles.x,
    type: xType,
    range: xr.range,
    showGrid: plot.xAxis.showGrid,
    uirevision: xRev,
    ...(residualPanel ? { showticklabels: false } : {}),
  }
  const y: AxisPlan = {
    title: titles.y,
    type: yType,
    range: yr.range,
    showGrid: plot.yAxis.showGrid,
    uirevision: yRev,
    ...(residualPanel ? { domain: compact ? COMPACT_MAIN_DOMAIN : MAIN_DOMAIN } : {}),
    ...(compact ? { compact, nticks: 4 } : {}),
  }
  const residualTitle = residualAxisTitle(residualEntries, ctx.t)
  return {
    traces: allTraces(out),
    issues,
    methods: [],
    x,
    y,
    residual: residualPanel
      ? {
          x2: {
            title: titles.x,
            type: xType,
            range: null,
            showGrid: plot.xAxis.showGrid,
            uirevision: xRev,
            anchor: 'y2',
            matches: 'x',
            ...(compact ? { compact } : {}),
          },
          y2: {
            title: compact ? '' : residualTitle,
            type: 'linear',
            range: null,
            showGrid: plot.yAxis.showGrid,
            uirevision: axisRevision(
              plot.id,
              `residuals:${uniq(usable.map((s) => s.spec.y))}`,
              'linear',
              reset,
            ),
            domain: compact ? COMPACT_RESIDUAL_DOMAIN : RESIDUAL_DOMAIN,
            anchor: 'x2',
            ...(compact ? { compact, nticks: 3 } : {}),
          },
        }
      : null,
  }
}

// ---- histogram / box / bar ----------------------------------------------------------------------------

/** Dataset, view and column metadata of a single-dataset plot; null = not configured. */
function singleContext(derived: FigureInput, datasetId: string | null, ids: (string | null)[]) {
  if (!datasetId || ids.some((id) => !id)) return null
  const dataset = derived.doc.datasets.find((d) => d.id === datasetId)
  const dsView = dataset ? derived.views.get(dataset.id) : undefined
  if (!dataset || !dsView) return null
  const metas = ids.map((id) => dataset.columns.find((c) => c.id === id))
  if (metas.some((m) => !m || !dsView.columns.has(m.id))) return null
  return { dataset, view: dsView, metas: metas as ColumnMeta[] }
}

/**
 * Bars and histogram counts start at zero: a log value (y) axis is drawn linear and says so. The x axis
 * of a bar plot is categorical (no scale control) and histogram bins are linear (the panel explains it):
 * a log left on x from another plot type is not a reason to say that bars start at zero.
 */
function linearOnly(derived: FigureInput, issues: Issue[]): void {
  if (derived.plot!.yAxis.scale === 'log') issues.push(issue('I_BAR_LINEAR_ONLY'))
}

function linearRange(spec: AxisSpec, issues: Issue[]): [number, number] | null {
  const r = axisRange(spec.range, 'linear')
  if (r.issue) issues.push(r.issue)
  return r.range
}

function buildHistogram(
  derived: FigureInput,
  view: Extract<PlotView, { type: 'histogram' }>,
  ctx: FigureContext,
): Body | Issue[] {
  const plot = derived.plot!
  const o = view.options
  const c = singleContext(derived, o.datasetId, [o.value])
  if (!c) return [issue('E_PLOT_NOT_CONFIGURED')]
  const [meta] = c.metas
  if (kindOf(meta) !== 'numeric')
    return [issue('E_COLUMN_NOT_NUMERIC', { column: meta.name }, { columnId: meta.id })]
  const sample = derived.columnSample(c.dataset.id, [meta.id])
  const col = c.view.columns.get(meta.id)!
  const values: number[] = []
  const rowIds: number[] = []
  const at: number[] = []
  if (sample)
    for (let i = 0; i < c.view.rowIds.length; i++)
      if (sample.reason[i] === INACTIVE.active && Number.isFinite(col.values[i])) {
        values.push(col.values[i])
        rowIds.push(c.view.rowIds[i])
        at.push(i)
      }
  if (values.length === 0) return [issue('E_HISTOGRAM_NO_DATA', { column: meta.name }, { columnId: meta.id })]
  const issues: Issue[] = []
  linearOnly(derived, issues)
  const histInput = {
    owner: plot.id,
    datasetId: c.dataset.id,
    name: meta.name,
    unit: meta.unit,
    values,
    rowIds,
    bins: o.bins,
    t: ctx.t,
    loc: ctx.loc,
  }
  // groupBy: the sample is the value column's alone, so a row without a group value stays in the
  // histogram, in the group "(no value)".
  const groupMeta = o.groupBy ? c.dataset.columns.find((m) => m.id === o.groupBy) : undefined
  const groupCol = groupMeta ? c.view.columns.get(groupMeta.id) : undefined
  const cg = groupCol ? columnGroups(groupCol) : null
  if (groupMeta && cg?.tooMany)
    issues.push(
      issue(
        'W_SPLIT_TOO_MANY_GROUPS',
        { column: groupMeta.name, count: cg.distinct, limit: MAX_SPLIT_GROUPS },
        { columnId: groupMeta.id },
      ),
    )
  let traces: BuiltTrace[]
  let result: HistogramResult
  const methods: string[] = []
  let groupCount: number | undefined
  if (groupMeta && cg && !cg.tooMany) {
    // Only the groups that have values in the histogram, in the column's order.
    const present = [...new Set(at.map((i) => cg.groupOf[i]))].sort((a, b) => a - b)
    const slot = new Map(present.map((g, k) => [g, k]))
    const groups = present.map((g, rank) => ({
      label: groupLabel(cg.groups[g], ctx.t),
      uid: cg.groups[g].uid,
      rank,
    }))
    const grouped = histogramGroupTraces({
      ...histInput,
      groupName: groupMeta.name,
      groupOf: at.map((i) => slot.get(cg.groupOf[i])!),
      groups,
      mode: o.groupMode,
    })
    traces = grouped.built
    result = grouped.result
    groupCount = groups.length
    const none = present.findIndex((g) => cg.groups[g].key === NO_VALUE_KEY)
    if (none >= 0) {
      const rows = rowIds.filter((_, k) => cg.groups[cg.groupOf[at[k]]].key === NO_VALUE_KEY)
      issues.push(
        issue(
          'I_SPLIT_NO_VALUE',
          { count: rows.length, column: groupMeta.name },
          { rows: rows as RowId[], columnId: groupMeta.id },
        ),
      )
    }
    methods.push(
      ctx.t('figure.caption.histogramGroups', {
        column: groupMeta.name,
        mode: o.groupMode,
        groups: groups.map((g, k) => `${g.label}: n = ${grouped.n[k]}`).join(', '),
      }),
    )
  } else {
    const single = histogramTrace(histInput)
    traces = [single.built]
    result = single.result
  }
  const titles = plotTitles(derived, [], ctx.t)
  const reset = ctx.viewResetCounter
  const unit = meta.unit ? ` ${meta.unit}` : ''
  methods.unshift(
    ctx.t('figure.caption.histogram', {
      width: `${cleanNumber(result.binWidth, ctx.loc)}${unit}`,
      bins: result.counts.length,
      n: values.length,
    }),
  )
  return {
    traces,
    issues,
    methods,
    x: {
      title: titles.x,
      type: 'linear',
      range: linearRange(plot.xAxis, issues),
      showGrid: plot.xAxis.showGrid,
      uirevision: axisRevision(plot.id, `histogram:${meta.id}`, 'linear', reset),
    },
    y: {
      title: titles.y,
      type: 'linear',
      range: linearRange(plot.yAxis, issues),
      showGrid: plot.yAxis.showGrid,
      uirevision: axisRevision(plot.id, `histogram:${meta.id}:count`, 'linear', reset),
    },
    residual: null,
    extra: groupCount !== undefined ? { bargap: 0, barmode: o.groupMode } : { bargap: 0 },
    counts: { bins: result.counts.length, ...(groupCount !== undefined ? { groups: groupCount } : {}) },
  }
}

function buildBox(
  derived: FigureInput,
  view: Extract<PlotView, { type: 'box' }>,
  ctx: FigureContext,
  tally: LogTally,
): Body | Issue[] {
  const plot = derived.plot!
  const o = view.options
  const c = singleContext(derived, o.datasetId, [o.value])
  if (!c) return [issue('E_PLOT_NOT_CONFIGURED')]
  const [meta] = c.metas
  if (kindOf(meta) !== 'numeric')
    return [issue('E_COLUMN_NOT_NUMERIC', { column: meta.name }, { columnId: meta.id })]
  const groupMeta = o.groupBy
    ? c.dataset.columns.find((m) => m.id === o.groupBy && c.view.columns.has(m.id))
    : undefined
  const sample = derived.columnSample(c.dataset.id, groupMeta ? [meta.id, groupMeta.id] : [meta.id])
  if (!sample) return [issue('E_PLOT_NOT_CONFIGURED')]
  const groups = boxGroups(c.view, meta.id, groupMeta?.id ?? null, sample, meta.name, ctx.loc)
  if (groups.length === 0) return [issue('E_HISTOGRAM_NO_DATA', { column: meta.name }, { columnId: meta.id })]
  const color = SERIES_COLORS[0]
  const yScale = plot.yAxis.scale
  // The boxes are drawn from ALL the observations of a group, whichever points are shown: on a log axis
  // an observation ≤ 0 (and with it a whisker, a quartile or a median ≤ 0) cannot be drawn. Every such
  // observation is reported (W_LOG_AXIS_HIDDEN, with its row), never only the ones drawn as points.
  if (yScale === 'log')
    for (const g of groups)
      g.values.forEach((v, k) => {
        if (Number.isFinite(v) && !drawableOn(v, 'log')) tally.hide(g.rowIds[k])
      })
  const traces: BuiltTrace[] = []
  // Colour by group: one box trace per group (same statistics, only the colour changes).
  const byGroup = o.colorByGroup && groupMeta !== undefined
  const colorOf = (g: BoxGroup) => groupAppearance(g.position).color
  if (byGroup) {
    const uids = groupUids(groups.map((g) => g.label))
    groups.forEach((g, k) => {
      const box = boxTrace({
        owner: plot.id,
        groups: [g],
        color: colorOf(g),
        showMean: o.showMean,
        name: g.label,
        group: uids[k],
      })
      if (box) traces.push(box)
    })
  } else {
    const box = boxTrace({ owner: plot.id, groups, color, showMean: o.showMean, name: meta.name })
    if (box) traces.push(box)
  }
  const stats = boxStatsTrace({
    owner: plot.id,
    groups,
    name: meta.name,
    unit: meta.unit,
    t: ctx.t,
    loc: ctx.loc,
  })
  if (stats) traces.push(stats)
  const pts = observationsTrace({
    owner: plot.id,
    role: 'boxPoints',
    datasetId: c.dataset.id,
    view: c.view,
    valueId: meta.id,
    groups,
    include: boxPointFilter(o.points),
    name: meta.name,
    valueName: meta.name,
    unit: meta.unit,
    color,
    ...(byGroup ? { colorOf } : {}),
    size: 6,
    yScale,
    tally,
    t: ctx.t,
    loc: ctx.loc,
  })
  if (pts) traces.push(pts)
  const titles = plotTitles(derived, [], ctx.t)
  const issues: Issue[] = [...smallGroupIssues(groups, meta.id)]
  const yr = axisRange(plot.yAxis.range, yScale)
  if (yr.issue) issues.push(yr.issue)
  const reset = ctx.viewResetCounter
  const groupsText = groups.map((g) => `${g.label}: n = ${g.values.length}`).join(', ')
  return {
    traces,
    issues,
    methods: [ctx.t('figure.caption.box'), ctx.t('figure.caption.boxGroups', { groups: groupsText })],
    x: {
      title: titles.x,
      type: 'linear',
      range: [-0.5, groups.length - 0.5],
      showGrid: false,
      uirevision: axisRevision(plot.id, `box:${o.groupBy ?? ''}`, 'linear', reset),
      tickvals: groups.map((g) => g.position),
      ticktext: groups.map((g) => g.label),
    },
    y: {
      title: titles.y,
      type: yScale,
      range: yr.range,
      showGrid: plot.yAxis.showGrid,
      uirevision: axisRevision(plot.id, `box:${meta.id}`, yScale, reset),
    },
    residual: null,
    counts: { groups: groups.length },
  }
}

function buildBar(
  derived: FigureInput,
  view: Extract<PlotView, { type: 'bar' }>,
  ctx: FigureContext,
): Body | Issue[] {
  const plot = derived.plot!
  const o = view.options
  const c = singleContext(derived, o.datasetId, [o.category, o.value])
  if (!c) return [issue('E_PLOT_NOT_CONFIGURED')]
  const [categoryMeta, valueMeta] = c.metas
  if (kindOf(valueMeta) !== 'numeric')
    return [issue('E_COLUMN_NOT_NUMERIC', { column: valueMeta.name }, { columnId: valueMeta.id })]
  const sample = derived.columnSample(c.dataset.id, [categoryMeta.id, valueMeta.id])
  if (!sample) return [issue('E_PLOT_NOT_CONFIGURED')]
  const issues: Issue[] = []
  linearOnly(derived, issues)
  const res = barTraces({
    owner: plot.id,
    datasetId: c.dataset.id,
    view: c.view,
    options: o,
    valueMeta,
    categoryMeta,
    columnsById: (id) => c.dataset.columns.find((m) => m.id === id),
    sample,
    color: SERIES_COLORS[0],
    colorByCategory: o.colorByCategory,
    markerSize: 7,
    t: ctx.t,
    loc: ctx.loc,
  })
  issues.push(...res.issues)
  if (res.traces.length === 0) {
    if (!issues.some((i) => i.severity === 'error'))
      issues.push(issue('E_HISTOGRAM_NO_DATA', { column: valueMeta.name }, { columnId: valueMeta.id }))
    return issues
  }
  const titles = plotTitles(derived, [], ctx.t)
  const reset = ctx.viewResetCounter
  const methods = [o.aggregate === 'mean' ? ctx.t('figure.caption.barMean') : ctx.t('figure.caption.barNone')]
  if (res.measurementLabel && o.aggregate === 'none')
    methods.push(
      ctx.t('figure.caption.bars', {
        variable: valueMeta.name,
        label: res.measurementLabel,
        source: sourceText(
          o.uncertainty,
          (id) => c.dataset.columns.find((m) => m.id === id)?.name ?? String(id),
          valueMeta.unit,
          ctx.t,
          ctx.loc,
        ),
      }),
    )
  if (res.spreadLabel)
    methods.push(
      ctx.t('figure.caption.bars', {
        variable: valueMeta.name,
        label: res.spreadLabel,
        source: ctx.t('figure.caption.source.groups', { grouping: categoryMeta.name }),
      }),
    )
  return {
    traces: res.traces,
    issues,
    methods,
    x: {
      title: titles.x,
      type: 'linear',
      range: [-0.5, res.ticks.vals.length - 0.5],
      showGrid: false,
      uirevision: axisRevision(plot.id, `bar:${categoryMeta.id}`, 'linear', reset),
      tickvals: res.ticks.vals,
      ticktext: res.ticks.text,
    },
    y: {
      title: titles.y,
      type: 'linear',
      range: linearRange(plot.yAxis, issues),
      showGrid: plot.yAxis.showGrid,
      uirevision: axisRevision(plot.id, `bar:${valueMeta.id}:${o.aggregate}`, 'linear', reset),
    },
    residual: null,
    counts: { bars: res.count },
  }
}

// ---- assembly -----------------------------------------------------------------------------------------

const selectionIds = new WeakMap<Selection, number>()
let selectionCounter = 0

/**
 * selectionrevision: a NEW value for every new Selection object (table or plot) and 'none' without a
 * selection, always with layout.selections = []. Plotly keeps a user-drawn box / lasso outline only
 * while the revision is unchanged, so the store stays authoritative: the selection is shown by the
 * highlighted points, and an outline can never outlive its selection (e.g. cleared from the table).
 * The same Selection object (zoom, pan, re-render) keeps its revision.
 */
function selectionRevision(sel: Selection | null): string {
  if (!sel) return 'none'
  let n = selectionIds.get(sel)
  if (n === undefined) {
    n = ++selectionCounter
    selectionIds.set(sel, n)
  }
  return `${sel.origin}:${n}`
}

function baseLayout(ctx: FigureContext): Partial<Layout> {
  return {
    font: { family: ctx.fontFamily, size: 12, color: NEUTRAL.text },
    paper_bgcolor: NEUTRAL.background,
    plot_bgcolor: NEUTRAL.background,
    separators: separatorsFor(ctx.loc.decimal),
    hovermode: 'closest',
    hoverlabel: {
      bgcolor: NEUTRAL.background,
      bordercolor: NEUTRAL.axis,
      font: { family: ctx.fontFamily, size: 12, color: NEUTRAL.text },
      align: 'left',
    },
    dragmode: ctx.dragmode,
    clickmode: 'event',
  }
}

function emptyFigure(derived: FigureInput, ctx: FigureContext, issues: Issue[]): FigureOut {
  const layout = baseLayout(ctx)
  if (ctx.mode === 'export' && ctx.size)
    Object.assign(layout, { autosize: false, width: ctx.size.width, height: ctx.size.height })
  else layout.autosize = true
  return {
    data: [],
    layout,
    config: plotConfig(ctx.lang),
    selectionMap: buildSelectionMap([]),
    caption: [],
    indicator: derived.plot ? sampleIndicator(derived, ctx) : null,
    issues,
    a11y: ctx.t('figure.a11y.empty'),
  }
}

export function buildFigure(derived: FigureInput, ctx: FigureContext): FigureOut {
  const plot = derived.plot
  const view = derived.plotView
  if (!plot || !view) return emptyFigure(derived, ctx, [issue('E_PLOT_NOT_CONFIGURED')])
  const tally = new LogTally()
  let body: Body | Issue[]
  switch (view.type) {
    case 'scatter':
    case 'line':
      body = buildXY(derived, view, ctx, tally)
      break
    case 'histogram':
      body = buildHistogram(derived, view, ctx)
      break
    case 'box':
      body = buildBox(derived, view, ctx, tally)
      break
    case 'bar':
      body = buildBar(derived, view, ctx)
      break
  }
  if (Array.isArray(body)) return emptyFigure(derived, ctx, body)

  const screen = ctx.mode === 'screen'
  const issues = [...body.issues, ...tally.issues()]
  const markers = body.traces.reduce((n, b) => n + b.markers, 0)
  if (markers > MANY_POINTS) issues.push(issue('W_MANY_POINTS', { count: markers }))

  const selectable = body.traces.filter((b) => b.rowIds)
  const selectionMap = buildSelectionMap(
    selectable.map((b) => ({ uid: b.uid, rowIds: b.rowIds!, members: b.members, datasetId: b.datasetId })),
  )
  const selection = screen ? ctx.selection : null
  for (const b of selectable)
    (b.trace as { selectedpoints?: number[] | null }).selectedpoints = selectedIndicesForTrace(
      b.uid,
      selection,
      selectionMap,
    )

  const indicator = sampleIndicator(derived, ctx)
  const caption = captionLines(derived, ctx, { issues, methods: body.methods })
  const hasResiduals = body.residual !== null
  // 'auto' shows the legend only when it tells something apart (two or more entries): a single series
  // is already named by the y-axis title.
  const legendEntries = body.traces.filter(
    (b) => (b.trace as { showlegend?: boolean }).showlegend !== false,
  ).length
  const legendVisible = plot.legend.visible && (plot.legend.position !== 'auto' || legendEntries > 1)
  // A short pane (any plot) has no height to spare for a legend row above the plot, and Plotly stacks
  // the entries of a titled legend group (a split series, histogram groups) one under the other even in
  // a horizontal legend, which would squeeze the plot: the automatic legend then goes to the right,
  // where Plotly scrolls it when too tall. A narrow pane that is not short (a phone) keeps a grouped
  // legend above: width is what it lacks.
  const grouped = body.traces.some(
    (b) =>
      (b.trace as { showlegend?: boolean }).showlegend !== false &&
      (b.trace as { legendgrouptitle?: unknown }).legendgrouptitle !== undefined,
  )
  const short = screen && ctx.paneHeight !== undefined && ctx.paneHeight < COMPACT_PANE_HEIGHT
  const narrow = screen && ctx.paneWidth !== undefined && ctx.paneWidth < NARROW_PANE_WIDTH
  const legend =
    (short || (grouped && !narrow)) && plot.legend.position === 'auto'
      ? { ...plot.legend, position: 'outside' as const }
      : plot.legend
  const title = plot.title.trim()
  const top = (title ? 36 : 0) + (legendVisible && legend.position === 'auto' ? 28 : 0) + 12
  const reset = ctx.viewResetCounter
  const layout: Partial<Layout> = {
    ...baseLayout(ctx),
    ...(body.extra ?? {}),
    uirevision: `${plot.id}|${plot.type}|${body.x.uirevision}|${body.y.uirevision}|${reset}`,
    showlegend: legendVisible,
    legend: legendLayout(legend, hasResiduals ? (body.y.domain?.[0] ?? MAIN_DOMAIN[0]) : 0),
    // A compact (short-pane) residual panel also gets tighter outer margins.
    margin: body.y.compact
      ? { l: 56, r: 12, t: top, b: 36, pad: 0 }
      : { l: 64, r: 16, t: top, b: 48, pad: 0 },
    xaxis: axisLayout(body.x),
    yaxis: axisLayout(body.y),
    selectionrevision: selectionRevision(selection),
    selections: [],
  }
  if (title)
    layout.title = {
      text: escapePlotText(title),
      x: 0,
      xref: 'paper',
      xanchor: 'left',
      y: 1,
      yref: 'container',
      yanchor: 'top',
      pad: { t: 10 },
      font: { size: 15, color: NEUTRAL.text },
    }
  if (body.residual) {
    layout.xaxis2 = axisLayout(body.residual.x2)
    layout.yaxis2 = axisLayout(body.residual.y2)
    layout.shapes = [residualZeroLine()]
  }
  if (screen) layout.autosize = true
  else {
    const width = ctx.size?.width ?? plot.export.widthPx
    const height = ctx.size?.height ?? plot.export.heightPx
    const margin = layout.margin as { l: number; r: number; b: number }
    const ann = exportAnnotations(
      indicator,
      plot.export.caption ? caption : [],
      ctx,
      width - margin.l - margin.r,
    )
    margin.b = Math.max(margin.b, ann.marginBottom)
    layout.annotations = ann.annotations
    Object.assign(layout, { autosize: false, width, height })
  }

  return {
    data: body.traces.map((b) => b.trace) as Data[],
    layout,
    config: plotConfig(ctx.lang),
    selectionMap,
    caption,
    indicator,
    issues,
    a11y: a11ySummary(derived, ctx, body.counts),
  }
}
