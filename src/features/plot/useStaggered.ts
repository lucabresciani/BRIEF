import { useEffect, useState } from 'react'
import { flushSync } from 'react-dom'

/** Gap between two panes taking a staggered value (ms). */
export const STAGGER_MS = 16

/**
 * `value` as pane number `order` draws it: order 0 (the focused pane) at once, every other pane in a
 * task of its own, `order × STAGGER_MS` later. Plotly restyles every marker of a pane for a selection
 * (130–300 ms for 5000 points, measured in the production build), so four panes updated in one commit
 * made one long task of almost a second; one task per pane lets the browser paint and take input in
 * between, and the pane being worked in answers first.
 */
export function useStaggered<T>(value: T, order: number): T {
  const [shown, setShown] = useState(value)
  useEffect(() => {
    if (order === 0 || Object.is(shown, value)) return
    // flushSync: render and commit (Plotly draws) inside this timer task, not batched with other panes.
    const id = setTimeout(() => flushSync(() => setShown(() => value)), order * STAGGER_MS)
    return () => clearTimeout(id)
  }, [value, order, shown])
  return order === 0 ? value : shown
}
