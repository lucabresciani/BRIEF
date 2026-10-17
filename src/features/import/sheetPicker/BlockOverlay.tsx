import type { GridRange } from '@/domain/import/a1'
import type { DetectedBlock } from '@/domain/import/blocks'
import { cn } from '@/lib/utils'
import { BODY_TOP, COL_W, GUTTER_W, ROW_H } from './geometry'
import { chipText, type PickerSheet } from './pickerState'

const CHIP_H = 16
const isTable = (b: DetectedBlock) => b.kind === 'table' || b.kind === 'matrix'
const overlaps = (a: GridRange, b: GridRange) => a.r0 <= b.r1 && a.r1 >= b.r0 && a.c0 <= b.c1 && a.c1 >= b.c0

/** Position of a range in the grid's content box (the headers included), in px. */
function box(range: GridRange) {
  return {
    left: GUTTER_W + range.c0 * COL_W,
    top: BODY_TOP + range.r0 * ROW_H,
    width: (range.c1 - range.c0 + 1) * COL_W,
    height: (range.r1 - range.r0 + 1) * ROW_H,
  }
}

/**
 * Outlines of the blocks in view (culled to the visible window: a sheet can hold hundreds), each table
 * with a label chip above it; selected = a tint and a 2 px border, colour never alone (the chip turns
 * solid and the cells report aria-selected). Join hints are dotted, the rectangle being marked is dashed.
 * Decorative for assistive technology: the list beside the grid carries the same information.
 */
export function BlockOverlay({
  sheet,
  view,
  selectedBlocks,
  drawn,
  hover,
  marking,
}: {
  sheet: PickerSheet
  view: GridRange | null
  selectedBlocks: ReadonlySet<string>
  drawn: readonly { key: string; range: GridRange }[]
  hover: string | null
  marking: GridRange | null
}) {
  if (!view) return null
  // One more row on each side of the window: a chip sits in the empty row above its block.
  const near = { ...view, r0: Math.max(0, view.r0 - 1), r1: view.r1 + 1 }
  const shown = sheet.blocks.map((b, i) => ({ b, n: i + 1 })).filter(({ b }) => overlaps(b.range, near))
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-[5]">
      {shown.map(({ b }) =>
        b.hints.map((h) =>
          overlaps(h.range, near) ? (
            <div
              key={`${b.id}-${h.with}`}
              className="absolute rounded-[3px] border-[1.5px] border-dotted border-warning"
              style={box(h.range)}
            />
          ) : null,
        ),
      )}
      {shown.map(({ b, n }) => {
        const on = selectedBlocks.has(b.id)
        const hot = hover === b.id
        const table = isTable(b)
        const pos = box(b.range)
        const chip = table || on || hot
        return (
          <div key={b.id} data-block={b.id} data-selected={on || undefined}>
            <div
              className={cn(
                'absolute rounded-[3px] transition-[border-color,background-color] duration-120 ease-out motion-reduce:transition-none',
                on
                  ? 'border-2 border-primary bg-primary/[0.07]'
                  : table
                    ? 'border border-muted-foreground/70'
                    : 'border border-dashed border-muted-foreground/70',
                !on && hot && 'border-primary bg-primary/[0.03]',
              )}
              style={pos}
            />
            {chip ? (
              <div
                className={cn(
                  'absolute truncate rounded-[3px] border px-1 text-2xs leading-[14px] font-medium',
                  on
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-muted-foreground/70 bg-background text-foreground',
                )}
                // Above the block: in the empty row that separates it from the one above, or in the band above
                // the first sheet row.
                style={{
                  left: pos.left,
                  top: pos.top - CHIP_H - 1,
                  height: CHIP_H,
                  maxWidth: Math.max(pos.width, COL_W),
                }}
              >
                {chipText(b, n)}
              </div>
            ) : null}
          </div>
        )
      })}
      {drawn.map((d) =>
        overlaps(d.range, near) ? (
          <div
            key={d.key}
            data-drawn={d.key}
            className="absolute rounded-[3px] border-2 border-primary bg-primary/[0.07]"
            style={box(d.range)}
          />
        ) : null,
      )}
      {marking ? (
        <div
          data-marking
          className="absolute rounded-[3px] border-2 border-dashed border-primary bg-primary/[0.04]"
          style={box(marking)}
        />
      ) : null}
    </div>
  )
}
