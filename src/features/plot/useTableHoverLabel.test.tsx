import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useTableHoverLabel } from './useTableHoverLabel'

type HoverRow = { rowId: number; origin: 'plot' | 'table' } | null

const byRow = new Map([
  [3, [{ uid: 'ser_a__points', pointIndex: 3 }]],
  [4, [{ uid: 'ser_a__points', pointIndex: 4 }]],
])

function setup(initial: HoverRow) {
  const canvas = { current: { hover: vi.fn(), unhover: vi.fn() } }
  const hook = renderHook(({ row }: { row: HoverRow }) => useTableHoverLabel(canvas, row, byRow), {
    initialProps: { row: initial },
  })
  return { ...canvas.current, rerender: (row: HoverRow) => hook.rerender({ row }) }
}

describe('useTableHoverLabel', () => {
  it('a point hovered on the plot keeps its Plotly label (never unhovered from here)', () => {
    const c = setup(null)
    c.rerender({ rowId: 4, origin: 'plot' })
    c.rerender(null)
    expect(c.unhover).not.toHaveBeenCalled()
    expect(c.hover).not.toHaveBeenCalled()
  })

  it('a hovered table row shows the label of its points, removed when the row is left', () => {
    const c = setup(null)
    c.rerender({ rowId: 3, origin: 'table' })
    expect(c.hover).toHaveBeenLastCalledWith([{ uid: 'ser_a__points', pointIndex: 3 }])
    c.rerender({ rowId: 4, origin: 'table' })
    expect(c.hover).toHaveBeenLastCalledWith([{ uid: 'ser_a__points', pointIndex: 4 }])
    expect(c.unhover).not.toHaveBeenCalled()
    c.rerender(null)
    expect(c.unhover).toHaveBeenCalledTimes(1)
  })

  it('a table row without points removes the label of the previous row once', () => {
    const c = setup({ rowId: 3, origin: 'table' })
    c.rerender({ rowId: 99, origin: 'table' })
    c.rerender({ rowId: 98, origin: 'table' })
    expect(c.unhover).toHaveBeenCalledTimes(1)
  })
})
