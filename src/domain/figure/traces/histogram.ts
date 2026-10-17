/**
 * Histogram drawn as a `bar` trace from OUR bin counts (stats/histogram.ts): x = bin centres,
 * width = bin widths, y = counts. Never Plotly's own binning (xbins / nbinsx), which drops a maximum
 * lying on the last edge and treats the bin count as a mere upper limit. Bins are [a, b) and the last
 * one [a, b], so Σ counts = n. Each bar stands for its member rows (selection).
 * With groupBy, the bins are computed ONCE over every value and each group counts its own members of
 * those bins: every group shares the same edges, and the group counts add up to the pooled counts.
 */
import type { BarData } from 'plotly.js'
import type { NumberFormatLocale } from '@/domain/format/number'
import type { DatasetId, HistogramOptions } from '@/domain/model'
import { type HistogramResult, histogram } from '@/domain/stats/histogram'
import type { Translate } from '../context'
import { escapePlotText } from '../escape'
import { cleanNumber } from '../labels'
import { SERIES_COLORS, groupAppearance, withAlpha } from '../palette'
import { type BuiltTrace, traceUid, unitSuffix } from './common'

/** "[a, b)" — or "[a, b]" for the last bin; ";" separates the bounds when the decimal mark is ",". */
export function binInterval(lo: number, hi: number, last: boolean, loc: NumberFormatLocale): string {
  const sep = loc.decimal === ',' ? ';' : ','
  return `[${cleanNumber(lo, loc)}${sep} ${cleanNumber(hi, loc)}${last ? ']' : ')'}`
}

export function histogramTrace(input: {
  owner: string
  datasetId: DatasetId
  name: string
  unit: string | null
  values: readonly number[]
  rowIds: readonly number[]
  bins: HistogramOptions['bins']
  t: Translate
  loc: NumberFormatLocale
}): { built: BuiltTrace; result: HistogramResult } {
  const result = histogram(input.values, input.rowIds, input.bins)
  const { edges, counts, members } = result
  const k = counts.length
  const centres: number[] = []
  const widths: number[] = []
  const hovertemplate: string[] = []
  for (let j = 0; j < k; j++) {
    centres.push((edges[j] + edges[j + 1]) / 2)
    widths.push(edges[j + 1] - edges[j])
    hovertemplate.push(
      `<b>${escapePlotText(input.name)}</b> ${escapePlotText(binInterval(edges[j], edges[j + 1], j === k - 1, input.loc))}${unitSuffix(input.unit)}` +
        `<br>${escapePlotText(input.t('figure.hover.count', { count: counts[j] }))}<extra></extra>`,
    )
  }
  const color = SERIES_COLORS[0]
  const uid = traceUid(input.owner, 'histogram')
  const trace: Partial<BarData> = {
    type: 'bar',
    uid,
    name: escapePlotText(input.name),
    showlegend: false,
    x: centres,
    y: [...counts],
    width: widths,
    base: 0,
    hovertemplate,
    marker: { color: withAlpha(color, 0.75), line: { color: '#ffffff', width: 1 } },
    selected: { marker: { opacity: 1 } },
    unselected: { marker: { opacity: 0.3 } },
  }
  const memberRows = members.map((m) => [...m])
  return {
    built: {
      trace,
      uid,
      rowIds: memberRows.map((m) => (m.length === 1 ? m[0] : -1)),
      members: memberRows,
      datasetId: input.datasetId,
      markers: 0,
    },
    result,
  }
}

export interface HistogramGroup {
  /** Plain-text label ("(no value)" already translated). */
  label: string
  uid: string
  /** Rank in the column's group order (colour). */
  rank: number
}

/**
 * One bar trace per group on the bins of all the values (see the module comment). `groupOf[k]` is the
 * index into `groups` of value k. overlay: translucent bars drawn over each other with an opaque
 * outline, so every group's shape stays readable; stack: bars stacked from zero.
 */
export function histogramGroupTraces(input: {
  owner: string
  datasetId: DatasetId
  name: string
  unit: string | null
  /** Legend title: the column the values are grouped by. */
  groupName: string
  values: readonly number[]
  rowIds: readonly number[]
  groupOf: readonly number[]
  groups: readonly HistogramGroup[]
  mode: HistogramOptions['groupMode']
  bins: HistogramOptions['bins']
  t: Translate
  loc: NumberFormatLocale
}): { built: BuiltTrace[]; result: HistogramResult; n: number[] } {
  const result = histogram(input.values, input.rowIds, input.bins)
  const { edges, members } = result
  const k = members.length
  const groupOfRow = new Map<number, number>()
  input.rowIds.forEach((r, j) => groupOfRow.set(r, input.groupOf[j]))
  const centres: number[] = []
  const widths: number[] = []
  for (let j = 0; j < k; j++) {
    centres.push((edges[j] + edges[j + 1]) / 2)
    widths.push(edges[j + 1] - edges[j])
  }
  const n = input.groups.map(() => 0)
  const built = input.groups.map((g, gi) => {
    const own = members.map((m) => m.filter((r) => groupOfRow.get(r) === gi))
    for (const m of own) n[gi] += m.length
    const color = groupAppearance(g.rank).color
    const uid = traceUid(input.owner, 'histogram', g.uid)
    const hovertemplate = own.map(
      (m, j) =>
        `<b>${escapePlotText(g.label)}</b> ${escapePlotText(binInterval(edges[j], edges[j + 1], j === k - 1, input.loc))}${unitSuffix(input.unit)}` +
        `<br>${escapePlotText(input.t('figure.hover.count', { count: m.length }))}<extra></extra>`,
    )
    const overlay = input.mode === 'overlay'
    const trace: Partial<BarData> = {
      type: 'bar',
      uid,
      name: escapePlotText(g.label),
      legendgroup: input.owner,
      legendgrouptitle: { text: escapePlotText(input.groupName) },
      showlegend: true,
      x: [...centres],
      y: own.map((m) => m.length),
      width: [...widths],
      hovertemplate,
      marker: overlay
        ? { color: withAlpha(color, 0.35), line: { color, width: 1.25 } }
        : { color: withAlpha(color, 0.8), line: { color: '#ffffff', width: 1 } },
      selected: { marker: { opacity: 1 } },
      unselected: { marker: { opacity: 0.3 } },
    }
    // A base would pin every group to zero and defeat the stacking.
    if (overlay) trace.base = 0
    return {
      trace,
      uid,
      rowIds: own.map((m) => (m.length === 1 ? m[0] : -1)),
      members: own,
      datasetId: input.datasetId,
      markers: 0,
    }
  })
  return { built, result, n }
}
