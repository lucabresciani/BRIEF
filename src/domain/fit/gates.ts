import { issue, modelParameterCount, type FitModel, type Issue, type RowId } from '@/domain/model'
import type { FitErrorCode } from '@/domain/derive/types'

type FitIssue = Issue & { code: FitErrorCode }

const fitIssue = (code: FitErrorCode, params: Issue['params'], rows?: readonly RowId[]): FitIssue =>
  issue(code, params, rows ? { rows } : undefined) as FitIssue

/** Relative spread below which x values are treated as identical. */
export const X_EFFECTIVELY_CONSTANT = 1e-12

/** Number of distinct values (exact equality of doubles). */
export function countDistinct(values: ArrayLike<number>): number {
  const sorted = Float64Array.from(values).sort()
  let d = sorted.length > 0 ? 1 : 0
  for (let i = 1; i < sorted.length; i++) if (sorted[i] !== sorted[i - 1]) d++
  return d
}

/**
 * Preconditions checked BEFORE any computation; a non-null result means "no fit, no curve".
 * Order (most actionable first): E_TOO_FEW_POINTS (n < p + 1: at least one residual degree of freedom)
 * → E_LOG_DOMAIN_FIT (exponential: y ≤ 0; power: x ≤ 0 or y ≤ 0; lists the rows, never a silent drop)
 * → E_CONSTANT_X (min = max on the parsed values, not Sxx = 0, so |x| ≈ 1e-170 is not "constant")
 * → E_X_EFFECTIVELY_CONSTANT ((max − min)/max(|max|, |min|) ≤ 1e-12)
 * → E_TOO_FEW_DISTINCT_X (fewer than p distinct x: Anscombe IV allows a line but not a quadratic).
 * Non-finite pairs cannot occur in a valid sample; they are skipped defensively.
 */
export function fitPreconditions(
  model: FitModel,
  x: Float64Array,
  y: Float64Array,
  rowIds: Int32Array,
): FitIssue | null {
  const p = modelParameterCount(model)
  const len = Math.min(x.length, y.length, rowIds.length)
  const xs: number[] = []
  const domainRows: RowId[] = []
  let xmin = Infinity
  let xmax = -Infinity
  for (let i = 0; i < len; i++) {
    const xi = x[i]
    const yi = y[i]
    if (!Number.isFinite(xi) || !Number.isFinite(yi)) continue
    xs.push(xi)
    if (xi < xmin) xmin = xi
    if (xi > xmax) xmax = xi
    if (
      (model.type === 'exponential' || model.type === 'power') &&
      (yi <= 0 || (model.type === 'power' && xi <= 0))
    )
      domainRows.push(rowIds[i] as RowId)
  }
  const n = xs.length
  const modelParams: Record<string, string | number> =
    model.type === 'polynomial' ? { model: model.type, k: model.degree } : { model: model.type }

  if (n < p + 1) return fitIssue('E_TOO_FEW_POINTS', { ...modelParams, needed: p + 1, n })
  if (domainRows.length > 0)
    return fitIssue('E_LOG_DOMAIN_FIT', { model: model.type, count: domainRows.length }, domainRows)
  if (xmin === xmax) return fitIssue('E_CONSTANT_X', { n })
  const scale = Math.max(Math.abs(xmin), Math.abs(xmax))
  // Halves avoid overflow of max − min for |x| near the double range.
  if ((xmax / 2 - xmin / 2) / (scale / 2) <= X_EFFECTIVELY_CONSTANT)
    return fitIssue('E_X_EFFECTIVELY_CONSTANT', { min: xmin, max: xmax })
  const d = countDistinct(xs)
  if (d < p) return fitIssue('E_TOO_FEW_DISTINCT_X', { k: p - 1, p, d })
  return null
}
