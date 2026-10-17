/**
 * Line plot of an XY series: active rows connected in recorded order (or in x order when sortByX).
 * A row that is missing, invalid, excluded, filtered or hidden by a log axis BREAKS the line: gaps are
 * never interpolated across. Without markers, an isolated point (a break on both
 * sides) would vanish from a 'lines' trace, so such points keep a marker of their own.
 */
import { GROUP_OUTSIDE, RENDER } from '@/domain/derive/types'
import { INACTIVE } from '@/domain/model'
import type { LineOptions } from '@/domain/model'
import { type BuiltTrace, seriesMarker } from './common'
import { type SeriesEnv, envRows, envSample, xyTrace } from './scatter'

/** Drawing order with −1 at each break (no leading, trailing or repeated breaks). */
export function lineOrder(env: SeriesEnv, sortByX: boolean): number[] {
  const d = env.s.data
  const sample = envSample(env)
  // A group walks (and sorts) only its own rows: with many groups, never the whole series each time.
  const rows = envRows(env)
  let order: number[]
  if (sortByX) {
    order = []
    for (const i of rows) if (Number.isFinite(d.x[i])) order.push(i)
    order.sort((a, b) => d.x[a] - d.x[b] || d.rowIds[a] - d.rowIds[b])
  } else {
    order = Array.from(rows)
  }
  const seq: number[] = []
  for (const i of order) {
    // A group's line joins its own rows: the rows of other groups in between do not break it.
    if (sample.reason[i] === GROUP_OUTSIDE) continue
    const active = sample.reason[i] === INACTIVE.active
    if (active && d.render[i] !== RENDER.shown) env.tally?.hide(d.rowIds[i])
    const drawable =
      active && d.render[i] === RENDER.shown && Number.isFinite(d.x[i]) && Number.isFinite(d.y[i])
    if (drawable) seq.push(i)
    else if (seq.length > 0 && seq[seq.length - 1] !== -1) seq.push(-1)
  }
  while (seq.length > 0 && seq[seq.length - 1] === -1) seq.pop()
  return seq
}

export function linePoints(env: SeriesEnv, options: LineOptions): BuiltTrace {
  const st = env.s.spec.style
  const seq = lineOrder(env, options.sortByX)
  const isolated = seq.map(
    (i, k) => i >= 0 && (k === 0 || seq[k - 1] < 0) && (k === seq.length - 1 || seq[k + 1] < 0),
  )
  const anyIsolated = isolated.some(Boolean)
  const marker = seriesMarker(env.color, env.symbol, st.markerSize, st.open)
  const mode = options.markers || anyIsolated ? 'lines+markers' : 'lines'
  if (!options.markers && anyIsolated) marker.size = isolated.map((iso) => (iso ? st.markerSize : 0))
  return xyTrace(env, seq, {
    role: 'points',
    name: env.name,
    showlegend: true,
    mode,
    marker,
    size: st.markerSize,
    barColor: env.color,
    line: { color: env.color, width: st.lineWidth, dash: env.dash },
  })
}
