/**
 * What an error bar means, as an i18n label key plus parameters (legend, caption, tooltips).
 * The kinds are never interchangeable: measurement uncertainty of each observation, SD of replicates
 * (n − 1), SEM of a group mean, t-based CI of a group mean at a stated level.
 *
 * Label keys: 'uncertainty.label.none', 'uncertainty.label.measurement.standard' (u, k = 1),
 * '.measurement.expanded' (U = k·u), '.measurement.unspecified' (meaning not stated by the user),
 * 'uncertainty.label.sd', 'uncertainty.label.sem', 'uncertainty.label.ci'.
 */
import type { UncertaintyDescriptor } from '@/domain/derive/types'
import type { UncertaintySpec } from '@/domain/model'

/** n per group as shown in labels: one number when all groups agree, else "min–max". */
function groupNParam(groupN: readonly number[] | undefined): number | string | null {
  if (!groupN || groupN.length === 0) return null
  let lo = groupN[0]
  let hi = groupN[0]
  for (const n of groupN) {
    if (n < lo) lo = n
    if (n > hi) hi = n
  }
  return lo === hi ? lo : `${lo}–${hi}`
}

export function describeUncertainty(
  spec: UncertaintySpec,
  ctx?: { groupN?: number[] },
): UncertaintyDescriptor {
  switch (spec.kind) {
    case 'none':
      return { kind: 'none', labelKey: 'uncertainty.label.none', params: {} }
    case 'measurement': {
      const params: Record<string, string | number> = { origin: spec.origin, source: spec.source.type }
      if (spec.source.type === 'absolute') params.value = spec.source.value
      if (spec.source.type === 'percent') params.percent = spec.source.percent
      const m = spec.meaning
      if (m.type === 'standard') {
        params.k = 1
        return { kind: 'measurement', labelKey: 'uncertainty.label.measurement.standard', params }
      }
      if (m.type === 'expanded') {
        params.k = m.k
        return { kind: 'measurement', labelKey: 'uncertainty.label.measurement.expanded', params }
      }
      return { kind: 'measurement', labelKey: 'uncertainty.label.measurement.unspecified', params }
    }
    case 'sd':
    case 'sem':
    case 'ci': {
      const params: Record<string, string | number> = { grouping: spec.grouping.by }
      const n = groupNParam(ctx?.groupN)
      if (n !== null) params.n = n
      if (spec.kind === 'ci') {
        params.level = Math.round(spec.level * 100)
        params.method = spec.method
      }
      return { kind: spec.kind, labelKey: `uncertainty.label.${spec.kind}`, params }
    }
  }
}
