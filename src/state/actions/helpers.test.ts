import { describe, expect, it } from 'vitest'
import { SERIES_COLORS, seriesAppearance } from '@/domain/figure/palette'
import { DEFAULT_SERIES_STYLE } from '@/domain/model'
import { nextPaletteIndex } from './helpers'

const plotOf = (indices: number[]) => ({
  series: indices.map((paletteIndex) => ({ style: { paletteIndex } })),
})

describe('nextPaletteIndex', () => {
  it('takes the first of the 8 palette slots no series uses', () => {
    expect(SERIES_COLORS).toHaveLength(8)
    expect(nextPaletteIndex(plotOf([]))).toBe(0)
    expect(nextPaletteIndex(plotOf([0, 1, 3]))).toBe(2)
    // The 7th and 8th colours (wine, black) are handed out before the palette goes round.
    expect(nextPaletteIndex(plotOf([0, 1, 2, 3, 4, 5]))).toBe(6)
    expect(nextPaletteIndex(plotOf([0, 1, 2, 3, 4, 5, 6]))).toBe(7)
    // An index past the palette counts as the colour it is drawn with.
    expect(nextPaletteIndex(plotOf([8, 1]))).toBe(2)
  })

  it('with every slot taken the colours go round in series order: 56 series, 56 colour × symbol pairs', () => {
    const series: { style: { paletteIndex: number } }[] = []
    for (let k = 0; k < 57; k++) series.push({ style: { paletteIndex: nextPaletteIndex({ series }) } })
    expect(series.map((s) => s.style.paletteIndex)).toEqual(Array.from({ length: 57 }, (_, k) => k % 8))
    const pairs = series.map((s, k) => {
      const look = seriesAppearance(k, { ...DEFAULT_SERIES_STYLE, paletteIndex: s.style.paletteIndex })
      return `${look.color} ${look.symbol}`
    })
    expect(new Set(pairs.slice(0, 56)).size).toBe(56)
  })
})
