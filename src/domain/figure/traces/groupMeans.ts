/**
 * Group means of replicate observations (y spec kind sd / sem / ci): diamond markers at the group x
 * with the replicate bars — the ONLY trace that carries them; the individual
 * observations stay visible as the series points, and the fit uses those observations, never the means.
 * A group with one observation has no bar (NaN), never a zero-length one. Each mean stands for its
 * member rows (selection).
 */
import { formatStat } from '@/domain/format/number'
import { escapePlotText } from '../escape'
import { cleanNumber, uncertaintyLabel } from '../labels'
import { drawableOn, lowerEndClipped } from '../logDomain'
import { NEUTRAL } from '../palette'
import { type BuiltTrace, type ScatterTrace, errorBar, selectionStyle, unitSuffix } from './common'
import { type SeriesEnv, envTitle, envUid } from './scatter'

export function groupMeansTrace(env: SeriesEnv): BuiltTrace | null {
  const { s, ctx } = env
  // A group of a split series has its own replicate statistics (means within the group).
  const rep = env.group ? env.group.replicate : s.replicate
  if (!rep) return null
  const { t, loc } = ctx
  const label = uncertaintyLabel(rep.bars.descriptor, t)
  const name = t('legend.groupMeans', { label, series: envTitle(env) })
  const idx: number[] = []
  rep.groups.forEach((g, j) => {
    if (g.x === null || !Number.isFinite(g.x) || !Number.isFinite(g.mean)) return
    if (!drawableOn(g.x, env.scales.x) || !drawableOn(g.mean, env.scales.y)) {
      for (const r of g.rowIds) env.tally?.hide(r)
      return
    }
    idx.push(j)
  })
  const visible = s.spec.errorBars.visible
  if (env.tally && visible)
    for (const j of idx) {
      const g = rep.groups[j]
      if (lowerEndClipped(g.mean, rep.bars.plus[j], null, env.scales.y)) env.tally.clip(g.rowIds)
    }
  const xName = escapePlotText(s.xColumn.name)
  const yName = escapePlotText(s.yColumn.name)
  const hovertemplate = idx.map((j) => {
    const g = rep.groups[j]
    const half = rep.bars.plus[j]
    const spread = Number.isFinite(half)
      ? `<br>${escapePlotText(label)}: ± ${escapePlotText(formatStat('sd', half, { loc }))}${unitSuffix(s.yColumn.unit)}`
      : ''
    return (
      `<b>${escapePlotText(name)}</b><br>${xName} = ${escapePlotText(cleanNumber(g.x as number, loc))}${unitSuffix(s.xColumn.unit)}<br>` +
      `${yName}: ${escapePlotText(t('stats.mean'))} = ${escapePlotText(formatStat('mean', g.mean, { sem: g.sem, loc }))}${unitSuffix(s.yColumn.unit)}` +
      `${spread}<br>n = ${g.n}<extra></extra>`
    )
  })
  const size = s.spec.style.markerSize + 4
  const uid = envUid(env, 'groupMeans')
  const trace: ScatterTrace = {
    type: 'scatter',
    uid,
    name: escapePlotText(name),
    legendgroup: s.spec.id,
    // The means of a split series' groups share one legend entry (a data-free trace).
    showlegend: !env.group,
    visible: env.visible,
    mode: 'markers',
    x: idx.map((j) => rep.groups[j].x as number),
    y: idx.map((j) => rep.groups[j].mean),
    hovertemplate,
    marker: { color: env.color, size, symbol: 'diamond', line: { color: NEUTRAL.text, width: 1 } },
    ...selectionStyle(size),
  }
  const ey = errorBar(rep.bars, idx, visible, NEUTRAL.text)
  if (ey) trace.error_y = { ...ey, thickness: 1.5, width: 5 }
  const members = idx.map((j) => [...rep.groups[j].rowIds] as number[])
  return {
    trace,
    uid,
    rowIds: members.map((m) => (m.length === 1 ? m[0] : -1)),
    members,
    datasetId: s.spec.datasetId,
    markers: env.visible === true ? idx.length : 0,
  }
}
