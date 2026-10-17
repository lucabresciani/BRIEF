import { describe, expect, it } from 'vitest'
import type { ColumnId, FitStyle } from '@/domain/model'
import { deserializeProject } from '@/domain/project/deserialize'
import { serializeProject } from '@/domain/project/serialize'
import {
  FIT,
  SERIES,
  column,
  fit,
  loadTestProject,
  notebook,
  plotWith,
  xySeries,
} from '@/features/inspector/testFixtures'
import { deriveNow } from '../derived'
import { undo, useProjectStore } from '../projectStore'
import { updateFit } from './analysis'
import { resetGroupStyles, setGroupStyle, setSeriesSplit } from './plot'

const data = () =>
  notebook(
    {
      x: ['1', '2', '3', '1', '2', '3'],
      y: ['1', '2', '3.5', '2', '4', '5.5'],
      g: ['A', 'A', 'A', 'B', 'B', 'B'],
      h: ['p', 'q', 'p', 'q', 'p', 'q'],
    },
    [column('x'), column('y'), column('g', { kind: 'categorical' }), column('h', { kind: 'categorical' })],
  )
const doc = () => useProjectStore.getState().doc
const split = () => doc().plots[0].series[0].split
const names = { name: 'y', column: 'g' }

describe('updateFit', () => {
  it('stores the line style and the per-group switch (both were ignored before)', () => {
    loadTestProject(data(), plotWith({ series: [xySeries('x', 'y')] }), { fits: [fit({ type: 'linear' })] })
    const style: FitStyle = { color: { mode: 'palette', index: 6 }, dash: 'dot', width: 3 }
    updateFit(FIT, { style })
    expect(doc().fits[0].style).toEqual(style)
    updateFit(FIT, { perGroup: true })
    expect(doc().fits[0].perGroup).toBe(true)
    // The other fields stay as they were.
    expect(doc().fits[0].style).toEqual(style)
    expect(doc().fits[0].model).toEqual({ type: 'linear' })
    undo()
    expect(doc().fits[0].perGroup).toBe(false)
  })

  it('perGroup on a split series gives one fit per group and no pooled fit', () => {
    loadTestProject(
      data(),
      plotWith({ series: [{ ...xySeries('x', 'y'), split: { column: 'g' as ColumnId, overrides: [] } }] }),
      { fits: [fit({ type: 'linear' })] },
    )
    expect(deriveNow().series[0].fit?.status).toBe('ok')
    updateFit(FIT, { perGroup: true })
    const s = deriveNow().series[0]
    expect(s.fit).toBeNull()
    expect(s.split?.groups.map((g) => g.fit?.status)).toEqual(['ok', 'ok'])
  })
})

describe('setSeriesSplit', () => {
  it('splits, keeps the overrides while the column stays, drops them for another column, and un-splits', () => {
    loadTestProject(data(), plotWith({ series: [xySeries('x', 'y')] }))
    setSeriesSplit(SERIES, 'g' as ColumnId, names)
    expect(split()).toEqual({ column: 'g', overrides: [] })
    setGroupStyle(SERIES, 'A', { paletteIndex: 4 })
    setSeriesSplit(SERIES, 'g' as ColumnId, names)
    expect(split()?.overrides).toEqual([{ key: 'A', paletteIndex: 4, symbol: 'auto' }])
    setSeriesSplit(SERIES, 'h' as ColumnId, { name: 'y', column: 'h' })
    expect(split()).toEqual({ column: 'h', overrides: [] })
    setSeriesSplit(SERIES, null, { name: 'y', column: '' })
    expect(split()).toBeNull()
    const ops = useProjectStore.getState().past.map((e) => e.op)
    expect(ops.filter((o) => o === 'series.split')).toHaveLength(3)
  })
})

describe('setGroupStyle', () => {
  it('keeps the position of an override, merges fields, and removes it when both are automatic', () => {
    loadTestProject(
      data(),
      plotWith({
        series: [
          {
            ...xySeries('x', 'y'),
            split: {
              column: 'g' as ColumnId,
              overrides: [
                { key: 'B', paletteIndex: 1, symbol: 'auto' },
                { key: 'A', paletteIndex: null, symbol: 'x' },
              ],
            },
          },
        ],
      }),
    )
    setGroupStyle(SERIES, 'B', { symbol: 'diamond' })
    expect(split()?.overrides).toEqual([
      { key: 'B', paletteIndex: 1, symbol: 'diamond' },
      { key: 'A', paletteIndex: null, symbol: 'x' },
    ])
    setGroupStyle(SERIES, 'A', { symbol: 'auto' })
    expect(split()?.overrides).toEqual([{ key: 'B', paletteIndex: 1, symbol: 'diamond' }])
    resetGroupStyles(SERIES)
    expect(split()?.overrides).toEqual([])
  })

  it('does nothing on a series that is not split', () => {
    loadTestProject(data(), plotWith({ series: [xySeries('x', 'y')] }))
    const before = doc()
    setGroupStyle(SERIES, 'A', { paletteIndex: 2 })
    expect(doc()).toBe(before)
  })
})

describe('saved and reopened (.sciplot)', () => {
  it('keeps the split, the group overrides (the no-value group and the x marker) and the fit style', () => {
    const empty = data()
    loadTestProject(
      { ...empty, cells: { ...empty.cells, g: ['A', 'A', '', 'B', 'B', ''] } },
      plotWith({ series: [xySeries('x', 'y')] }),
      { fits: [fit({ type: 'linear' })] },
    )
    setSeriesSplit(SERIES, 'g' as ColumnId, names)
    setGroupStyle(SERIES, '', { paletteIndex: 7, symbol: 'x' })
    updateFit(FIT, { style: { color: { mode: 'palette', index: 3 }, dash: 'longdashdot', width: 2.5 } })
    updateFit(FIT, { perGroup: true })
    const saved = doc()
    const reopened = deserializeProject(serializeProject(saved, {}, [], 'test'))
    expect(reopened.ok).toBe(true)
    if (!reopened.ok) return
    expect(reopened.value.doc.plots[0].series[0].split).toEqual({
      column: 'g',
      overrides: [{ key: '', paletteIndex: 7, symbol: 'x' }],
    })
    expect(reopened.value.doc.fits[0]).toMatchObject({
      style: { color: { mode: 'palette', index: 3 }, dash: 'longdashdot', width: 2.5 },
      perGroup: true,
    })
  })
})
