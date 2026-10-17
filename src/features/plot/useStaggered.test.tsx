import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STAGGER_MS, useStaggered } from './useStaggered'

/** Records every value a pane committed, so the test can see when and how often it drew. */
function Pane({ value, order, log }: { value: string; order: number; log: string[] }) {
  const shown = useStaggered(value, order)
  log.push(`${order}:${shown}`)
  return null
}

function Panes({ value, log }: { value: string; log: string[] }) {
  return (
    <>
      {[0, 1, 2, 3].map((k) => (
        <Pane key={k} value={value} order={k} log={log} />
      ))}
    </>
  )
}

describe('useStaggered: one pane per task', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('the focused pane takes a new value in the same render, each other pane in its own later task', () => {
    const log: string[] = []
    const { rerender } = render(<Panes value="a" log={log} />)
    log.length = 0
    act(() => rerender(<Panes value="b" log={log} />))
    // The urgent render: the focused pane draws the new value; the others still draw the old one.
    expect(log).toEqual(['0:b', '1:a', '2:a', '3:a'])
    log.length = 0
    act(() => vi.advanceTimersByTime(STAGGER_MS))
    expect(log).toEqual(['1:b'])
    log.length = 0
    act(() => vi.advanceTimersByTime(STAGGER_MS))
    expect(log).toEqual(['2:b'])
    log.length = 0
    act(() => vi.advanceTimersByTime(STAGGER_MS))
    expect(log).toEqual(['3:b'])
  })

  it('a value replaced before its turn is skipped: a pane only draws the latest one', () => {
    const log: string[] = []
    const { rerender } = render(<Panes value="a" log={log} />)
    act(() => rerender(<Panes value="b" log={log} />))
    act(() => rerender(<Panes value="c" log={log} />))
    log.length = 0
    act(() => vi.advanceTimersByTime(4 * STAGGER_MS))
    expect(log).toEqual(['1:c', '2:c', '3:c'])
  })
})
