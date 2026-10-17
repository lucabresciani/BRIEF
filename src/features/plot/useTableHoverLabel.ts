import { useEffect, useRef, type RefObject } from 'react'
import type { SelectionMap } from '@/domain/derive/types'
import type { PlotCanvasHandle } from '@/plot/PlotCanvas'

/**
 * Table → plot hover label: hovering (or moving the keyboard focus to) a table row shows the hover
 * label of its points. Only a label put there by the table is removed again. Hovering a point on the
 * plot also sets hoverRow (origin 'plot', to highlight its table row); removing the label then would
 * erase Plotly's own label as soon as it appears.
 */
export function useTableHoverLabel(
  canvas: RefObject<Pick<PlotCanvasHandle, 'hover' | 'unhover'> | null>,
  hoverRow: { rowId: number; origin: 'plot' | 'table' } | null,
  byRow: SelectionMap['byRow'],
): void {
  const shownByTable = useRef(false)
  useEffect(() => {
    const targets = hoverRow?.origin === 'table' ? byRow.get(hoverRow.rowId) : undefined
    if (targets?.length) {
      canvas.current?.hover(targets)
      shownByTable.current = true
    } else if (shownByTable.current) {
      canvas.current?.unhover()
      shownByTable.current = false
    }
  }, [canvas, hoverRow, byRow])
}
