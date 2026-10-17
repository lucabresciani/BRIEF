import type { DerivedSeries } from '@/domain/derive/pipeline'
import { groupRanks } from '@/domain/figure/groups'
import { groupAppearance, seriesAppearance, SERIES_COLORS } from '@/domain/figure/palette'
import type { LineDash, MarkerSymbol } from '@/domain/model'
import { isNumeric } from './columnOptions'

export interface Look {
  color: string
  symbol: MarkerSymbol
  dash: LineDash
  open: boolean
}

/** Accessible names of SERIES_COLORS, in palette order (style.colors.*). */
export const COLOR_NAMES = [
  'blue',
  'vermillion',
  'bluishGreen',
  'reddishPurple',
  'ochre',
  'skyBlue',
  'wine',
  'black',
] as const

/** The palette slot a stored index is drawn with (an index past the palette cycles, as in the figure). */
export const paletteSlot = (index: number) => {
  const n = SERIES_COLORS.length
  const k = Number.isFinite(index) ? Math.floor(index) : 0
  return ((k % n) + n) % n
}

/**
 * The colours and markers of an XY plot as buildFigure draws them, for the swatches of the panels:
 * a series by seriesAppearance; a group of a split series by its rank among the plot's groups of that
 * column, with the series' own marker when the plot has several drawable series, its override first.
 * `auto` gives a group's look without its override (what "Automatic" stands for).
 */
export function xyAppearance(series: readonly DerivedSeries[]) {
  // The figure ranks and counts only the series whose x and y can be drawn (buildXY's `usable`).
  const usable = series.filter((s) => isNumeric(s.xColumn) && isNumeric(s.yColumn))
  const rankOf = groupRanks(usable)
  const several = usable.length > 1
  const ofSeries = (s: DerivedSeries): Look => ({
    ...seriesAppearance(s.index, s.spec.style),
    open: s.spec.style.open,
  })
  const ofGroup = (s: DerivedSeries, key: string, withOverride: boolean): Look => {
    const look = ofSeries(s)
    const override = withOverride ? s.spec.split?.overrides.find((o) => o.key === key) : undefined
    return {
      ...look,
      ...groupAppearance(rankOf(s, key), override, several ? look.symbol : undefined),
    }
  }
  return {
    /** Several drawable series: a group's automatic marker is its series' marker. */
    several,
    series: ofSeries,
    group: (s: DerivedSeries, key: string) => ofGroup(s, key, true),
    auto: (s: DerivedSeries, key: string) => ofGroup(s, key, false),
  }
}

export type XYAppearance = ReturnType<typeof xyAppearance>
