import type { FitOk } from '@/domain/derive/types'

/**
 * "Copy at full precision": every number as JavaScript prints it (shortest exact round trip), never
 * rounded for display. `group`: the group of a per-group fit, named first.
 */
export function fullPrecisionText(fit: FitOk, xName: string, yName: string, group?: string): string {
  const lines = [
    ...(group !== undefined ? [`group: ${group}`] : []),
    `model: ${fit.model.type}${fit.model.type === 'polynomial' ? ` degree ${fit.model.degree}` : ''}`,
    `x: ${xName}; y: ${yName}`,
  ]
  for (const p of fit.params) lines.push(`${p.symbol} = ${p.value}${p.se !== null ? ` (SE ${p.se})` : ''}`)
  lines.push(
    `R2 = ${fit.r2}`,
    `adjusted R2 = ${fit.adjR2}`,
    `s = ${fit.s}`,
    `df = ${fit.df}`,
    `n = ${fit.provenance.nUsed}`,
  )
  return lines.join('\n')
}
