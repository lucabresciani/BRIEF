import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { colLetter, type GridRange } from '@/domain/import/a1'
import { NATIVE } from '@/domain/model'
import { cn } from '@/lib/utils'
import { BlockOverlay } from './BlockOverlay'
import { BODY_TOP, COL_W, GUTTER_W, HEAD_H, ROW_H } from './geometry'
import { blockAt, sheetA1, type ClickMode, type PickerSheet } from './pickerState'

/** A press that moves farther than this draws a rectangle instead of clicking a block. */
const DRAG_THRESHOLD = 4
/** Auto-scroll while drawing: a band this wide inside each edge, up to this many px per frame. */
const EDGE = 32
const MAX_SPEED = 22

export interface SheetGridHandle {
  /** Scrolls a range (grid coordinates) into view and puts the keyboard cursor on its first cell. */
  reveal: (range: GridRange) => void
  /** The focusable grid element (the dialog's initial focus). */
  element: () => HTMLElement | null
}

export interface SheetGridProps {
  sheet: PickerSheet
  label: string
  /** Selected blocks (by id) and selected drawn ranges. */
  selectedBlocks: ReadonlySet<string>
  drawn: readonly { key: string; range: GridRange }[]
  onBlock: (blockId: string, mode: ClickMode) => void
  onRange: (range: GridRange, additive: boolean) => void
  onSelectAll: () => void
  /** Clears the selection; false when there was nothing to clear (Escape then closes the dialog). */
  onClear: () => boolean
  /** Text for the live region (the rectangle being marked with Shift+arrows). */
  onAnnounce: (text: string) => void
  rectText: (a1: string) => string
}

interface Cell {
  r: number
  c: number
}
const rangeOf = (a: Cell, b: Cell): GridRange => ({
  r0: Math.min(a.r, b.r),
  c0: Math.min(a.c, b.c),
  r1: Math.max(a.r, b.r),
  c1: Math.max(a.c, b.c),
})
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const inRange = (g: GridRange, r: number, c: number) => r >= g.r0 && r <= g.r1 && c >= g.c0 && c <= g.c1

/**
 * The sheet, virtualised on both axes over one scroll element (only the cells in view exist), with the
 * sheet's own coordinates: column letters from the sheet origin and sheet row numbers. Empty cells are
 * not rendered (the grid lines are a background); merged areas span from their anchor. Blocks are drawn
 * by BlockOverlay. Pointer: a click selects the block under it (Ctrl/Cmd toggles, Shift extends); a press
 * that moves more than 4 px draws a rectangle, scrolling at the edges. Keyboard: arrows move the cursor,
 * Shift+arrows mark a rectangle, Enter adds it, Space toggles the block under the cursor, Ctrl/Cmd+A
 * selects every table, Escape clears.
 */
export const SheetGrid = forwardRef<SheetGridHandle, SheetGridProps>(function SheetGrid(props, ref) {
  const { sheet, selectedBlocks, drawn } = props
  const scrollRef = useRef<HTMLDivElement>(null)
  const gridId = useId()
  const first = sheet.blocks.find((b) => b.kind === 'table' || b.kind === 'matrix') ?? sheet.blocks[0]
  const [cursor, setCursor] = useState<Cell>(() => ({ r: first?.range.r0 ?? 0, c: first?.range.c0 ?? 0 }))
  const [kbAnchor, setKbAnchor] = useState<Cell | null>(null)
  const [dragRect, setDragRect] = useState<GridRange | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const drag = useRef<{
    pointerId: number
    start: Cell
    x0: number
    y0: number
    x: number
    y: number
    moved: boolean
    /** A finger: moving scrolls the sheet natively (no rectangle), a tap selects. */
    touch: boolean
  } | null>(null)
  const raf = useRef(0)

  const rowV = useVirtualizer({
    count: sheet.rows,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    scrollMargin: BODY_TOP,
    overscan: 6,
    initialRect: { width: 900, height: 480 },
  })
  const colV = useVirtualizer({
    horizontal: true,
    count: sheet.cols,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => COL_W,
    scrollMargin: GUTTER_W,
    overscan: 3,
    initialRect: { width: 900, height: 480 },
  })
  const rowItems = rowV.getVirtualItems()
  const colItems = colV.getVirtualItems()
  const view: GridRange | null =
    rowItems.length && colItems.length
      ? {
          r0: rowItems[0]!.index,
          r1: rowItems.at(-1)!.index,
          c0: colItems[0]!.index,
          c1: colItems.at(-1)!.index,
        }
      : null

  // Merged areas in view: covered cells are not drawn; the anchor spans the area.
  const { anchors, covered, offscreen } = useMemo(() => {
    const anchors = new Map<string, GridRange>()
    const covered = new Set<string>()
    const offscreen: GridRange[] = []
    if (!view) return { anchors, covered, offscreen }
    for (const m of sheet.merges) {
      if (m.r1 < view.r0 || m.r0 > view.r1 || m.c1 < view.c0 || m.c0 > view.c1) continue
      if (inRange(view, m.r0, m.c0)) anchors.set(`${m.r0},${m.c0}`, m)
      else offscreen.push(m)
      for (let r = Math.max(m.r0, view.r0); r <= Math.min(m.r1, view.r1); r++)
        for (let c = Math.max(m.c0, view.c0); c <= Math.min(m.c1, view.c1); c++)
          if (r !== m.r0 || c !== m.c0) covered.add(`${r},${c}`)
    }
    return { anchors, covered, offscreen }
    // The window, not its object identity, decides what is in view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet, view?.r0, view?.r1, view?.c0, view?.c1])

  const kbRect = kbAnchor ? rangeOf(kbAnchor, cursor) : null
  const { onAnnounce, rectText } = props
  const kbA1 = kbRect ? sheetA1(sheet, kbRect) : null
  // Emptied once the rectangle is added or dropped, so the live region never repeats a stale range.
  useEffect(() => {
    onAnnounce(kbA1 ? rectText(kbA1) : '')
  }, [kbA1, onAnnounce, rectText])
  useEffect(() => () => cancelAnimationFrame(raf.current), [])

  const scrollToCell = (cell: Cell) => {
    const el = scrollRef.current
    if (!el) return
    const x = GUTTER_W + cell.c * COL_W
    const y = BODY_TOP + cell.r * ROW_H
    if (x - GUTTER_W < el.scrollLeft) el.scrollLeft = x - GUTTER_W
    else if (x + COL_W > el.scrollLeft + el.clientWidth) el.scrollLeft = x + COL_W - el.clientWidth
    if (y - HEAD_H < el.scrollTop) el.scrollTop = y - HEAD_H
    else if (y + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = y + ROW_H - el.clientHeight
  }

  useImperativeHandle(ref, () => ({
    element: () => scrollRef.current,
    reveal(range) {
      const el = scrollRef.current
      if (!el) return
      const x = GUTTER_W + range.c0 * COL_W
      const y = BODY_TOP + range.r0 * ROW_H
      const w = (range.c1 - range.c0 + 1) * COL_W
      const h = (range.r1 - range.r0 + 1) * ROW_H
      const fits =
        x - GUTTER_W >= el.scrollLeft &&
        x + Math.min(w, el.clientWidth - GUTTER_W) <= el.scrollLeft + el.clientWidth &&
        y - HEAD_H >= el.scrollTop &&
        y + Math.min(h, el.clientHeight - HEAD_H) <= el.scrollTop + el.clientHeight
      // A little room above and left of the block, for its label.
      if (!fits) {
        el.scrollLeft = Math.max(0, x - GUTTER_W - COL_W / 2)
        el.scrollTop = Math.max(0, y - HEAD_H - ROW_H)
      }
      setCursor({ r: range.r0, c: range.c0 })
      setKbAnchor(null)
    },
  }))

  /** The cell under a pointer (clamped to the sheet), or null over the headers and scrollbars. */
  const cellAt = (clientX: number, clientY: number, strict: boolean): Cell | null => {
    const el = scrollRef.current
    if (!el || sheet.rows === 0 || sheet.cols === 0) return null
    const rect = el.getBoundingClientRect()
    const lx = clientX - rect.left - el.clientLeft
    const ly = clientY - rect.top - el.clientTop
    if (strict && (lx < GUTTER_W || ly < HEAD_H || lx >= el.clientWidth || ly >= el.clientHeight)) return null
    const r = Math.floor((ly + el.scrollTop - BODY_TOP) / ROW_H)
    const c = Math.floor((lx + el.scrollLeft - GUTTER_W) / COL_W)
    if (strict && (r < 0 || c < 0 || r >= sheet.rows || c >= sheet.cols)) return null
    return { r: clamp(r, 0, sheet.rows - 1), c: clamp(c, 0, sheet.cols - 1) }
  }

  const updateDrag = () => {
    const d = drag.current
    if (!d) return
    const cell = cellAt(d.x, d.y, false)
    if (!cell) return
    setDragRect(rangeOf(d.start, cell))
    setCursor(cell)
  }

  // Edge auto-scroll: the speed grows with the depth into the edge band (and past it), so the sheet
  // keeps moving under a still pointer and slows as the pointer comes back.
  const tick = () => {
    const d = drag.current
    const el = scrollRef.current
    if (!d?.moved || !el) {
      raf.current = 0
      return
    }
    const rect = el.getBoundingClientRect()
    const top = rect.top + HEAD_H
    const left = rect.left + GUTTER_W
    const bottom = rect.top + el.clientHeight
    const right = rect.left + el.clientWidth
    const speed = (depth: number) => Math.min(MAX_SPEED, (Math.max(0, depth) / EDGE) * MAX_SPEED)
    const dy =
      d.y < top + EDGE ? -speed(top + EDGE - d.y) : d.y > bottom - EDGE ? speed(d.y - bottom + EDGE) : 0
    const dx =
      d.x < left + EDGE ? -speed(left + EDGE - d.x) : d.x > right - EDGE ? speed(d.x - right + EDGE) : 0
    if (dx || dy) {
      el.scrollBy(dx, dy)
      updateDrag()
    }
    raf.current = requestAnimationFrame(tick)
  }

  const endDrag = () => {
    drag.current = null
    cancelAnimationFrame(raf.current)
    raf.current = 0
    setDragRect(null)
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || drag.current) return
    const cell = cellAt(e.clientX, e.clientY, true)
    if (!cell) return
    const touch = e.pointerType === 'touch'
    if (!touch) e.preventDefault() // no text selection; focus is set below
    scrollRef.current?.focus({ preventScroll: true })
    // Feedback on press: the cursor moves at once, the selection follows on release.
    setCursor(cell)
    setKbAnchor(null)
    if (!touch) e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = {
      pointerId: e.pointerId,
      start: cell,
      x0: e.clientX,
      y0: e.clientY,
      x: e.clientX,
      y: e.clientY,
      moved: false,
      touch,
    }
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) {
      if (e.pointerType !== 'mouse') return
      const cell = cellAt(e.clientX, e.clientY, true)
      const b = cell ? blockAt(sheet, cell.r, cell.c) : null
      if ((b?.id ?? null) !== hover) setHover(b?.id ?? null)
      return
    }
    d.x = e.clientX
    d.y = e.clientY
    if (!d.moved && Math.hypot(d.x - d.x0, d.y - d.y0) <= DRAG_THRESHOLD) return
    if (d.touch) return endDrag()
    if (!d.moved) {
      d.moved = true
      raf.current = requestAnimationFrame(tick)
    }
    updateDrag()
  }

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    const additive = e.ctrlKey || e.metaKey || e.shiftKey
    const end = cellAt(e.clientX, e.clientY, false) ?? d.start
    const moved = d.moved
    endDrag()
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (moved) {
      props.onRange(rangeOf(d.start, end), additive)
      return
    }
    const b = blockAt(sheet, d.start.r, d.start.c)
    if (b) props.onBlock(b.id, e.shiftKey ? 'range' : e.ctrlKey || e.metaKey ? 'toggle' : 'single')
    else if (!additive) props.onClear()
  }

  const toggleAtCursor = () => {
    const b = blockAt(sheet, cursor.r, cursor.c)
    if (b) props.onBlock(b.id, 'toggle')
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const mod = e.ctrlKey || e.metaKey
    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      props.onSelectAll()
      return
    }
    const el = scrollRef.current
    const page = el ? Math.max(1, Math.floor((el.clientHeight - HEAD_H) / ROW_H) - 1) : 10
    const steps: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
      PageUp: [-page, 0],
      PageDown: [page, 0],
    }
    let next: Cell | null = null
    if (steps[e.key]) {
      const [dr, dc] = steps[e.key]!
      next = { r: clamp(cursor.r + dr, 0, sheet.rows - 1), c: clamp(cursor.c + dc, 0, sheet.cols - 1) }
    } else if (e.key === 'Home') next = mod ? { r: 0, c: 0 } : { r: cursor.r, c: 0 }
    else if (e.key === 'End')
      next = mod ? { r: sheet.rows - 1, c: sheet.cols - 1 } : { r: cursor.r, c: sheet.cols - 1 }
    if (next) {
      e.preventDefault()
      if (e.shiftKey) setKbAnchor((a) => a ?? cursor)
      else setKbAnchor(null)
      setCursor(next)
      scrollToCell(next)
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (kbRect) {
        props.onRange(kbRect, true)
        setKbAnchor(null)
      } else toggleAtCursor()
    } else if (e.key === ' ') {
      e.preventDefault()
      toggleAtCursor()
    } else if (e.key === 'Escape') {
      // Consumed while there is something to cancel; otherwise the dialog closes as usual.
      if (drag.current) endDrag()
      else if (kbAnchor) setKbAnchor(null)
      else if (!props.onClear()) return
      e.preventDefault()
      e.stopPropagation()
    }
  }

  const isSelectedCell = (r: number, c: number) => {
    const b = blockAt(sheet, r, c)
    if (b && selectedBlocks.has(b.id)) return true
    return drawn.some((d) => inRange(d.range, r, c))
  }
  const cellId = (r: number, c: number) => `${gridId}-${r}-${c}`
  // The cursor inside a merged area is on its anchor (the only cell drawn there).
  const cursorMerge = covered.has(`${cursor.r},${cursor.c}`)
    ? sheet.merges.find((m) => inRange(m, cursor.r, cursor.c))
    : undefined
  const active = cursorMerge ? { r: cursorMerge.r0, c: cursorMerge.c0 } : cursor
  const cursorShown = view !== null && inRange(view, active.r, active.c)
  const totalW = GUTTER_W + sheet.cols * COL_W
  const totalH = BODY_TOP + sheet.rows * ROW_H

  const cellNode = (r: number, c: number, left: number, merge: GridRange | undefined, hidden = false) => {
    const text = sheet.text(r, c)
    const isCursor = merge ? inRange(merge, cursor.r, cursor.c) : cursor.r === r && cursor.c === c
    const k = sheet.kind(r, c)
    const numeric = k === NATIVE.number || k === NATIVE.date || k === NATIVE.boolean
    const w = merge ? (merge.c1 - merge.c0 + 1) * COL_W : COL_W
    const h = merge ? (merge.r1 - merge.r0 + 1) * ROW_H : ROW_H
    return (
      <div
        key={c}
        role={hidden ? undefined : 'gridcell'}
        id={hidden ? undefined : cellId(r, c)}
        aria-colindex={hidden ? undefined : c + 2}
        aria-selected={hidden ? undefined : isSelectedCell(r, c)}
        aria-hidden={hidden || undefined}
        title={text.length > 12 ? text : undefined}
        className={cn(
          'absolute top-0 truncate px-1.5 text-[0.78rem] leading-6',
          numeric ? 'text-right font-mono tabular-nums' : 'text-left',
          merge && 'bg-background ring-1 ring-border ring-inset',
          // The keyboard cursor shows while the grid has keyboard focus (a mouse user sees the outlines).
          isCursor &&
            'z-[6] group-focus-visible/grid:outline-2 group-focus-visible/grid:-outline-offset-2 group-focus-visible/grid:outline-ring',
        )}
        style={{ left, width: w, height: h }}
      >
        {text}
      </div>
    )
  }

  return (
    <>
      <div
        ref={scrollRef}
        role="grid"
        aria-label={props.label}
        aria-rowcount={sheet.rows + 1}
        aria-colcount={sheet.cols + 1}
        aria-multiselectable="true"
        aria-activedescendant={cursorShown ? cellId(active.r, active.c) : undefined}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={endDrag}
        onLostPointerCapture={() => drag.current && endDrag()}
        onPointerLeave={() => hover && setHover(null)}
        data-testid="sheet-grid"
        className={cn(
          'peer group/grid relative h-full touch-manipulation overflow-auto overscroll-contain bg-background outline-none select-none',
          hover ? 'cursor-pointer' : 'cursor-cell',
        )}
      >
        <div style={{ position: 'relative', width: totalW, height: totalH }}>
          {/* Grid lines of every cell, drawn once as a background instead of one border per cell. */}
          <div
            aria-hidden
            className="pointer-events-none absolute"
            style={{
              top: BODY_TOP,
              left: GUTTER_W,
              width: sheet.cols * COL_W,
              height: sheet.rows * ROW_H,
              backgroundImage:
                'linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px)',
              backgroundSize: `${COL_W}px ${ROW_H}px`,
            }}
          />
          <div
            role="row"
            aria-rowindex={1}
            className="sticky top-0 z-20 border-b border-border bg-panel-sunken"
            style={{ height: HEAD_H, width: totalW }}
          >
            <div
              role="columnheader"
              aria-label={props.label}
              className="sticky left-0 z-30 h-full border-r border-border bg-panel-sunken"
              style={{ width: GUTTER_W }}
            />
            {colItems.map((ci) => (
              <div
                key={ci.index}
                role="columnheader"
                aria-colindex={ci.index + 2}
                className={cn(
                  'absolute top-0 h-full border-r border-border text-center text-xs leading-6 text-muted-foreground',
                  ci.index === cursor.c && 'bg-selection font-medium text-foreground',
                )}
                style={{ left: ci.start, width: COL_W }}
              >
                {colLetter(sheet.origin.col + ci.index)}
              </div>
            ))}
          </div>
          {rowItems.map((ri) => {
            const r = ri.index
            return (
              <div
                key={r}
                role="row"
                aria-rowindex={r + 2}
                className="absolute left-0"
                style={{ top: ri.start, height: ROW_H, width: totalW }}
              >
                <div
                  role="rowheader"
                  className={cn(
                    'sticky left-0 z-10 h-full border-r border-b border-border bg-panel-sunken pr-1.5 text-right font-mono text-xs leading-6 text-muted-foreground tabular-nums',
                    r === cursor.r && 'bg-selection font-medium text-foreground',
                  )}
                  style={{ width: GUTTER_W }}
                >
                  {sheet.sheetRow(r)}
                </div>
                {colItems.map((ci) => {
                  const c = ci.index
                  const key = `${r},${c}`
                  if (covered.has(key)) return null
                  const merge = anchors.get(key)
                  if (!merge && !(cursor.r === r && cursor.c === c) && sheet.text(r, c) === '') return null
                  return cellNode(r, c, ci.start, merge)
                })}
              </div>
            )
          })}
          {/* Merged areas whose anchor scrolled out of view still show their value. */}
          {offscreen.map((m) => (
            <div
              key={`m${m.r0},${m.c0}`}
              className="absolute"
              style={{ top: BODY_TOP + m.r0 * ROW_H, left: 0, height: ROW_H, width: totalW }}
            >
              {cellNode(m.r0, m.c0, GUTTER_W + m.c0 * COL_W, m, true)}
            </div>
          ))}
          <BlockOverlay
            sheet={sheet}
            view={view}
            selectedBlocks={selectedBlocks}
            drawn={drawn}
            hover={hover}
            marking={dragRect ?? kbRect}
          />
        </div>
      </div>
      {/* The focus ring above the sticky headers, which would hide its top and left edges. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-30 peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-inset"
      />
    </>
  )
})
