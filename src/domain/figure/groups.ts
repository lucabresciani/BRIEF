/**
 * Groups as the figure shows them: the display label (the no-value group is "(no value)") and the
 * rank that picks a group's colour and symbol.
 */
import type { DerivedSeries } from '@/domain/derive/pipeline'
import { NO_VALUE_KEY } from '@/domain/derive/split'
import type { Translate } from './context'

/** Plain-text label of a group; the rows without a value are "(no value)". */
export const groupLabel = (g: { key: string; label: string }, t: Translate) =>
  g.key === NO_VALUE_KEY ? t('legend.noValue') : g.label

/**
 * Rank of each group in the plot's order of its split column: groups of columns with the same name
 * (the same column in several series, or the same variable in several datasets) share one order, by
 * their position in the column (first appearance / ascending), the no-value group last. The same group
 * therefore has the same colour and symbol in every series split by that column.
 */
export function groupRanks(series: readonly DerivedSeries[]): (s: DerivedSeries, key: string) => number {
  const byColumn = new Map<string, Map<string, { index: number; seen: number }>>()
  let seen = 0
  for (const s of series) {
    if (!s.split) continue
    const name = s.split.column.name
    let keys = byColumn.get(name)
    if (!keys) byColumn.set(name, (keys = new Map()))
    for (const g of s.split.groups) {
      const known = keys.get(g.key)
      if (!known) keys.set(g.key, { index: g.index, seen: seen++ })
      else known.index = Math.min(known.index, g.index)
    }
  }
  const ranks = new Map<string, Map<string, number>>()
  for (const [name, keys] of byColumn) {
    const last = (k: string) => (k === NO_VALUE_KEY ? 1 : 0)
    const order = [...keys].sort(
      ([ka, a], [kb, b]) => last(ka) - last(kb) || a.index - b.index || a.seen - b.seen,
    )
    ranks.set(name, new Map(order.map(([k], r) => [k, r])))
  }
  return (s, key) => (s.split ? (ranks.get(s.split.column.name)?.get(key) ?? 0) : 0)
}
