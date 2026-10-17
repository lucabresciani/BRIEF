/**
 * Error-bar arrays (ErrorBarArrays). One source of truth for the figure, the table,
 * tooltips and exports. Rules:
 * - a missing uncertainty is NaN + CELL.missing (no bar), never 0; zero is a valid zero-length bar;
 * - a negative or non-finite uncertainty is CELL.invalid with NaN (no bar): never its absolute value;
 * - asymmetric bars: if either side is missing or invalid, BOTH sides are NaN (a one-sided bar would be
 *   drawn by Plotly as a zero-length other side, which looks like a real uncertainty of zero);
 * - values are shown as given: an expanded uncertainty is never multiplied, units are never converted.
 */
import { CELL, isMissingStatus } from '@/domain/derive/types'
import type { DatasetView, ErrorBarArrays, GroupSummary, SeriesData } from '@/domain/derive/types'
import { INACTIVE, issue } from '@/domain/model'
import type { ColumnId, ColumnMeta, ColumnRole, Issue, RowId, UncertaintySpec } from '@/domain/model'
import { groupSummaries, zeroSpreadIssue } from '@/domain/stats/groups'
import { studentTwoSided, tCritical } from '@/domain/stats/tCritical'
import { describeUncertainty } from './describe'

type MeasurementOrNone = Extract<UncertaintySpec, { kind: 'none' | 'measurement' }>
type Replicate = Extract<UncertaintySpec, { kind: 'sd' | 'sem' | 'ci' }>

interface Side {
  u: Float64Array
  st: Uint8Array
}

/** One uncertainty column read from the SAME view, row by row: ok (finite, ≥ 0) | missing | invalid. */
function readColumn(view: DatasetView, id: ColumnId, n: number): Side {
  const u = new Float64Array(n).fill(NaN)
  const st = new Uint8Array(n).fill(CELL.missing)
  const col = view.columns.get(id)
  if (!col) return { u, st }
  for (let i = 0; i < n; i++) {
    const s = col.status[i]
    if (isMissingStatus(s)) continue
    const v = col.values[i]
    if (s === CELL.ok && Number.isFinite(v) && v >= 0) {
      u[i] = v
      st[i] = CELL.ok
    } else {
      st[i] = CELL.invalid
    }
  }
  return { u, st }
}

function unitMismatch(unc: ColumnMeta | undefined, valueColumn: ColumnMeta): Issue | null {
  if (!unc || unc.unit === null || valueColumn.unit === null || unc.unit === valueColumn.unit) return null
  return issue(
    'W_UNCERTAINTY_UNIT_MISMATCH',
    { u: unc.name, uu: unc.unit, col: valueColumn.name, cu: valueColumn.unit },
    { columnId: unc.id },
  )
}

/**
 * Bars for 'none' (→ null) and 'measurement' uncertainty, aligned with `values` (the series' x or y,
 * aligned with view.rowIds). Row-level issues only count rows whose value is finite (drawn points).
 */
export function resolveMeasurementBars(
  spec: MeasurementOrNone,
  values: Float64Array,
  view: DatasetView,
  valueColumn: ColumnMeta,
  columnsById: (id: ColumnId) => ColumnMeta | undefined,
): ErrorBarArrays | null {
  if (spec.kind === 'none') return null
  const n = values.length
  const plus = new Float64Array(n).fill(NaN)
  let minus: Float64Array | null = null
  const status = new Uint8Array(n).fill(CELL.missing)
  const issues: Issue[] = []
  const descriptor = describeUncertainty(spec)
  const rowId = (i: number) => view.rowIds[i] as RowId
  const drawn = (i: number) => Number.isFinite(values[i])
  const out = (): ErrorBarArrays => ({ plus, minus, status, descriptor, issues })
  const allInvalid = (code: 'E_UNCERTAINTY_NEGATIVE' | 'E_DERIVED_UNCERTAINTY', params?: Issue['params']) => {
    status.fill(CELL.invalid)
    plus.fill(NaN)
    if (minus) minus.fill(NaN)
    issues.push(issue(code, params, { columnId: valueColumn.id }))
    return out()
  }
  const src = spec.source

  switch (src.type) {
    case 'absolute': {
      if (!(Number.isFinite(src.value) && src.value >= 0))
        return allInvalid('E_UNCERTAINTY_NEGATIVE', { value: src.value })
      plus.fill(src.value)
      status.fill(CELL.ok)
      return out()
    }
    case 'percent': {
      const p = src.percent
      if (!(Number.isFinite(p) && p >= 0)) return allInvalid('E_UNCERTAINTY_NEGATIVE', { value: p })
      if (p > 100) issues.push(issue('W_PERCENT_OVER_100', { percent: p }, { columnId: valueColumn.id }))
      const zeros: RowId[] = []
      for (let i = 0; i < n; i++) {
        const v = values[i]
        if (!Number.isFinite(v)) continue // no value → no bar (status stays missing)
        plus[i] = (Math.abs(v) * p) / 100
        status[i] = CELL.ok
        if (v === 0) zeros.push(rowId(i))
      }
      if (zeros.length > 0)
        issues.push(
          issue('I_ZERO_VALUE_PERCENT', { count: zeros.length }, { rows: zeros, columnId: valueColumn.id }),
        )
      return out()
    }
    case 'column':
    case 'columnAsymmetric': {
      const plusId = src.type === 'column' ? src.column : src.plus
      const metas =
        src.type === 'column' ? [columnsById(src.column)] : [columnsById(src.plus), columnsById(src.minus)]
      if (src.type === 'columnAsymmetric') minus = new Float64Array(n).fill(NaN)
      if (metas.some((m) => m?.source.type === 'derived'))
        return allInvalid('E_DERIVED_UNCERTAINTY', {
          column: metas.find((m) => m?.source.type === 'derived')!.name,
        })
      for (const m of metas) {
        const w = unitMismatch(m, valueColumn)
        if (w) issues.push(w)
      }
      const a = readColumn(view, plusId, n)
      const b = src.type === 'columnAsymmetric' ? readColumn(view, src.minus, n) : null
      const invalidRows: RowId[] = []
      const missingRows: RowId[] = []
      for (let i = 0; i < n; i++) {
        let s: number
        if (!b) s = a.st[i]
        else {
          const sa = a.st[i]
          const sb = b.st[i]
          if (sa === CELL.ok && sb === CELL.ok) s = CELL.ok
          else if (sa === CELL.missing && sb === CELL.missing) s = CELL.missing
          else s = CELL.invalid // an invalid side, or only one side present
        }
        status[i] = s
        if (s === CELL.ok) {
          plus[i] = a.u[i]
          if (minus && b) minus[i] = b.u[i]
        } else if (drawn(i)) {
          ;(s === CELL.missing ? missingRows : invalidRows).push(rowId(i))
        }
      }
      if (invalidRows.length > 0)
        issues.push(
          issue(
            'W_UNCERTAINTY_ROWS_INVALID',
            { count: invalidRows.length },
            { rows: invalidRows, columnId: plusId },
          ),
        )
      if (missingRows.length > 0)
        issues.push(
          issue(
            'I_UNCERTAINTY_ROWS_MISSING',
            { count: missingRows.length },
            { rows: missingRows, columnId: plusId },
          ),
        )
      return out()
    }
  }
}

/**
 * Replicate bars (SD / SEM / CI of group means), aligned with the returned groups. Groups use ONLY the
 * series' active pairwise sample: by identical x (exact equality of parsed numbers) or by a column of
 * the same view. For column grouping the group's x is the mean x of its rows (position of the mean);
 * when x is not constant inside a group the mean mixes observations taken at different x, reported as
 * W_GROUP_X_VARIES {count} with their rows, unless `xRole` is 'identifier' (a trial or sample number on
 * x only places the group, e.g. the pendulum's 'trial' grouped by observer).
 * Groups of n ≥ 2 identical values keep their zero-length bar and are reported (I_ZERO_SPREAD).
 */
export function resolveReplicateBars(
  spec: Replicate,
  series: SeriesData,
  view: DatasetView,
  opts: { xRole?: ColumnRole } = {},
): { groups: GroupSummary[]; bars: ErrorBarArrays } {
  const level = spec.kind === 'ci' ? spec.level : 0.95
  const n = series.y.length
  const active = (i: number) => series.sample.reason[i] === INACTIVE.active && Number.isFinite(series.x[i])
  const issues: Issue[] = []
  let groups: GroupSummary[]

  if (spec.grouping.by === 'sameX') {
    groups = groupSummaries(Array.from(series.x), series.y, series.rowIds, active, {
      level,
      numericKey: true,
    })
  } else {
    const col = view.columns.get(spec.grouping.column)
    const keys: (string | number)[] = new Array(n).fill('')
    let numericKey = false
    if (col) {
      if (col.categories) {
        const { codes, labels } = col.categories
        for (let i = 0; i < n; i++)
          keys[i] = codes[i] >= 0 && col.status[i] === CELL.ok ? labels[codes[i]] : ''
      } else {
        numericKey = true
        for (let i = 0; i < n; i++) keys[i] = col.status[i] === CELL.ok ? col.values[i] : NaN
      }
    }
    groups = groupSummaries(keys, series.y, series.rowIds, active, { level, numericKey })
    const xByRow = new Map<number, number>()
    for (let i = 0; i < n; i++) xByRow.set(series.rowIds[i], series.x[i])
    const mixed: GroupSummary[] = []
    for (const g of groups) {
      let s = 0
      let varies = false
      const x0 = xByRow.get(g.rowIds[0]) ?? NaN
      for (const r of g.rowIds) {
        const x = xByRow.get(r) ?? NaN
        s += x
        if (x !== x0) varies = true
      }
      g.x = g.rowIds.length > 0 ? s / g.rowIds.length : null
      if (varies) mixed.push(g)
    }
    if (mixed.length > 0 && opts.xRole !== 'identifier')
      issues.push(
        issue('W_GROUP_X_VARIES', { count: mixed.length }, { rows: mixed.flatMap((g) => g.rowIds) }),
      )
    const grouped = new Set<number>()
    for (const g of groups) for (const r of g.rowIds) grouped.add(r)
    const ungrouped: RowId[] = []
    for (let i = 0; i < n; i++)
      if (active(i) && Number.isFinite(series.y[i]) && !grouped.has(series.rowIds[i]))
        ungrouped.push(series.rowIds[i] as RowId)
    if (ungrouped.length > 0)
      issues.push(
        issue(
          'I_UNCERTAINTY_ROWS_MISSING',
          { count: ungrouped.length },
          { rows: ungrouped, columnId: spec.grouping.column },
        ),
      )
  }

  const k = groups.length
  const plus = new Float64Array(k).fill(NaN)
  const status = new Uint8Array(k).fill(CELL.missing)
  for (let j = 0; j < k; j++) {
    const g = groups[j]
    const half = spec.kind === 'sd' ? g.sd : spec.kind === 'sem' ? g.sem : g.ciHalf
    if (half !== null && Number.isFinite(half)) {
      plus[j] = half
      status[j] = CELL.ok
    }
  }

  const singles = groups.filter((g) => g.n === 1)
  if (singles.length > 0)
    issues.push(
      issue('W_GROUP_SINGLE', { count: singles.length }, { rows: singles.flatMap((g) => g.rowIds) }),
    )
  const zero = zeroSpreadIssue(groups)
  if (zero) issues.push(zero)
  if (spec.kind === 'ci') {
    // A pair of identical values has a zero-width interval, not a very wide one (I_ZERO_SPREAD says why).
    const pairs = groups.filter((g) => g.n === 2 && g.sd !== 0)
    if (pairs.length > 0)
      issues.push(
        pairCiIssue(
          pairs.length,
          level,
          pairs.flatMap((g) => g.rowIds),
        ),
      )
  }
  if (spec.kind === 'sem') {
    const small = [...new Set(groups.map((g) => g.n).filter((m) => m >= 2 && m <= 5))].sort((a, b) => a - b)
    for (const m of small) issues.push(issue('I_SEM_COVERAGE', { coverage: semCoveragePct(m), n: m }))
  }

  const descriptor = describeUncertainty(spec, { groupN: groups.map((g) => g.n) })
  return { groups, bars: { plus, minus: null, status, descriptor, issues } }
}

/**
 * W_GROUP_PAIR_CI {count, t, level}: groups of 2 get a CI with df = 1. t(level, 1) is given as shown
 * (4 significant figures, like W_FEW_DOF): 6.314 / 12.71 / 63.66, never a hard-coded 12.71. Callers leave
 * out pairs of identical values (zero-width interval, reported as I_ZERO_SPREAD instead).
 */
export function pairCiIssue(count: number, level: number, rows: readonly RowId[]): Issue {
  return issue(
    'W_GROUP_PAIR_CI',
    { count, t: Number(tCritical(level, 1).toPrecision(4)), level: Math.round(level * 100) },
    { rows },
  )
}

/** Coverage (%) of a ±1 SEM interval for a group of n under the t model: 100·P(|T_{n−1}| < 1). */
export function semCoveragePct(n: number): number {
  return Math.round(100 * studentTwoSided(1, n - 1))
}
