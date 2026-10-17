/**
 * Log axes act ONLY on the drawing (sample level 2 of pipeline.ts). Plotly silently drops values ≤ 0 on a log axis
 * and silently clips error bars whose lower end is ≤ 0; the figure builder counts both and reports them
 * (W_LOG_AXIS_HIDDEN, W_LOG_AXIS_BARS_CLIPPED, with the rows) instead. The analysed sample, statistics
 * and fits never see the axis scale: nothing here touches a SeriesData sample or a FitResult.
 */
import { issue } from '@/domain/model'
import type { AxisSpec, Issue, RowId } from '@/domain/model'

export type AxisScale = 'linear' | 'log'

/** True when a finite value can be drawn on an axis of this scale (log needs v > 0). */
export function drawableOn(v: number, scale: AxisScale): boolean {
  return Number.isFinite(v) && (scale !== 'log' || v > 0)
}

/**
 * True when the lower end of a drawn error bar is ≤ 0 on a log axis (Plotly clips it to the axis edge
 * and hides its cap). `minus` null = symmetric bar of half-length `plus`. NaN bars are not bars.
 */
export function lowerEndClipped(
  value: number,
  plus: number,
  minus: number | null,
  scale: AxisScale,
): boolean {
  if (scale !== 'log' || !(value > 0)) return false
  const down = minus ?? plus
  return Number.isFinite(down) && value - down <= 0
}

/** Rows hidden and bars clipped by log axes, deduplicated, for one figure. */
export class LogTally {
  readonly hidden = new Set<number>()
  readonly clipped = new Set<number>()
  /** Clipped bars (a group-mean bar counts once, although it stands for several rows). */
  clippedBars = 0

  hide(row: number): void {
    this.hidden.add(row)
  }

  clip(rows: number | readonly number[]): void {
    this.clippedBars++
    for (const r of typeof rows === 'number' ? [rows] : rows) this.clipped.add(r)
  }

  issues(): Issue[] {
    const out: Issue[] = []
    if (this.hidden.size > 0)
      out.push(issue('W_LOG_AXIS_HIDDEN', { count: this.hidden.size }, { rows: [...this.hidden] as RowId[] }))
    if (this.clippedBars > 0)
      out.push(
        issue('W_LOG_AXIS_BARS_CLIPPED', { count: this.clippedBars }, { rows: [...this.clipped] as RowId[] }),
      )
    return out
  }
}

/**
 * Plotly axis range from an AxisSpec range (data units). Log axes take log10 limits; a fixed range with
 * a limit ≤ 0 on a log axis, or an inverted / non-finite one, falls back to autorange with the issue.
 */
export function axisRange(
  range: AxisSpec['range'],
  scale: AxisScale,
): { range: [number, number] | null; issue: Issue | null } {
  if (range.mode !== 'fixed') return { range: null, issue: null }
  const { min, max } = range
  if (!Number.isFinite(min) || !Number.isFinite(max) || !(min < max))
    return { range: null, issue: issue('E_RANGE_INVERTED', { min, max }) }
  if (scale === 'log') {
    if (!(min > 0)) return { range: null, issue: issue('E_LOG_RANGE_NONPOSITIVE', { min, max }) }
    return { range: [Math.log10(min), Math.log10(max)], issue: null }
  }
  return { range: [min, max], issue: null }
}
