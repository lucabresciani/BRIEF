/**
 * Replicate groups: per group n_g, mean, sample SD (n_g − 1), SEM = SD/√n_g and
 * the t-based CI half-width t(level, n_g − 1)·SEM. A group with a single observation has no spread:
 * sd, sem, ciHalf and t are null (no bar is drawn, never a zero-length one). A group of n_g ≥ 2
 * identical values has SD = SEM = ciHalf = 0, which callers report (zeroSpreadIssue).
 */
import type { GroupSummary } from '@/domain/derive/types'
import { issue } from '@/domain/model'
import type { ConfidenceLevel, Issue, RowId } from '@/domain/model'
import { mean, sampleSD, standardError } from './descriptive'
import { tCritical } from './tCritical'

/**
 * Groups rows by key. `include(i)` selects the rows (the analysed sample); rows with a non-finite
 * value or a NaN/empty key are never grouped. Group order: first appearance, or ascending numeric key
 * when `numericKey` (then `x` is the key; identical x means exactly equal parsed numbers).
 */
export function groupSummaries(
  keys: readonly (string | number)[],
  values: Float64Array,
  rowIds: ArrayLike<number>,
  include: (i: number) => boolean,
  opts: { level: ConfidenceLevel; numericKey: boolean },
): GroupSummary[] {
  const buckets = new Map<string | number, { key: string | number; idx: number[] }>()
  const n = Math.min(keys.length, values.length, rowIds.length)
  for (let i = 0; i < n; i++) {
    if (!include(i)) continue
    if (!Number.isFinite(values[i])) continue
    const raw = keys[i]
    let k: string | number
    if (opts.numericKey) {
      const num = typeof raw === 'number' ? raw : Number(raw)
      if (!Number.isFinite(num)) continue
      k = num === 0 ? 0 : num // −0 and +0 are the same x
    } else {
      if (typeof raw === 'number' ? !Number.isFinite(raw) : raw === '') continue
      k = raw
    }
    let b = buckets.get(k)
    if (!b) {
      b = { key: k, idx: [] }
      buckets.set(k, b)
    }
    b.idx.push(i)
  }

  const list = [...buckets.values()]
  if (opts.numericKey) list.sort((a, b) => (a.key as number) - (b.key as number))

  return list.map(({ key, idx }) => {
    const v = new Float64Array(idx.length)
    for (let j = 0; j < idx.length; j++) v[j] = values[idx[j]]
    const ng = v.length
    const m = mean(v)
    const out: GroupSummary = {
      key: String(key),
      x: opts.numericKey ? (key as number) : null,
      rowIds: idx.map((i) => rowIds[i] as RowId),
      n: ng,
      mean: m,
      sd: null,
      sem: null,
      ciHalf: null,
      t: null,
    }
    if (ng >= 2) {
      const sd = sampleSD(v)
      const sem = standardError(sd, ng)
      const t = tCritical(opts.level, ng - 1)
      out.sd = sd
      out.sem = sem
      out.t = t
      out.ciHalf = t * sem
    }
    return out
  })
}

/**
 * I_ZERO_SPREAD for replicate groups: the groups of n ≥ 2 whose values are all identical (SD = 0), with
 * their rows; null when there are none. {scope: 'groups', count: groups, n: observations in them}.
 * Their SD / SEM / CI bars have zero length, which is not an uncertainty of zero (e.g. values rounded
 * to the instrument resolution), so they are never left unexplained.
 */
export function zeroSpreadIssue(
  groups: readonly { n: number; sd: number | null; rowIds: readonly RowId[] }[],
): Issue | null {
  const zero = groups.filter((g) => g.n >= 2 && g.sd === 0)
  if (zero.length === 0) return null
  const rows = zero.flatMap((g) => g.rowIds)
  return issue('I_ZERO_SPREAD', { scope: 'groups', count: zero.length, n: rows.length }, { rows })
}
