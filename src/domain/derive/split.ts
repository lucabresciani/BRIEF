/**
 * Splitting an XY series by the values of a column: one group per value, each with a MASKED
 * copy of the series' pairwise sample. The series arrays (x, y, rowIds, bars) stay full length and
 * shared, so runFit({ ...data, sample: group.sample }) and resolveReplicateBars work unchanged: a row of
 * another group carries GROUP_OUTSIDE, which is not an analysis reason and is never counted.
 *
 * Group order (the same for every series split by the column, so a group keeps its colour): first
 * appearance for label columns, ascending for numbers and dates, and the rows without a value last, as
 * the group "(no value)". Those rows are shown, never dropped (I_SPLIT_NO_VALUE). A column with more
 * than MAX_SPLIT_GROUPS values is not split (W_SPLIT_TOO_MANY_GROUPS): the series is drawn whole.
 */
import { INACTIVE, issue } from '@/domain/model'
import type { ColumnMeta, InactiveReason, Issue, RowId } from '@/domain/model'
import { CELL, GROUP_OUTSIDE } from './types'
import type { AnalysisSample, DatasetView, ParsedColumn, SeriesData } from './types'

export const MAX_SPLIT_GROUPS = 50

/** Key of the group of rows without a value in the split column; its label is translated by the figure. */
export const NO_VALUE_KEY = ''

/** One distinct value of a column, in group order. */
export interface GroupKey {
  /** Stable text of the value (SplitSpec.overrides refer to it): the label, the number, the ISO date. */
  key: string
  /** Plain text: the label or the value as first recorded; '' for the no-value group. */
  label: string
  /** The category label, the number, the date in epoch ms; null for the no-value group. */
  value: string | number | null
  /** Position in the column's group order. */
  index: number
  /** 'g' + FNV-1a of the key in base 36 (a CSS identifier), suffixed on a collision. */
  uid: string
}

export type ColumnGroups =
  | { tooMany: false; groups: readonly GroupKey[]; groupOf: Int32Array; distinct: number }
  | { tooMany: true; distinct: number }

/** FNV-1a (32 bit) of the UTF-16 code units, in base 36. */
export function fnv1a36(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

/** uid of each key, in order: a key whose hash was already taken gets "_2", "_3"… ('_' is not base 36). */
export function groupUids(keys: readonly string[]): string[] {
  const taken = new Set<string>()
  return keys.map((key) => {
    const base = `g${fnv1a36(key)}`
    let uid = base
    for (let k = 2; taken.has(uid); k++) uid = `${base}_${k}`
    taken.add(uid)
    return uid
  })
}

const MAX_DATE_MS = 8.64e15

function numericKey(v: number, datetime: boolean): string {
  if (datetime && Math.abs(v) <= MAX_DATE_MS) return new Date(v).toISOString()
  return String(v === 0 ? 0 : v)
}

const cache = new WeakMap<ParsedColumn, ColumnGroups>()

/**
 * Groups of a parsed column over every row of its view (memoised on the column object): the group of
 * each row and the groups in order. A cell that is missing, unreadable or not a finite number has no
 * value. More than MAX_SPLIT_GROUPS distinct values → only their count.
 */
export function columnGroups(pc: ParsedColumn): ColumnGroups {
  const known = cache.get(pc)
  if (known) return known
  const n = pc.values.length
  const slot = new Int32Array(n).fill(-1)
  const entries: { key: string; label: string; value: string | number }[] = []
  let noValue = false
  if (pc.categories) {
    const { codes, labels } = pc.categories
    const byCode = new Int32Array(labels.length).fill(-1)
    for (let i = 0; i < n; i++) {
      const code = codes[i]
      if (code < 0 || pc.status[i] !== CELL.ok) {
        noValue = true
        continue
      }
      if (byCode[code] < 0) {
        byCode[code] = entries.length
        entries.push({ key: labels[code], label: labels[code], value: labels[code] })
      }
      slot[i] = byCode[code]
    }
  } else {
    const datetime = pc.settings.kind === 'datetime'
    const byValue = new Map<number, number>()
    for (let i = 0; i < n; i++) {
      const v = pc.values[i]
      if (pc.status[i] !== CELL.ok || !Number.isFinite(v)) {
        noValue = true
        continue
      }
      let k = byValue.get(v)
      if (k === undefined) {
        k = entries.length
        byValue.set(v, k)
        const key = numericKey(v, datetime)
        entries.push({ key, label: (pc.text[i] ?? '').trim() || key, value: v === 0 ? 0 : v })
      }
      slot[i] = k
    }
  }
  let out: ColumnGroups
  if (entries.length > MAX_SPLIT_GROUPS) out = { tooMany: true, distinct: entries.length }
  else {
    const order = entries.map((_, k) => k)
    if (!pc.categories) order.sort((a, b) => (entries[a].value as number) - (entries[b].value as number))
    const rank = new Int32Array(entries.length)
    order.forEach((k, r) => (rank[k] = r))
    const keys = order.map((k) => entries[k].key)
    if (noValue) keys.push(NO_VALUE_KEY)
    const uids = groupUids(keys)
    const groups: GroupKey[] = order.map((k, r) => ({ ...entries[k], index: r, uid: uids[r] }))
    if (noValue)
      groups.push({
        key: NO_VALUE_KEY,
        label: '',
        value: null,
        index: groups.length,
        uid: uids[groups.length],
      })
    const groupOf = new Int32Array(n)
    for (let i = 0; i < n; i++) groupOf[i] = slot[i] < 0 ? groups.length - 1 : rank[slot[i]]
    out = { tooMany: false, groups, groupOf, distinct: entries.length }
  }
  cache.set(pc, out)
  return out
}

/** A group of a split series: its rows and its masked sample. */
export interface GroupSlice extends GroupKey {
  /** Indices into the view rows (and the series arrays), ascending. */
  rows: Int32Array
  /**
   * The series' pairwise sample restricted to the group: rows of other groups carry GROUP_OUTSIDE and
   * are not counted; nTotal is the group size.
   */
  sample: AnalysisSample
}

/** Rows of the group that the figure shows: analysed, excluded or filtered out (not missing or invalid). */
export const shownCount = (sample: AnalysisSample) =>
  sample.nActive + sample.counts.excluded + sample.counts.filtered

/**
 * The groups of a series sample by a parsed column. A group none of whose rows can be shown (every x or
 * y missing or unreadable) is left out: it has nothing to draw or fit, and its rows are already reported
 * as inactive by the series. Its index is kept, so the other groups keep their colours.
 */
export function partitionGroups(
  pc: ParsedColumn,
  sample: AnalysisSample,
): { groups: GroupSlice[] } | { tooMany: number } {
  const cg = columnGroups(pc)
  if (cg.tooMany) return { tooMany: cg.distinct }
  const n = sample.reason.length
  const sizes = new Int32Array(cg.groups.length)
  for (let i = 0; i < n; i++) sizes[cg.groupOf[i]]++
  const rows = Array.from(sizes, (size) => new Int32Array(size))
  const fill = new Int32Array(cg.groups.length)
  for (let i = 0; i < n; i++) {
    const g = cg.groupOf[i]
    rows[g][fill[g]++] = i
  }
  const groups: GroupSlice[] = []
  cg.groups.forEach((key, g) => {
    if (rows[g].length === 0) return
    const reason = new Uint8Array(n).fill(GROUP_OUTSIDE)
    const counts: Record<InactiveReason, number> = { missing: 0, invalid: 0, excluded: 0, filtered: 0 }
    let nActive = 0
    for (const i of rows[g]) {
      const r = sample.reason[i]
      reason[i] = r
      if (r === INACTIVE.active) nActive++
      else if (r === INACTIVE.missing) counts.missing++
      else if (r === INACTIVE.invalid) counts.invalid++
      else if (r === INACTIVE.excluded) counts.excluded++
      else if (r === INACTIVE.filtered) counts.filtered++
    }
    const masked: AnalysisSample = { rowIds: sample.rowIds, reason, nTotal: rows[g].length, nActive, counts }
    if (shownCount(masked) > 0) groups.push({ ...key, rows: rows[g], sample: masked })
  })
  return { groups }
}

/** I_SPLIT_NO_VALUE / W_SPLIT_TOO_MANY_GROUPS of a partition by `column`. */
export function splitIssues(
  partition: ReturnType<typeof partitionGroups>,
  column: Pick<ColumnMeta, 'id' | 'name'>,
): Issue[] {
  if ('tooMany' in partition)
    return [
      issue(
        'W_SPLIT_TOO_MANY_GROUPS',
        { column: column.name, count: partition.tooMany, limit: MAX_SPLIT_GROUPS },
        { columnId: column.id },
      ),
    ]
  const none = partition.groups.find((g) => g.key === NO_VALUE_KEY)
  if (!none) return []
  const rows: RowId[] = []
  for (const i of none.rows) {
    const r = none.sample.reason[i]
    if (r === INACTIVE.active || r === INACTIVE.excluded || r === INACTIVE.filtered)
      rows.push(none.sample.rowIds[i] as RowId)
  }
  return [
    issue('I_SPLIT_NO_VALUE', { count: rows.length, column: column.name }, { rows, columnId: column.id }),
  ]
}

/**
 * The groups of a series split by `column` (see partitionGroups) and the issues of the split. groups is
 * null when the column is not in the view or has too many values (the series is then drawn whole).
 */
export function splitGroups(
  view: DatasetView,
  column: Pick<ColumnMeta, 'id' | 'name'>,
  data: Pick<SeriesData, 'sample'>,
): { groups: GroupSlice[] | null; issues: Issue[] } {
  const pc = view.columns.get(column.id)
  if (!pc) return { groups: null, issues: [] }
  const partition = partitionGroups(pc, data.sample)
  return { groups: 'tooMany' in partition ? null : partition.groups, issues: splitIssues(partition, column) }
}
