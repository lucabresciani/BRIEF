/**
 * What a figure must state about itself: the sample indicator ("n = 9 of 10 ·
 * 1 excluded · linear fit"), always present when rows are excluded / filtered or a fit is shown, and
 * the caption: the equation with PDG-formatted parameters (± standard error), R², n, the meaning of
 * every error bar, the "pointwise" bands, exclusions with their reasons, filters and figure-only
 * effects (log axes, extrapolation). Plain text; escaped when placed into Plotly annotations.
 */
import type { DerivedGroup, DerivedSeries } from '@/domain/derive/pipeline'
import { blockOf, recordPosition } from '@/domain/derive/recordPosition'
import type { AnalysisSample, DatasetView, ErrorBarArrays, FitOk, FitParameter } from '@/domain/derive/types'
import {
  formatFull,
  formatInterval,
  formatNumber,
  formatR2,
  formatWithUncertainty,
  type NumberFormatLocale,
} from '@/domain/format/number'
import type { ColumnId, DatasetId, Issue, PlotSpec, UncertaintySpec } from '@/domain/model'
import { describeUncertainty } from '@/domain/uncertainty/describe'
import type { FigureContext, FigureInput, Translate } from './context'
import { groupLabel } from './groups'
import { anyBar, figureSeriesLabels, modelLabel, uncertaintyLabel } from './labels'

/** Series drawn in the figure: hidden series are omitted from exports and from these texts. */
export function shownSeries(derived: FigureInput): DerivedSeries[] {
  return derived.series.filter((s) => s.spec.visible)
}

/**
 * The residual panel is asked for (scatter and line plots): the export option when exporting, the
 * panel switch on screen. It is drawn when, in addition, a shown series has an ok fit with residuals on.
 */
export function residualPanelRequested(plot: PlotSpec | null, mode: FigureContext['mode']): boolean {
  if (!plot || (plot.type !== 'scatter' && plot.type !== 'line')) return false
  return mode === 'export' ? plot.export.includeResiduals : plot.scatter.residualPanel
}

/**
 * A fit is shown when it succeeded and something drawn comes from it: its curve, a band, or its
 * residuals in the residual panel. The figure then always states the model, n and the equation.
 */
export function fitShown(
  s: DerivedSeries,
  derived: FigureInput,
  mode: FigureContext['mode'],
): s is DerivedSeries & { fit: FitOk } {
  const show = s.fitSpec?.show
  if (s.fit?.status !== 'ok' || !show) return false
  if (show.curve || show.confidenceBand || show.predictionBand) return true
  return show.residuals && residualPanelRequested(derived.plot, mode)
}

/** Something drawn comes from the series' fits: its curve, a band, or (asked for) its residuals. */
function fitDrawn(s: DerivedSeries, derived: FigureInput, mode: FigureContext['mode']): boolean {
  const show = s.fitSpec?.show
  if (!show) return false
  if (show.curve || show.confidenceBand || show.predictionBand) return true
  return show.residuals && residualPanelRequested(derived.plot, mode)
}

/**
 * The groups of a series fitted per group (FitSpec.perGroup on a split series), failed fits included,
 * when something of those fits is drawn: at least one group fit succeeded and the curve, a band or the
 * residuals are shown. Else [] (like a single fit that failed, nothing is said about it).
 */
export function groupFits(
  s: DerivedSeries,
  derived: FigureInput,
  mode: FigureContext['mode'],
): readonly DerivedGroup[] {
  if (!s.split || s.fitSpec?.perGroup !== true || !fitDrawn(s, derived, mode)) return []
  return s.split.groups.some((g) => g.fit?.status === 'ok') ? s.split.groups : []
}

/** "A: n = 12, B: n = 11": the analysed rows of each group of a split series. */
export function groupCounts(s: DerivedSeries, t: Translate): string {
  return (s.split?.groups ?? []).map((g) => `${groupLabel(g, t)}: n = ${g.sample.nActive}`).join(', ')
}

/**
 * The replicate bars a split series draws (each group's own), as one: present when any group has a bar,
 * labelled with the n of every group.
 */
function splitReplicateBars(s: DerivedSeries): Pick<ErrorBarArrays, 'status' | 'descriptor'> | null {
  const spec = s.spec.errorBars.y
  const reps = (s.split?.groups ?? []).flatMap((g) => (g.replicate ? [g.replicate] : []))
  if (reps.length === 0 || !(spec.kind === 'sd' || spec.kind === 'sem' || spec.kind === 'ci')) return null
  const status = Uint8Array.from(reps.flatMap((r) => [...r.bars.status]))
  const groupN = reps.flatMap((r) => r.groups.map((g) => g.n))
  return { status, descriptor: describeUncertainty(spec, { groupN }) }
}

/** Columns whose sample the histogram / box / bar plot uses (null when the plot is not configured). */
export function singleSample(derived: FigureInput): { datasetId: DatasetId; sample: AnalysisSample } | null {
  const plot = derived.plot
  if (!plot) return null
  let datasetId: DatasetId | null = null
  let cols: ColumnId[] = []
  if (plot.type === 'histogram') {
    datasetId = plot.histogram.datasetId
    cols = plot.histogram.value ? [plot.histogram.value] : []
  } else if (plot.type === 'box') {
    datasetId = plot.box.datasetId
    cols = plot.box.value ? [plot.box.value, ...(plot.box.groupBy ? [plot.box.groupBy] : [])] : []
  } else if (plot.type === 'bar') {
    datasetId = plot.bar.datasetId
    cols = plot.bar.value && plot.bar.category ? [plot.bar.category, plot.bar.value] : []
  }
  if (!datasetId || cols.length === 0) return null
  const ds = derived.doc.datasets.find((d) => d.id === datasetId)
  if (!ds || !cols.every((c) => ds.columns.some((m) => m.id === c))) return null
  const sample = derived.columnSample(datasetId, cols)
  return sample ? { datasetId, sample } : null
}

function sampleParts(sample: AnalysisSample, t: Translate): string[] {
  const c = sample.counts
  const parts = [t('figure.indicator.n', { n: sample.nActive, total: sample.nTotal })]
  if (c.excluded > 0) parts.push(t('figure.indicator.excluded', { n: c.excluded }))
  if (c.filtered > 0) parts.push(t('figure.indicator.filtered', { n: c.filtered }))
  if (c.missing + c.invalid > 0) parts.push(t('figure.indicator.missing', { n: c.missing + c.invalid }))
  return parts
}

/**
 * "n = 9 of 10, 1 excluded, linear fit" (one segment per shown series when there are several).
 * null when no row is excluded or filtered and no fit is shown.
 */
export function sampleIndicator(derived: FigureInput, ctx: FigureContext): string | null {
  const { t } = ctx
  const plot = derived.plot
  if (!plot) return null
  if (plot.type === 'scatter' || plot.type === 'line') {
    const shown = shownSeries(derived)
    const perGroup = (s: DerivedSeries) => groupFits(s, derived, ctx.mode).length > 0
    const trigger = shown.some(
      (s) =>
        s.data.sample.counts.excluded + s.data.sample.counts.filtered > 0 ||
        fitShown(s, derived, ctx.mode) ||
        perGroup(s),
    )
    if (!trigger) return null
    const labels = figureSeriesLabels(derived, t)
    return shown
      .map((s) => {
        const parts = sampleParts(s.data.sample, t)
        if (s.split) parts.push(t('figure.indicator.groups', { count: s.split.groups.length }))
        if (fitShown(s, derived, ctx.mode))
          parts.push(t('figure.indicator.fit', { model: modelLabel(s.fit.model, t) }))
        else if (perGroup(s) && s.fitSpec)
          parts.push(t('figure.indicator.fitEachGroup', { model: modelLabel(s.fitSpec.model, t) }))
        return (shown.length > 1 ? `${labels.get(s.spec.id) ?? s.yColumn.name}: ` : '') + parts.join(', ')
      })
      .join('; ')
  }
  const single = singleSample(derived)
  if (!single) return null
  const { counts } = single.sample
  if (counts.excluded + counts.filtered === 0) return null
  return sampleParts(single.sample, t).join(' · ')
}

// ---- equations -------------------------------------------------------------------------------------

const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹'
const sup = (k: number) =>
  String(k)
    .split('')
    .map((d) => SUP[Number(d)])
    .join('')

/**
 * The variable of a centred equation, "(t − 0.3)". x0 is a round number chosen by the domain, so it is
 * shown exactly ("0.3", "2005"); a negative centre reads "(x + 1.5)", never "(x − −1.5)".
 */
export function centredVariable(xName: string, x0: number, loc: NumberFormatLocale): string {
  return `(${xName} ${x0 < 0 ? '+' : '−'} ${formatFull(Math.abs(x0), loc)})`
}

/** Symbolic equation in the form the parameters are reported: "V = b₀ + b₁·I", "y = a·e^(b·t)". */
export function equationText(fit: FitOk, xName: string, yName: string, loc: NumberFormatLocale): string {
  if (fit.model.type === 'exponential') return `${yName} = a·e^(b·${xName})`
  if (fit.model.type === 'power') return `${yName} = a·${xName}^b`
  const eq = fit.equation
  const X = eq.form === 'centred' && eq.x0 !== null ? centredVariable(xName, eq.x0, loc) : xName
  const terms = eq.terms.map(({ coef, power }) =>
    power === 0 ? coef.symbol : power === 1 ? `${coef.symbol}·${X}` : `${coef.symbol}·${X}${sup(power)}`,
  )
  return `${yName} = ${terms.join(' + ')}`
}

/** "b₁ = (47.15 ± 0.08) V/A" (± 1 SE, PDG rounding); asymmetric CI for a of log-linear models. */
export function parameterText(p: FitParameter, loc: NumberFormatLocale): string {
  const unit = p.unit ? ` ${p.unit}` : ''
  if (p.note === 'asymmetric-ci' && p.ci)
    return `${p.symbol} = ${formatInterval(p.value, p.ci[0], p.ci[1], loc).text}${unit}`
  if (p.se !== null && p.se > 0 && Number.isFinite(p.se)) {
    const f = formatWithUncertainty(p.value, p.se, loc)
    return `${p.symbol} = ${unit && f.sharedExponent === null ? `(${f.text})` : f.text}${unit}`
  }
  return `${p.symbol} = ${formatNumber(p.value, { sig: 6, loc })}${unit}`
}

/** The parameters in the form of the shown equation (centred coefficients when centred). */
export function reportedParameters(fit: FitOk): readonly FitParameter[] {
  if (fit.model.type === 'exponential' || fit.model.type === 'power') return fit.params
  return fit.equation.terms.map((term) => term.coef)
}

// ---- caption ---------------------------------------------------------------------------------------

/** Where the bar half-lengths come from ("same value for every point: 0.002 m", "column u(y)"…). */
export function sourceText(
  spec: UncertaintySpec,
  colName: (id: ColumnId) => string,
  unit: string | null,
  t: Translate,
  loc: NumberFormatLocale,
): string {
  switch (spec.kind) {
    case 'none':
      return ''
    case 'measurement': {
      const src = spec.source
      if (src.type === 'absolute')
        return t('figure.caption.source.absolute', {
          value: `${formatFull(src.value, loc)}${unit ? ` ${unit}` : ''}`,
        })
      if (src.type === 'percent')
        return t('figure.caption.source.percent', { percent: formatFull(src.percent, loc) })
      if (src.type === 'column') return t('figure.caption.source.column', { column: colName(src.column) })
      return t('figure.caption.source.columnAsymmetric', {
        plus: colName(src.plus),
        minus: colName(src.minus),
      })
    }
    default:
      return t('figure.caption.source.groups', {
        grouping: spec.grouping.by === 'sameX' ? t('uncertainty.groupSameX') : colName(spec.grouping.column),
      })
  }
}

const MAX_LISTED_ROWS = 12

/** Source positions of the rows as in the file ("3, 7"), or the sheet columns of a transposed block ("D, F"). */
function sourceRows(view: DatasetView, rowIds: readonly number[]): string {
  const positions = rowIds
    .map((r) => view.rowIndex.get(r))
    .filter((i): i is number => i !== undefined)
    .map((i) => recordPosition(view, i))
    .sort((a, b) => a.index - b.index)
  const shown = positions
    .slice(0, MAX_LISTED_ROWS)
    .map((p) => p.text)
    .join(', ')
  return positions.length > MAX_LISTED_ROWS ? `${shown}, …` : shown
}

/**
 * The records of a dataset stacked from several tables, where every table has its own row 5: per table,
 * in dataset order ("oak plank 1 · rows 4, 5; pine plank 1 · row 4"); '' for none.
 */
function blockRecords(view: DatasetView, rowIds: readonly number[], t: Translate): string {
  const blocks = view.recordBlocks ?? []
  const found = rowIds
    .map((r) => ({ r, i: view.rowIndex.get(r) }))
    .filter((x): x is { r: number; i: number } => x.i !== undefined)
    .sort((a, b) => a.i - b.i)
  const groups: { block: string; texts: string[] }[] = []
  for (const { r, i } of found.slice(0, MAX_LISTED_ROWS)) {
    const block = blockOf(blocks, r) ?? ''
    const last = groups[groups.length - 1]
    const text = recordPosition(view, i).text
    if (last && last.block === block) last.texts.push(text)
    else groups.push({ block, texts: [text] })
  }
  const text = groups
    .map((g) =>
      t('table.blockRecords', {
        block: g.block,
        axis: view.recordAxis,
        count: g.texts.length,
        list: g.texts.join(', '),
      }),
    )
    .join('; ')
  return found.length > MAX_LISTED_ROWS ? `${text}, …` : text
}

/** Exclusions (rows shown as in the file, reason, note) and enabled filters of a dataset. */
function sampleLines(
  derived: FigureInput,
  datasetId: DatasetId,
  prefix: string,
  ctx: FigureContext,
): string[] {
  const { t, loc } = ctx
  const view = derived.views.get(datasetId)
  const ds = derived.doc.datasets.find((d) => d.id === datasetId)
  if (!view || !ds) return []
  const out: string[] = []
  for (const e of derived.doc.exclusions) {
    if (e.datasetId !== datasetId) continue
    const stacked = (view.recordBlocks?.length ?? 0) > 0
    const rows = stacked ? blockRecords(view, e.rowIds, t) : sourceRows(view, e.rowIds)
    if (!rows) continue
    const reason = t(`exclusion.reasons.${e.reason}`)
    const note = e.note.trim()
    const why = note ? `${reason}: ${note}` : reason
    out.push(
      prefix +
        (stacked
          ? t('figure.caption.excludedRecords', { records: rows, reason: why })
          : view.recordAxis === 'column'
            ? t('figure.caption.excludedColumns', { columns: rows, reason: why })
            : t('figure.caption.excluded', { rows, reason: why })),
    )
  }
  for (const f of derived.doc.filters) {
    if (f.datasetId !== datasetId || !f.enabled) continue
    const column = ds.columns.find((c) => c.id === f.column)?.name ?? String(f.column)
    if (f.type === 'range')
      out.push(
        prefix +
          t('figure.caption.filterRange', {
            column,
            min: f.min === null ? '−∞' : formatFull(f.min, loc),
            max: f.max === null ? '∞' : formatFull(f.max, loc),
          }),
      )
    else out.push(prefix + t('figure.caption.filterCategory', { column, keep: f.keep.join(', ') }))
  }
  return out
}

/**
 * Caption lines. `figure` (from buildFigure) adds the figure-level notes: issues (log axes,
 * extrapolation) and method lines of histogram / box / bar plots.
 */
export function captionLines(
  derived: FigureInput,
  ctx: FigureContext,
  figure?: { issues?: readonly Issue[]; methods?: readonly string[] },
): string[] {
  const { t, loc } = ctx
  const plot = derived.plot
  if (!plot) return []
  const out: string[] = []
  if (plot.type === 'scatter' || plot.type === 'line') {
    const shown = shownSeries(derived)
    const multi = shown.length > 1
    const labels = figureSeriesLabels(derived, t)
    let anyFit = false
    let anyBars = false
    for (const s of shown) {
      const prefix = multi ? `${labels.get(s.spec.id) ?? s.yColumn.name}: ` : ''
      const columns = derived.doc.datasets.find((d) => d.id === s.spec.datasetId)?.columns ?? []
      const colName = (id: ColumnId) => columns.find((c) => c.id === id)?.name ?? String(id)
      if (s.split)
        out.push(
          prefix + t('figure.caption.split', { column: s.split.column.name, groups: groupCounts(s, t) }),
        )
      if (fitShown(s, derived, ctx.mode)) {
        anyFit = true
        out.push(...fitLines(s, s.fit, prefix, ctx))
      }
      // A fit per group: each group's equation, or the plain statement that it could not be fitted.
      // The method notes (bands, ln y) are the same for every group: stated once.
      const notes = new Set<string>()
      for (const g of groupFits(s, derived, ctx.mode)) {
        const name = multi
          ? `${labels.get(s.spec.id) ?? s.yColumn.name} · ${groupLabel(g, t)}`
          : groupLabel(g, t)
        if (g.fit?.status !== 'ok') {
          out.push(t('figure.caption.groupNoFit', { group: name }))
          continue
        }
        anyFit = true
        const level = Math.round(g.fit.provenance.confidence * 100)
        const shared = new Set([
          t('figure.caption.band.confidence', { level }),
          t('figure.caption.band.prediction', { level }),
          t('fit.logNote'),
        ])
        for (const line of fitLines(s, g.fit, `${name}: `, ctx)) {
          const note = shared.has(line)
          if (note && notes.has(line)) continue
          if (note) notes.add(line)
          out.push(line)
        }
      }
      if (s.spec.errorBars.visible) {
        const yb = s.yBars ?? (s.split ? splitReplicateBars(s) : (s.replicate?.bars ?? null))
        const bars: [typeof yb, UncertaintySpec, string, string | null][] = [
          [yb, s.spec.errorBars.y, s.yColumn.name, s.yColumn.unit],
          [s.xBars, s.spec.errorBars.x, s.xColumn.name, s.xColumn.unit],
        ]
        for (const [b, spec, variable, unit] of bars) {
          // Bars that are all missing or refused (e.g. E_DERIVED_UNCERTAINTY) draw nothing: not described.
          if (!b || !anyBar(b)) continue
          anyBars = true
          out.push(
            prefix +
              t('figure.caption.bars', {
                variable,
                label: uncertaintyLabel(b.descriptor, t),
                source: sourceText(spec, colName, unit, t, loc),
              }),
          )
        }
      }
    }
    if (anyFit && anyBars) out.push(t('fit.unweighted'))
    if (figure?.methods) out.push(...figure.methods)
    const datasets = [...new Set(shown.map((s) => s.spec.datasetId))]
    for (const id of datasets) {
      const name = derived.doc.datasets.find((d) => d.id === id)?.name ?? ''
      out.push(...sampleLines(derived, id, datasets.length > 1 ? `${name}: ` : '', ctx))
    }
  } else {
    if (figure?.methods) out.push(...figure.methods)
    const single = singleSample(derived)
    if (single) out.push(...sampleLines(derived, single.datasetId, '', ctx))
  }
  for (const i of figure?.issues ?? []) {
    if (i.code === 'W_LOG_AXIS_HIDDEN')
      out.push(t('figure.caption.logHidden', { count: i.params?.count ?? 0 }))
    if (i.code === 'W_LOG_AXIS_BARS_CLIPPED')
      out.push(t('figure.caption.barsClipped', { count: i.params?.count ?? 0 }))
  }
  // One line per pattern the extrapolated parts are drawn with ("Dotted curve: extrapolation…"). With
  // several series it names the series drawn so: another series may draw its data line in that pattern.
  const extrapolated = new Map<string | number, Set<string>>()
  for (const i of figure?.issues ?? []) {
    const pattern = i.params?.pattern
    if (i.code !== 'W_EXTRAPOLATION' || pattern === undefined) continue
    const names = extrapolated.get(pattern) ?? new Set<string>()
    names.add(String(i.params?.series ?? ''))
    extrapolated.set(pattern, names)
  }
  const severalShown = (plot.type === 'scatter' || plot.type === 'line') && shownSeries(derived).length > 1
  for (const [pattern, names] of extrapolated)
    out.push(
      (severalShown ? `${[...names].join(', ')}: ` : '') + t('figure.caption.extrapolation', { pattern }),
    )
  return out
}

/** Equation, parameters (± 1 SE), goodness of fit and the notes the reader needs to read them. */
function fitLines(s: DerivedSeries, fit: FitOk, prefix: string, ctx: FigureContext): string[] {
  const { t, loc } = ctx
  const out: string[] = []
  const level = Math.round(fit.provenance.confidence * 100)
  out.push(
    prefix +
      t('figure.caption.fit', {
        model: modelLabel(fit.model, t),
        equation: equationText(fit, s.xColumn.name, s.yColumn.name, loc),
      }),
  )
  out.push(
    t('figure.caption.parameters', {
      list: reportedParameters(fit)
        .map((p) => parameterText(p, loc))
        .join('; '),
    }),
  )
  const r2 = formatR2(fit.r2, loc, ctx.advanced)
  const r2Label = fit.r2Of === 'lnY' ? t('fit.r2LnY') : 'R²'
  const sUnit = fit.r2Of === 'lnY' || !s.yColumn.unit ? '' : ` ${s.yColumn.unit}`
  out.push(
    t('figure.caption.goodness', {
      r2: r2.startsWith('>') ? `${r2Label} ${r2}` : `${r2Label} = ${r2}`,
      n: fit.provenance.nUsed,
      df: fit.df,
      s: fit.exactFit ? t('common.notAvailable') : `${formatNumber(fit.s, { sig: 2, loc })}${sUnit}`,
    }).replace(/\.\.$/, '.'), // "n.d." already ends the sentence: never "n.d.."
  )
  if (fit.exactFit) out.push(t('fit.exactFitNote'))
  if (fit.r2Of === 'lnY') out.push(t('fit.logNote'))
  if (s.replicate) out.push(t('uncertainty.groupMeansNote', { n: fit.provenance.nUsed }))
  const show = s.fitSpec?.show
  if (show?.confidenceBand && !fit.exactFit) out.push(t('figure.caption.band.confidence', { level }))
  if (show?.predictionBand && !fit.exactFit) out.push(t('figure.caption.band.prediction', { level }))
  return out
}
