/**
 * Excluded and filtered observations of an XY series (rows with x and y valid but outside the analysed
 * sample): hollow grey markers with their own legend entry "Excluded (n = k)" ("V: excluded (n = k)"
 * with several series, "A: excluded (n = k)" for group A of a split series). They are never fitted;
 * showing them keeps the figure honest about what was left out.
 */
import { RENDER } from '@/domain/derive/types'
import { INACTIVE } from '@/domain/model'
import { NEUTRAL } from '../palette'
import type { BuiltTrace } from './common'
import { type SeriesEnv, envRows, envSample, xyTrace } from './scatter'

export function excludedPoints(env: SeriesEnv): BuiltTrace | null {
  const d = env.s.data
  const sample = envSample(env)
  const { t } = env.ctx
  const idx: number[] = []
  for (const i of envRows(env)) {
    const r = sample.reason[i]
    if (r !== INACTIVE.excluded && r !== INACTIVE.filtered) continue
    if (!Number.isFinite(d.x[i]) || !Number.isFinite(d.y[i])) continue
    if (d.render[i] !== RENDER.shown) {
      env.tally?.hide(d.rowIds[i])
      continue
    }
    idx.push(i)
  }
  if (idx.length === 0) return null
  const size = env.s.spec.style.markerSize
  return xyTrace(env, idx, {
    role: 'excluded',
    // A group's entry names its group (it sits under the series title in the legend).
    name:
      env.several || env.group
        ? t('legend.excludedOf', { n: idx.length, series: env.name })
        : t('legend.excluded', { n: idx.length }),
    showlegend: true,
    mode: 'markers',
    marker: {
      color: NEUTRAL.excluded,
      size,
      symbol: `${env.symbol}-open`,
      line: { color: NEUTRAL.excluded, width: 1.25 },
    },
    size,
    barColor: NEUTRAL.excluded,
    extra: (i) =>
      ` · ${t(sample.reason[i] === INACTIVE.excluded ? 'figure.hover.excluded' : 'figure.hover.filtered')}`,
  })
}
