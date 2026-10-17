/**
 * Bar charts. Bars always start at 0 and the value axis is linear only (a log axis has no zero).
 * - aggregate 'mean': one bar per category = mean of its active observations; optional spread bars
 *   SD (n − 1) / SEM / t-CI with n per group in the legend; a single-observation category has no
 *   spread bar (W_GROUP_SINGLE), never a zero-length one; a category of identical values keeps its
 *   zero-length spread bar, reported (I_ZERO_SPREAD). Observations can be overlaid.
 * - aggregate 'none': one bar per active row; repeated categories are refused (E_DUPLICATE_CATEGORY,
 *   "use mean per category"), never silently merged or overplotted.
 * colorByCategory: each category in its own palette colour (by its position), bars and observations
 * alike; the bars stay one trace, so selection and hover are unchanged.
 */
import type { BarData } from 'plotly.js'
import type { AnalysisSample, DatasetView } from '@/domain/derive/types'
import { formatStat, type NumberFormatLocale } from '@/domain/format/number'
import { issue } from '@/domain/model'
import type { BarOptions, ColumnId, ColumnMeta, DatasetId, Issue, RowId } from '@/domain/model'
import { sampleSD, standardError } from '@/domain/stats/descriptive'
import { zeroSpreadIssue } from '@/domain/stats/groups'
import { tCritical } from '@/domain/stats/tCritical'
import { measurementBars } from '@/domain/derive/pipeline'
import { describeUncertainty } from '@/domain/uncertainty/describe'
import { pairCiIssue, semCoveragePct } from '@/domain/uncertainty/resolve'
import type { Translate } from '../context'
import { escapePlotText } from '../escape'
import { anyBar, barText, recordLabel, uncertaintyLabel, valueText } from '../labels'
import { NEUTRAL, groupAppearance, withAlpha } from '../palette'
import { type BuiltTrace, errorBar, traceUid, unitSuffix } from './common'
import { type BoxGroup, boxGroups } from './box'
import { observationsTrace } from './boxPoints'
import { LogTally } from '../logDomain'

export const BAR_WIDTH = 0.6

export interface BarResult {
  traces: BuiltTrace[]
  issues: Issue[]
  /** Category positions and labels (plain text: the layout escapes them). */
  ticks: { vals: number[]; text: string[] }
  /** Meaning of the spread bars of mean bars (plain text), null without spread bars. */
  spreadLabel: string | null
  /**
   * Meaning of the measurement-uncertainty bars of aggregate 'none' (plain text, for the caption with
   * their source); null without bars or when none can be drawn (all missing / refused).
   */
  measurementLabel: string | null
  /** Bars drawn. */
  count: number
}

export function barTraces(input: {
  owner: string
  datasetId: DatasetId
  view: DatasetView
  options: BarOptions
  valueMeta: ColumnMeta
  categoryMeta: ColumnMeta
  columnsById: (id: ColumnId) => ColumnMeta | undefined
  sample: AnalysisSample
  color: string
  colorByCategory?: boolean
  markerSize: number
  t: Translate
  loc: NumberFormatLocale
}): BarResult {
  const { view, options, valueMeta, categoryMeta, t, loc } = input
  const groups = boxGroups(view, valueMeta.id, categoryMeta.id, input.sample, valueMeta.name, loc)
  const ticks = { vals: groups.map((g) => g.position), text: groups.map((g) => g.label) }
  const uid = traceUid(input.owner, 'bar')
  const u = unitSuffix(valueMeta.unit)
  const valueName = escapePlotText(valueMeta.name)
  const issues: Issue[] = []
  const colorOf = (g: BoxGroup) => (input.colorByCategory ? groupAppearance(g.position).color : input.color)
  const marker = input.colorByCategory
    ? { color: groups.map((g) => withAlpha(colorOf(g), 0.8)), line: { color: groups.map(colorOf), width: 1 } }
    : { color: withAlpha(input.color, 0.8), line: { color: input.color, width: 1 } }
  // One error-bar colour per trace: neutral when the bars differ in colour.
  const barColor = input.colorByCategory ? NEUTRAL.text : input.color

  if (options.aggregate === 'none') {
    const dup = groups.filter((g) => g.values.length > 1)
    if (dup.length > 0) {
      issues.push(
        issue(
          'E_DUPLICATE_CATEGORY',
          { count: dup.length, example: dup[0].label, column: categoryMeta.name },
          { columnId: categoryMeta.id, rows: dup.flatMap((g) => g.rowIds) as RowId[] },
        ),
      )
      return { traces: [], issues, ticks, spreadLabel: null, measurementLabel: null, count: 0 }
    }
    const col = view.columns.get(valueMeta.id)!
    const resolved = measurementBars(options.uncertainty, col.values, view, valueMeta, input.columnsById)
    if (resolved) issues.push(...resolved.issues)
    const idx = groups.map((g) => g.idx[0])
    // Only the bars of the drawn categories count: no drawable bar → no error bars, label or caption.
    const bars =
      resolved && anyBar({ status: Uint8Array.from(idx, (i) => resolved.status[i]) }) ? resolved : null
    const label = bars ? uncertaintyLabel(bars.descriptor, t) : null
    const trace: Partial<BarData> = {
      type: 'bar',
      uid,
      name: valueName,
      showlegend: false,
      x: groups.map((g) => g.position),
      y: groups.map((g) => g.values[0]),
      base: 0,
      width: BAR_WIDTH,
      marker,
      customdata: groups.map((g) => [g.rowIds[0]]),
      hovertemplate: groups.map((g, j) => {
        const i = idx[j]
        const bar = bars ? barText(bars.plus[i], bars.minus?.[i] ?? null, loc) : ''
        return (
          `<b>${escapePlotText(g.label)}</b><br>${valueName} = ${escapePlotText(valueText(col, i, loc) + bar)}${u}` +
          (label && bar ? `<br><i>${escapePlotText(label)}</i>` : '') +
          `<br>${escapePlotText(recordLabel(view, g.rowIds[0], t))}<extra></extra>`
        )
      }),
      selected: { marker: { opacity: 1 } },
      unselected: { marker: { opacity: 0.3 } },
    }
    const ey = errorBar(bars, idx, true, barColor)
    if (ey) trace.error_y = ey
    return {
      traces: [
        { trace, uid, rowIds: groups.map((g) => g.rowIds[0]), datasetId: input.datasetId, markers: 0 },
      ],
      issues,
      ticks,
      spreadLabel: null,
      measurementLabel: label,
      count: groups.length,
    }
  }

  // aggregate 'mean'
  const spread = options.spread
  const level = spread.kind === 'ci' ? spread.level : 0.95
  const half = groups.map((g) => spreadOf(g, spread.kind, level))
  const descriptor =
    spread.kind === 'none'
      ? null
      : describeUncertainty(
          spread.kind === 'ci'
            ? { kind: 'ci', grouping: { by: 'column', column: categoryMeta.id }, level, method: 't' }
            : { kind: spread.kind, grouping: { by: 'column', column: categoryMeta.id } },
          { groupN: groups.map((g) => g.values.length) },
        )
  const spreadLabel = descriptor ? uncertaintyLabel(descriptor, t) : null
  if (spread.kind !== 'none') issues.push(...spreadIssues(groups, spread.kind, level))
  const meanLabel = t('style.aggregates.mean')
  const plus = Float64Array.from(half.map((h) => (h === null ? NaN : h)))
  const all = groups.map((_, j) => j)
  const trace: Partial<BarData> = {
    type: 'bar',
    uid,
    name: escapePlotText(spreadLabel ? `${meanLabel}, ${spreadLabel}` : meanLabel),
    showlegend: !!spreadLabel,
    x: groups.map((g) => g.position),
    y: groups.map((g) => g.mean),
    base: 0,
    width: BAR_WIDTH,
    marker,
    hovertemplate: groups.map((g, j) => {
      const sem = g.values.length >= 2 ? standardError(sampleSD(g.values), g.values.length) : null
      const h = half[j]
      return (
        `<b>${escapePlotText(g.label)}</b><br>${valueName}: ${escapePlotText(t('stats.mean'))} = ` +
        `${escapePlotText(formatStat('mean', g.mean, { sem, loc }))}${u}` +
        (spreadLabel && h !== null
          ? `<br>${escapePlotText(spreadLabel)}: ± ${escapePlotText(formatStat('sd', h, { loc }))}${u}`
          : '') +
        `<br>n = ${g.values.length}<extra></extra>`
      )
    }),
    selected: { marker: { opacity: 1 } },
    unselected: { marker: { opacity: 0.3 } },
  }
  if (descriptor) trace.error_y = errorBar({ plus, minus: null }, all, true, NEUTRAL.text)!
  const members = groups.map((g) => [...g.rowIds])
  const traces: BuiltTrace[] = [
    {
      trace,
      uid,
      rowIds: members.map((m) => (m.length === 1 ? m[0] : -1)),
      members,
      datasetId: input.datasetId,
      markers: 0,
    },
  ]
  if (options.showObservations) {
    const obs = observationsTrace({
      owner: input.owner,
      role: 'barPoints',
      datasetId: input.datasetId,
      view,
      valueId: valueMeta.id,
      groups: groups.map((g) => ({ ...g, stats: null })),
      include: () => true,
      name: valueMeta.name,
      valueName: valueMeta.name,
      unit: valueMeta.unit,
      color: input.color,
      ...(input.colorByCategory ? { colorOf } : {}),
      size: Math.max(4, input.markerSize - 2),
      yScale: 'linear',
      tally: new LogTally(),
      t,
      loc,
    })
    if (obs) traces.push(obs)
  }
  return { traces, issues, ticks, spreadLabel, measurementLabel: null, count: groups.length }
}

/** Half-length of the spread bar of one category; null (no bar) for a single observation. */
function spreadOf(g: BoxGroup, kind: 'none' | 'sd' | 'sem' | 'ci', level: 0.9 | 0.95 | 0.99): number | null {
  const n = g.values.length
  if (kind === 'none' || n < 2) return null
  const sd = sampleSD(g.values)
  if (kind === 'sd') return sd
  const sem = standardError(sd, n)
  return kind === 'sem' ? sem : tCritical(level, n - 1) * sem
}

function spreadIssues(
  groups: readonly BoxGroup[],
  kind: 'sd' | 'sem' | 'ci',
  level: 0.9 | 0.95 | 0.99,
): Issue[] {
  const out: Issue[] = []
  const singles = groups.filter((g) => g.values.length === 1)
  if (singles.length > 0)
    out.push(
      issue(
        'W_GROUP_SINGLE',
        { count: singles.length },
        { rows: singles.flatMap((g) => g.rowIds) as RowId[] },
      ),
    )
  const spreads = groups.map((g) => ({
    n: g.values.length,
    sd: g.values.length >= 2 ? sampleSD(g.values) : null,
    rowIds: g.rowIds as RowId[],
  }))
  const zero = zeroSpreadIssue(spreads)
  if (zero) out.push(zero)
  if (kind === 'ci') {
    // A pair of identical values has a zero-width interval, not a very wide one (I_ZERO_SPREAD says why).
    const pairs = groups.filter((g, j) => g.values.length === 2 && spreads[j]!.sd !== 0)
    if (pairs.length > 0)
      out.push(pairCiIssue(pairs.length, level, pairs.flatMap((g) => g.rowIds) as RowId[]))
  }
  if (kind === 'sem') {
    const small = [...new Set(groups.map((g) => g.values.length).filter((m) => m >= 2 && m <= 5))].sort(
      (a, b) => a - b,
    )
    for (const m of small) out.push(issue('I_SEM_COVERAGE', { coverage: semCoveragePct(m), n: m }))
  }
  return out
}
