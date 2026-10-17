import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Selection } from '@/domain/derive/types'
import type { DatasetId, PlotSpec } from '@/domain/model'
import { buildFigure } from './buildFigure'
import type { FigureOut } from './context'
import { buildSelectionMap, rowsFromPlotlyPoints, selectedIndicesForTrace } from './selectionMap'
import { deriveOnce, exclusionOf, figureContext, fitOf, importCsv, plotOf, series } from './testing'

const DS = 'ds_a' as DatasetId
const sel = (rows: number[], datasetId = DS, origin: Selection['origin'] = 'table'): Selection => ({
  datasetId,
  rowIds: new Set(rows),
  origin,
  anchor: null,
})

describe('buildSelectionMap / rowsFromPlotlyPoints / selectedIndicesForTrace', () => {
  const map = buildSelectionMap([
    { uid: 's__points', rowIds: [5, 7, -1, 9], datasetId: DS },
    { uid: 'p__histogram', rowIds: [-1, 3], members: [[1, 2, 4], [3]], datasetId: DS },
    { uid: 'o__points', rowIds: [5], datasetId: 'ds_b' as DatasetId },
  ])

  it('maps both directions; line breaks (−1) are not rows', () => {
    expect([...map.byTrace.get('s__points')!]).toEqual([5, 7, -1, 9])
    expect(map.byRow.get(7)).toEqual([{ uid: 's__points', pointIndex: 1 }])
    expect(map.byRow.get(-1)).toBeUndefined()
    // Multi-row points: every member row maps to the bin.
    expect(map.byRow.get(2)).toEqual([{ uid: 'p__histogram', pointIndex: 0 }])
    expect(map.byRow.get(3)).toEqual([{ uid: 'p__histogram', pointIndex: 1 }])
    // RowIds are per dataset: the same number may appear in another dataset's trace.
    expect(map.byRow.get(5)).toEqual([
      { uid: 's__points', pointIndex: 0 },
      { uid: 'o__points', pointIndex: 0 },
    ])
  })

  it('reads customdata[0] first, then the map (pointIndex, else pointNumber), and member rows for bins', () => {
    const rows = rowsFromPlotlyPoints(
      [
        { data: { uid: 's__points' }, pointIndex: 0, customdata: [42, 3, 'x', 'y'] },
        { data: { uid: 's__points' }, pointIndex: 1 },
        { data: { uid: 's__points' }, pointNumber: 3 },
        { data: { uid: 's__points' }, pointIndex: 2 }, // a break
        { data: { uid: 'p__histogram' }, pointIndex: 0, customdata: [99] }, // bins: members win
        { data: { uid: 's__points' }, pointIndex: 1 }, // duplicate
        { data: { uid: 'unknown' }, pointIndex: 0 },
        { pointIndex: 0, customdata: 11 },
      ],
      map,
    )
    expect(rows).toEqual([42, 7, 9, 1, 2, 4, 11])
  })

  it('selectedpoints: null without a selection (never []), null for another dataset, else indices', () => {
    expect(selectedIndicesForTrace('s__points', null, map)).toBeNull()
    expect(selectedIndicesForTrace('o__points', sel([5]), map)).toBeNull()
    expect(selectedIndicesForTrace('nope', sel([5]), map)).toBeNull()
    expect(selectedIndicesForTrace('s__points', sel([9, 5]), map)).toEqual([0, 3])
    expect(selectedIndicesForTrace('s__points', sel([100]), map)).toEqual([])
    expect(selectedIndicesForTrace('p__histogram', sel([4]), map)).toEqual([0])
    expect(selectedIndicesForTrace('p__histogram', sel([3, 1]), map)).toEqual([0, 1])
  })
})

/** For every selectable point: plot → rows → table selection → the same point is selected again. */
function roundTrip(fig: FigureOut, datasetId: DatasetId): number {
  let checked = 0
  for (const trace of fig.data as { uid?: string; customdata?: unknown[]; x?: unknown[] }[]) {
    const uid = trace.uid!
    const rows = fig.selectionMap.byTrace.get(uid)
    if (!rows) continue
    for (let j = 0; j < rows.length; j++) {
      const picked = rowsFromPlotlyPoints(
        [{ data: { uid }, pointIndex: j, customdata: trace.customdata?.[j] }],
        fig.selectionMap,
      )
      if (picked.length === 0) {
        expect(rows[j]).toBe(-1) // only line breaks map to nothing
        continue
      }
      const back = selectedIndicesForTrace(uid, sel(picked, datasetId), fig.selectionMap)
      expect(back).toContain(j)
      for (const r of picked) expect(fig.selectionMap.byRow.get(r)).toContainEqual({ uid, pointIndex: j })
      checked++
    }
  }
  return checked
}

describe('round trip plot → table → plot on real figures', () => {
  const ohm = importCsv(readFileSync(resolve('src/examples/ohm.csv'), 'utf8'), 'ds_ohm')
  const pend = importCsv(readFileSync(resolve('src/examples/pendulum.csv'), 'utf8'), 'ds_pend')

  it('scatter points, excluded points and residuals', () => {
    const plot = plotOf({
      series: [series('ser_1', ohm, 'I', 'V')],
      scatter: { residualPanel: true, showExcluded: true },
    })
    const d = deriveOnce([ohm], plot, {
      fits: [fitOf('fit_1', 'ser_1')],
      exclusions: [exclusionOf('exc_1', ohm, [3])],
    })
    const fig = buildFigure(d, figureContext())
    expect(fig.data.map((t) => t.uid)).toEqual([
      'ser_1__fit',
      'ser_1__excluded',
      'ser_1__points',
      'ser_1__residuals',
    ])
    expect(roundTrip(fig, ohm.dataset.id)).toBe(1 + 9 + 9)
    // The excluded row 3 is selectable through its own trace.
    expect(fig.selectionMap.byRow.get(3)).toEqual([{ uid: 'ser_1__excluded', pointIndex: 0 }])
    // A point drawn in two panels maps to both.
    expect(fig.selectionMap.byRow.get(1)).toEqual([
      { uid: 'ser_1__points', pointIndex: 0 },
      { uid: 'ser_1__residuals', pointIndex: 0 },
    ])
  })

  it('a line sorted by x with a gap (missing value)', () => {
    const ds = importCsv('t (s),v (m/s)\n3,30\n1,10\n2,\n5,50\n4,40\n', 'ds_line')
    const plot: PlotSpec = plotOf({
      type: 'line',
      series: [series('ser_l', ds, 't', 'v')],
      line: { markers: true, sortByX: true },
    })
    const fig = buildFigure(deriveOnce([ds], plot), figureContext())
    const line = fig.data.find((t) => t.uid === 'ser_l__points') as { x: number[]; mode: string }
    expect(line.mode).toBe('lines+markers')
    expect(line.x).toEqual([1, NaN, 3, 4, 5]) // the missing v at t = 2 breaks the line
    expect([...fig.selectionMap.byTrace.get('ser_l__points')!]).toEqual([2, -1, 1, 5, 4])
    expect(roundTrip(fig, ds.dataset.id)).toBe(4)
  })

  it('histogram bins (member rows) and box observations', () => {
    const hist = plotOf({
      type: 'histogram',
      histogram: {
        datasetId: pend.dataset.id,
        value: pend.col('T'),
        bins: { mode: 'auto' },
        groupBy: null,
        groupMode: 'overlay',
      },
    })
    const fh = buildFigure(deriveOnce([pend], hist), figureContext())
    expect(roundTrip(fh, pend.dataset.id)).toBeGreaterThan(0)
    const members = [...fh.selectionMap.byRow.keys()].sort((a, b) => a - b)
    expect(members).toHaveLength(24)

    const box = plotOf({
      type: 'box',
      box: {
        datasetId: pend.dataset.id,
        value: pend.col('T'),
        groupBy: pend.col('observer'),
        points: 'all',
        showMean: false,
        colorByGroup: false,
      },
    })
    const fb = buildFigure(deriveOnce([pend], box), figureContext())
    expect(roundTrip(fb, pend.dataset.id)).toBe(24)
  })
})
