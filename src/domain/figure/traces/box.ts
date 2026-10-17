/**
 * Box plots from OUR statistics (stats/quantile.ts, the same numbers as the statistics panel):
 * q1 / median / q3 of type 7 and whiskers = ADJACENT VALUES (most extreme observations inside the Tukey
 * fences Q1 − 1.5·IQR, Q3 + 1.5·IQR). Plotly's own box statistics (type-5 quartiles, population SD)
 * are never used: the precomputed signature is passed with lowerfence/upperfence = the whiskers, which
 * Plotly draws as given, and boxpoints false (observations are a separate scatter, boxPoints.ts).
 * Plotly's box hover calls the whisker ends "fences", which contradicts the panel, so the box itself
 * has no hover; an invisible marker at each median carries the statistics with the panel's terms.
 */
import type { BoxData } from 'plotly.js'
import type { AnalysisSample, DatasetView } from '@/domain/derive/types'
import { decimalsOfText, formatStat, type NumberFormatLocale } from '@/domain/format/number'
import { INACTIVE, issue } from '@/domain/model'
import type { ColumnId, Issue, RowId } from '@/domain/model'
import { mean } from '@/domain/stats/descriptive'
import { type TukeyStats, sortedCopy, tukey } from '@/domain/stats/quantile'
import type { Translate } from '../context'
import { escapePlotText } from '../escape'
import { cleanNumber, valueText } from '../labels'
import { withAlpha } from '../palette'
import { type BuiltTrace, type ScatterTrace, traceUid, unitSuffix } from './common'

export const BOX_WIDTH = 0.5

export interface BoxGroup {
  /** Group label (plain text); the value column name when there is no grouping. */
  label: string
  position: number
  /** Indices into the view rows, in view order. */
  idx: number[]
  values: number[]
  /** The values as recorded (valueText): whiskers are observations and are shown as written. */
  texts: string[]
  rowIds: number[]
  stats: TukeyStats | null
  mean: number
  /** Decimals of the recorded values (quartiles are shown with one more). */
  dataDecimals: number
}

/**
 * Groups the ACTIVE rows (sample over the value and group columns) with a finite value. Group order:
 * first appearance for labels, ascending for numeric keys. Rows without a group are already inactive
 * (missing in the sample).
 */
export function boxGroups(
  view: DatasetView,
  valueId: ColumnId,
  groupId: ColumnId | null,
  sample: AnalysisSample,
  ungroupedLabel: string,
  loc: NumberFormatLocale,
): BoxGroup[] {
  const col = view.columns.get(valueId)
  if (!col) return []
  const g = groupId ? view.columns.get(groupId) : undefined
  const buckets = new Map<string | number, { label: string; idx: number[] }>()
  const numeric = !!g && !g.categories && g.settings.kind === 'numeric'
  for (let i = 0; i < view.rowIds.length; i++) {
    if (sample.reason[i] !== INACTIVE.active || !Number.isFinite(col.values[i])) continue
    let key: string | number
    let label: string
    if (!g) {
      key = ''
      label = ungroupedLabel
    } else if (g.categories) {
      const code = g.categories.codes[i]
      if (code < 0) continue
      key = g.categories.labels[code]
      label = key
    } else if (numeric) {
      const v = g.values[i]
      if (!Number.isFinite(v)) continue
      key = v === 0 ? 0 : v
      label = cleanNumber(v, loc)
    } else {
      label = (g.text[i] ?? '').trim()
      if (!label) continue
      key = label
    }
    let b = buckets.get(key)
    if (!b) {
      b = { label, idx: [] }
      buckets.set(key, b)
    }
    b.idx.push(i)
  }
  const entries = [...buckets.entries()]
  if (numeric) entries.sort((a, b) => (a[0] as number) - (b[0] as number))
  return entries.map(([, b], position) => {
    const values = b.idx.map((i) => col.values[i])
    let dataDecimals = 0
    for (const i of b.idx) dataDecimals = Math.max(dataDecimals, decimalsOfText(col.text[i] ?? ''))
    return {
      label: b.label,
      position,
      idx: b.idx,
      values,
      texts: b.idx.map((i) => valueText(col, i, loc)),
      rowIds: b.idx.map((i) => view.rowIds[i]),
      stats: tukey(sortedCopy(values)),
      mean: mean(values),
      dataDecimals,
    }
  })
}

/** I_QUARTILES_NEED_4 for groups too small for a box (their observations are still drawn). */
export function smallGroupIssues(groups: readonly BoxGroup[], columnId: ColumnId): Issue[] {
  return groups
    .filter((g) => g.stats === null)
    .map((g) =>
      issue(
        'I_QUARTILES_NEED_4',
        { n: g.values.length, group: g.label },
        { columnId, rows: g.rowIds as RowId[] },
      ),
    )
}

/** `group`: the uid part of a box drawn for one group alone (colour by group). */
export function boxTrace(input: {
  owner: string
  groups: readonly BoxGroup[]
  color: string
  showMean: boolean
  name: string
  group?: string
}): BuiltTrace | null {
  const withBox = input.groups.filter((g) => g.stats !== null)
  if (withBox.length === 0) return null
  const uid = traceUid(input.owner, 'box', input.group)
  const trace: Partial<BoxData> = {
    type: 'box',
    uid,
    name: escapePlotText(input.name),
    showlegend: false,
    x: withBox.map((g) => g.position),
    q1: withBox.map((g) => g.stats!.q1),
    median: withBox.map((g) => g.stats!.median),
    q3: withBox.map((g) => g.stats!.q3),
    lowerfence: withBox.map((g) => g.stats!.whiskers[0]),
    upperfence: withBox.map((g) => g.stats!.whiskers[1]),
    boxpoints: false,
    width: BOX_WIDTH,
    line: { color: input.color, width: 1.5 },
    fillcolor: withAlpha(input.color, 0.12),
    hoverinfo: 'skip',
  }
  if (input.showMean) {
    trace.mean = withBox.map((g) => g.mean)
    trace.boxmean = true
  }
  return { trace, uid, markers: 0 }
}

/** Invisible markers at the medians whose hover lists the box statistics in the panel's terms. */
export function boxStatsTrace(input: {
  owner: string
  groups: readonly BoxGroup[]
  name: string
  unit: string | null
  t: Translate
  loc: NumberFormatLocale
}): BuiltTrace | null {
  const { t, loc } = input
  const withBox = input.groups.filter((g) => g.stats !== null)
  if (withBox.length === 0) return null
  const u = unitSuffix(input.unit)
  // A whisker end is an observation: written as recorded ("1.70", like min and max in the panel).
  const observed = (g: BoxGroup, v: number) =>
    escapePlotText(g.texts[g.values.indexOf(v)] ?? cleanNumber(v, loc))
  // Same interval notation as the statistics panel: [low; high].
  const hovertemplate = withBox.map((g) => {
    const s = g.stats!
    const q = (v: number) => escapePlotText(formatStat('quartile', v, { dataDecimals: g.dataDecimals, loc }))
    const lines = [
      `<b>${escapePlotText(g.label)}</b>`,
      `n = ${g.values.length}`,
      `${escapePlotText(t('stats.median'))} = ${q(s.median)}${u}`,
      `${escapePlotText(t('stats.q1'))} = ${q(s.q1)}${u}`,
      `${escapePlotText(t('stats.q3'))} = ${q(s.q3)}${u}`,
      `${escapePlotText(t('figure.hover.whiskers'))} = [${observed(g, s.whiskers[0])}; ${observed(g, s.whiskers[1])}]${u}`,
      `${escapePlotText(t('stats.fences'))} = [${q(s.fences[0])}; ${q(s.fences[1])}]${u}`,
    ]
    return `${lines.join('<br>')}<extra></extra>`
  })
  const uid = traceUid(input.owner, 'boxStats')
  const trace: ScatterTrace = {
    type: 'scatter',
    uid,
    name: escapePlotText(input.name),
    showlegend: false,
    mode: 'markers',
    x: withBox.map((g) => g.position),
    y: withBox.map((g) => g.stats!.median),
    marker: { size: 18, opacity: 0, color: '#000000' },
    hovertemplate,
  }
  return { trace, uid, markers: 0 }
}
