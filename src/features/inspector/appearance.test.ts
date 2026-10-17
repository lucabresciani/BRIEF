import { describe, expect, it } from 'vitest'
import { buildFigure } from '@/domain/figure/buildFigure'
import { figureContext, importCsv, plotOf, series, deriveOnce } from '@/domain/figure/testing'
import type { SplitSpec, XYSeriesSpec } from '@/domain/model'
import { DEFAULT_SERIES_STYLE } from '@/domain/model'
import { xyAppearance } from './appearance'

// The panels' swatches must show what the figure draws: compare with buildFigure's points traces.
const csv = 'x,y,z,g\n1,2,3,A\n2,4,5,B\n3,5,6,C\n4,7,8,A\n5,9,9,B\n6,11,13,C\n'
const ds = importCsv(csv, 'ds_1')

function check(list: XYSeriesSpec[], type: 'scatter' | 'line' = 'scatter') {
  const derived = deriveOnce([ds], plotOf({ type, series: list }))
  const fig = buildFigure(derived, figureContext())
  const markerOf = (uid: string) => {
    const tr = fig.data.find((d) => (d as { uid?: string }).uid === uid) as
      { marker?: { color?: string; symbol?: string } } | undefined
    if (!tr?.marker) throw new Error(`no trace ${uid}`)
    return { color: tr.marker.color, symbol: tr.marker.symbol }
  }
  const looks = xyAppearance(derived.series)
  let compared = 0
  for (const s of derived.series) {
    if (!s.split) {
      const look = looks.series(s)
      const symbol = look.open ? `${look.symbol}-open` : look.symbol
      expect(markerOf(`${s.spec.id}__points`)).toEqual({ color: look.color, symbol })
      compared++
      continue
    }
    for (const g of s.split.groups) {
      const look = looks.group(s, g.key)
      const symbol = look.open ? `${look.symbol}-open` : look.symbol
      expect(markerOf(`${s.spec.id}__${g.uid}__points`), `${s.spec.id} ${g.key}`).toEqual({
        color: look.color,
        symbol,
      })
      compared++
    }
  }
  return { looks, derived, compared }
}

const split = (overrides: SplitSpec['overrides'] = []): Partial<XYSeriesSpec> => ({
  split: { column: ds.col('g'), overrides },
})

describe('xyAppearance matches the figure', () => {
  it('one split series: colour and marker by group, an override first', () => {
    const { compared, looks, derived } = check([
      series('s1', ds, 'x', 'y', split([{ key: 'C', paletteIndex: 6, symbol: 'x' }])),
    ])
    expect(compared).toBe(3)
    // "Automatic" is the look without the override.
    expect(looks.auto(derived.series[0], 'C')).toMatchObject({ color: '#009E73', symbol: 'diamond' })
  })

  it('two series split by one column: the group colour, the series marker', () => {
    const { compared } = check([
      series('s1', ds, 'x', 'y', split()),
      series('s2', ds, 'x', 'z', { ...split(), style: { ...DEFAULT_SERIES_STYLE, paletteIndex: 1 } }),
    ])
    expect(compared).toBe(6)
  })

  it('a split series next to a plain hollow one, on a line plot', () => {
    const { compared } = check(
      [
        series('s1', ds, 'x', 'y', split([{ key: 'A', paletteIndex: null, symbol: 'square' }])),
        series('s2', ds, 'x', 'z', { style: { ...DEFAULT_SERIES_STYLE, paletteIndex: 4, open: true } }),
      ],
      'line',
    )
    expect(compared).toBe(4)
  })
})
