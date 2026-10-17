import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { freeze, produce } from 'immer'
import type {
  ColumnId,
  ColumnMeta,
  DatasetId,
  ExclusionId,
  FitId,
  ImportedDataset,
  NotebookDataset,
  PlotId,
  ProjectDoc,
  RowId,
  SeriesId,
  TransformSpec,
} from '@/domain/model'
import { deserializeProject } from '@/domain/project/deserialize'
import {
  cascadeRemoval,
  checkRefs,
  repairRefs,
  transformInputs,
  wouldCreateCycle,
  type Removal,
} from './integrity'

const V1 = readFileSync(resolve('tests/fixtures/projects/v1-ok.sciplot'), 'utf8')
const V2 = readFileSync(resolve('tests/fixtures/projects/v2-multiplot.sciplot'), 'utf8')

/** A fresh copy of the reference project (tests/fixtures/projects/v1-ok.sciplot). */
function project(): ProjectDoc {
  const r = deserializeProject(V1)
  if (!r.ok) throw new Error('v1-ok fixture does not load')
  return r.value.doc
}

/** The reference project with a second plot: a series split by observer, with a fit (v2-multiplot). */
function multiplot(): ProjectDoc {
  const r = deserializeProject(V2)
  if (!r.ok) throw new Error('v2-multiplot fixture does not load')
  return r.value.doc
}

const DS = { ohm: 'ds_2a9f6c015', pend: 'ds_7b3d1e826', spring: 'ds_e05a4c917' } as unknown as Record<
  string,
  DatasetId
>
const COL = {
  I: 'col_1f3a5c7e8',
  V: 'col_2b4d6f809',
  uV: 'col_3c5e7a91a',
  P: 'col_4d6f8b02b',
  trial: 'col_5e7a9c13c',
  obs: 'col_6f8bad24d',
  T: 'col_7a9cbe35e',
  m: 'col_8bad0f46f',
  x: 'col_9cbe1a57g',
} as unknown as Record<string, ColumnId>
const SER = { ohm: 'ser_1a2b3c4di', pow: 'ser_5e6f7a8bj' } as unknown as Record<string, SeriesId>
const PLOT = 'plt_0e4b8f2d1h' as PlotId
const PLOT_PEND = 'plt_7c1d9e3a2q' as PlotId
const SER_PEND = 'ser_3b8e1f6cr' as SeriesId

const ohm = (doc: ProjectDoc) => doc.datasets.find((d) => d.id === DS.ohm) as ImportedDataset
const spring = (doc: ProjectDoc) => doc.datasets.find((d) => d.id === DS.spring) as NotebookDataset
const columnIds = (doc: ProjectDoc, ds: DatasetId) =>
  doc.datasets.find((d) => d.id === ds)!.columns.map((c) => c.id)

function derived(id: string, spec: TransformSpec, name: string): ColumnMeta {
  return {
    id: id as ColumnId,
    source: { type: 'derived', spec },
    name,
    unit: null,
    unitSource: null,
    role: 'measurement',
    uncertaintyOf: null,
    detected: { kind: 'numeric', decimal: 'dot', percent: 'display', confidence: 'high', explanations: [] },
    override: {},
  }
}

describe('checkRefs', () => {
  it('finds nothing in a consistent project', () => {
    expect(checkRefs(project())).toEqual([])
  })

  it('reports every kind of broken reference without modifying the document', () => {
    const doc = project()
    const plot = doc.plots[0]
    const [serOhm, serPow] = plot.series
    doc.fits[0].seriesId = 'ser_gone' as SeriesId
    doc.fits.push({ ...structuredClone(doc.fits[1]) }) // duplicate fit id
    doc.activePlotId = 'plt_gone' as PlotId
    serOhm.errorBars.x = {
      kind: 'measurement',
      origin: 'user',
      source: { type: 'column', column: COL.P }, // derived column: no uncertainty propagation
      meaning: { type: 'standard' },
    }
    serOhm.errorBars.y = { kind: 'sd', grouping: { by: 'column', column: 'col_gone' as ColumnId } }
    serPow.errorBars.y = {
      kind: 'measurement',
      origin: 'user',
      source: { type: 'columnAsymmetric', plus: COL.uV, minus: 'col_gone2' as ColumnId },
      meaning: { type: 'unspecified' },
    }
    plot.bar = {
      aggregate: 'none',
      datasetId: DS.pend,
      category: COL.obs,
      value: COL.T,
      showObservations: false,
      colorByCategory: false,
      uncertainty: {
        kind: 'measurement',
        origin: 'user',
        source: { type: 'column', column: COL.uV }, // a column of ANOTHER dataset
        meaning: { type: 'standard' },
      },
    }
    plot.histogram.value = COL.V // exists, but in the Ohm dataset, not in the histogram's dataset
    plot.box.groupBy = 'col_gone3' as ColumnId
    const extra = structuredClone(plot)
    extra.id = 'plt_second' as PlotId // second plot reusing the same series ids
    doc.plots.push(extra)
    ohm(doc).columns[2].uncertaintyOf = 'col_gone4' as ColumnId
    const nb = spring(doc)
    nb.cells['col_orphan'] = ['1', '2', '3']
    delete nb.cells[COL.x]
    doc.exclusions[1].rowIds = [3, 2] as RowId[] // row 2 was deleted from the notebook
    doc.exclusions.push({ ...doc.exclusions[0], id: 'exc_empty' as ExclusionId, rowIds: [] })
    doc.filters[0].datasetId = 'ds_gone' as DatasetId

    const before = structuredClone(doc)
    const found = checkRefs(doc).map((i) => {
      expect(i.code).toBe('E_INTERNAL_GUARD')
      return `${i.params?.where} → ${i.params?.ref} (${i.params?.problem})`
    })
    expect(doc).toEqual(before) // check mode never mutates
    const at = `plots[${PLOT}]`
    expect(found).toEqual(
      expect.arrayContaining([
        `datasets[${DS.ohm}].columns[${COL.uV}].uncertaintyOf → col_gone4 (dangling)`,
        `datasets[${DS.spring}].cells → col_orphan (orphan-cells)`,
        `datasets[${DS.spring}].cells → ${COL.x} (missing-cells)`,
        `${at}.series[${SER.ohm}].errorBars.x → ${COL.P} (derived-uncertainty)`,
        `${at}.series[${SER.ohm}].errorBars.y → col_gone (dangling)`,
        `${at}.series[${SER.pow}].errorBars.y → col_gone2 (dangling)`,
        `${at}.bar.uncertainty → ${COL.uV} (dangling)`,
        `${at}.histogram.value → ${COL.V} (dangling)`,
        `${at}.box.groupBy → col_gone3 (dangling)`,
        `plots[plt_second].series[${SER.ohm}] → ${SER.ohm} (duplicate)`,
        `activePlotId → plt_gone (dangling)`,
        `fits[fit_6c7d8e9fk] → ser_gone (dangling)`,
        `fits[fit_0a1b2c3dl] → fit_0a1b2c3dl (duplicate)`,
        `exclusions[exc_8c9d0e1fn].rowIds → ${DS.spring} (stale-rows)`,
        `exclusions[exc_empty] → exc_empty (empty-exclusion)`,
        `filters[flt_2a3b4c5do] → ds_gone (dangling)`,
      ]),
    )

    // repairRefs fixes all of it, without inventing values. Fewer changes than reports: the
    // duplicate series are removed before their (duplicated) error-bar problems are looked at.
    // uncertaintyOf 1 + cells 2 + error bars 3 + plot 1 options 3 + duplicate series 2
    // + plot 2 options 3 + activePlotId 1 + fits 2 + exclusions 2 + filter 1 = 20
    expect(found).toHaveLength(23)
    expect(repairRefs(doc)).toBe(20)
    expect(checkRefs(doc)).toEqual([])
    expect(doc.plots.map((p) => p.id)).toEqual([PLOT, 'plt_second'])
    expect(doc.plots[1].series).toEqual([])
    expect(serOhm.errorBars).toMatchObject({ x: { kind: 'none' }, y: { kind: 'none' } })
    expect(serPow.errorBars.y).toEqual({ kind: 'none' })
    expect(plot.bar).toMatchObject({ aggregate: 'none', uncertainty: { kind: 'none' }, value: COL.T })
    expect(plot.histogram.value).toBeNull()
    expect(doc.activePlotId).toBe(PLOT)
    expect(doc.fits.map((f) => f.id)).toEqual(['fit_0a1b2c3dl'])
    expect(nb.cells[COL.x]).toEqual(['', '', '']) // missing values, never 0
    expect(Object.keys(nb.cells).sort()).toEqual([COL.m, COL.x].sort())
    expect(doc.exclusions.map((e) => [e.id, e.rowIds])).toEqual([
      ['exc_4e5f6a7bm', [5]],
      ['exc_8c9d0e1fn', [3]],
    ])
    expect(doc.filters.map((f) => f.id)).toEqual(['flt_6e7f8a9bp'])
  })

  it('refuses an uncertainty COLUMN attached to a derived value column (no propagation), not a typed one', () => {
    const doc = project()
    const plot = doc.plots[0]
    const serPow = plot.series[1] // y = P = I·V, a derived column
    const fromColumn = {
      kind: 'measurement',
      origin: 'user',
      source: { type: 'column', column: COL.uV }, // a raw column: u(V), not u(P)
      meaning: { type: 'standard' },
    } as const
    serPow.errorBars.y = fromColumn
    serPow.errorBars.x = fromColumn // x = I is raw: allowed
    plot.bar = {
      aggregate: 'none',
      datasetId: DS.ohm,
      category: COL.I,
      value: COL.P,
      showObservations: false,
      colorByCategory: false,
      uncertainty: {
        kind: 'measurement',
        origin: 'user',
        source: { type: 'columnAsymmetric', plus: COL.uV, minus: COL.uV },
        meaning: { type: 'standard' },
      },
    }
    const at = `plots[${PLOT}]`
    const found = checkRefs(doc).map((i) => `${i.params?.where} → ${i.params?.ref} (${i.params?.problem})`)
    expect(found).toEqual([
      `${at}.series[${SER.pow}].errorBars.y → ${COL.P} (derived-uncertainty)`,
      `${at}.bar.uncertainty → ${COL.P} (derived-uncertainty)`,
    ])
    expect(repairRefs(doc)).toBe(2)
    expect(serPow.errorBars.y).toEqual({ kind: 'none' })
    expect(serPow.errorBars.x).toEqual(fromColumn)
    expect(plot.bar.uncertainty).toEqual({ kind: 'none' })

    // A typed value is the user's own statement about the plotted (derived) quantity: kept.
    serPow.errorBars.y = { ...fromColumn, source: { type: 'absolute', value: 0.001 } }
    plot.bar.uncertainty = { ...fromColumn, source: { type: 'percent', percent: 2 } }
    expect(checkRefs(doc)).toEqual([])
  })

  it('is safe on frozen (immer) state', () => {
    const doc = project()
    doc.fits[0].seriesId = 'ser_gone' as SeriesId
    freeze(doc, true)
    expect(checkRefs(doc)).toHaveLength(1)
  })
})

describe('cascadeRemoval', () => {
  it('leaves zero dangling references after removing ANY dataset, column, series or plot', () => {
    for (const make of [project, multiplot]) {
      const base = make()
      const removals: Removal[] = [
        ...base.datasets.map((d): Removal => ({ kind: 'dataset', id: d.id })),
        ...base.datasets.flatMap((d) =>
          d.columns.map((c): Removal => ({ kind: 'column', datasetId: d.id, id: c.id })),
        ),
        ...base.plots.flatMap((p) => p.series.map((s): Removal => ({ kind: 'series', id: s.id }))),
        ...base.plots.map((p): Removal => ({ kind: 'plot', id: p.id })),
      ]
      expect(removals).toHaveLength(make === project ? 3 + 9 + 2 + 1 : 3 + 9 + 3 + 2)
      for (const removal of removals) {
        const doc = make()
        expect(cascadeRemoval(doc, removal), JSON.stringify(removal)).toBeGreaterThanOrEqual(1)
        expect(checkRefs(doc), JSON.stringify(removal)).toEqual([])
        const ids = JSON.stringify(doc)
        // The removed id is gone from the whole document (log entries are not in the doc).
        expect(ids.includes(`"${removal.id}"`), JSON.stringify(removal)).toBe(false)
      }
    }
  })

  it('dataset: removes its series, their fits and its exclusions', () => {
    const doc = project()
    expect(cascadeRemoval(doc, { kind: 'dataset', id: DS.ohm })).toBe(1 + 2 + 2 + 1)
    expect(doc.datasets.map((d) => d.id)).toEqual([DS.pend, DS.spring])
    expect(doc.plots[0].series).toEqual([])
    expect(doc.fits).toEqual([])
    expect(doc.exclusions.map((e) => e.datasetId)).toEqual([DS.spring])
    expect(doc.plots[0].box.datasetId).toBe(DS.pend) // unrelated options untouched
  })

  it('dataset: resets bar / histogram / box options to null and removes its filters', () => {
    const doc = project()
    expect(cascadeRemoval(doc, { kind: 'dataset', id: DS.pend })).toBe(1 + 3 + 2 + 3 + 2)
    const p = doc.plots[0]
    expect(p.bar).toMatchObject({ datasetId: null, category: null, value: null, aggregate: 'mean' })
    expect(p.histogram).toEqual({
      datasetId: null,
      value: null,
      bins: { mode: 'auto' },
      groupBy: null,
      groupMode: 'overlay',
    })
    expect(p.box).toMatchObject({ datasetId: null, value: null, groupBy: null, points: 'outliers' })
    expect(doc.filters).toEqual([])
    expect(p.series).toHaveLength(2)
  })

  it('column used by a derived column: the derived column, the series and fits on either go too', () => {
    const doc = project()
    expect(cascadeRemoval(doc, { kind: 'column', datasetId: DS.ohm, id: COL.V })).toBe(1 + 1 + 1 + 2 + 2)
    expect(columnIds(doc, DS.ohm)).toEqual([COL.I, COL.uV])
    expect(ohm(doc).columns[1].uncertaintyOf).toBeNull()
    expect(doc.plots[0].series).toEqual([])
    expect(doc.fits).toEqual([])
    expect(doc.exclusions).toHaveLength(2) // exclusions are per row, not per column
  })

  it('uncertainty column: the error bars become "none", the series and its fit stay', () => {
    const doc = project()
    expect(cascadeRemoval(doc, { kind: 'column', datasetId: DS.ohm, id: COL.uV })).toBe(2)
    const s = doc.plots[0].series[0]
    expect(s.errorBars.y).toEqual({ kind: 'none' })
    expect(s.errorBars.x).toMatchObject({ kind: 'measurement', source: { type: 'absolute', value: 0.0005 } })
    expect(doc.fits).toHaveLength(2)
  })

  it('group column: bar category and box grouping become null, its category filter goes', () => {
    const doc = project()
    expect(cascadeRemoval(doc, { kind: 'column', datasetId: DS.pend, id: COL.obs })).toBe(1 + 1 + 1 + 1)
    const p = doc.plots[0]
    expect(p.bar.category).toBeNull()
    expect(p.bar.value).toBe(COL.T)
    expect(p.box.groupBy).toBeNull()
    expect(p.histogram.value).toBe(COL.T)
    expect(doc.filters.map((f) => f.id)).toEqual(['flt_2a3b4c5do'])
  })

  it('notebook column: its typed cells are deleted with it', () => {
    const doc = project()
    expect(cascadeRemoval(doc, { kind: 'column', datasetId: DS.spring, id: COL.m })).toBe(1)
    expect(Object.keys(spring(doc).cells)).toEqual([COL.x])
    expect(spring(doc).cells[COL.x]).toEqual(['2.1', '4.0', '8.3'])
  })

  it('plot: removes its series and their fits, leaves the other plot alone, moves activePlotId', () => {
    const doc = multiplot()
    const ohmPlot = structuredClone(doc.plots[0])
    expect(doc.activePlotId).toBe(PLOT_PEND)
    // the plot + its fit + activePlotId
    expect(cascadeRemoval(doc, { kind: 'plot', id: PLOT_PEND })).toBe(1 + 1 + 1)
    expect(doc.plots).toEqual([ohmPlot])
    expect(doc.fits.map((f) => f.seriesId)).toEqual([SER.ohm, SER.pow])
    expect(doc.activePlotId).toBe(PLOT)
    expect(doc.datasets.map((d) => d.id)).toEqual([DS.ohm, DS.pend, DS.spring]) // data is shared: kept
    expect(doc.exclusions).toHaveLength(2)
    expect(doc.filters).toHaveLength(2)
  })

  it('plot: removing the last plot leaves no active plot', () => {
    const doc = project()
    expect(cascadeRemoval(doc, { kind: 'plot', id: PLOT })).toBe(1 + 2 + 1)
    expect(doc.plots).toEqual([])
    expect(doc.fits).toEqual([])
    expect(doc.activePlotId).toBeNull()
    expect(cascadeRemoval(doc, { kind: 'plot', id: PLOT })).toBe(0)
  })

  it('group column: a split on it and a histogram grouped by it become null; the series stays', () => {
    const doc = multiplot()
    const pend = doc.plots[1]
    expect(pend.series[0].split?.column).toBe(COL.obs)
    expect(cascadeRemoval(doc, { kind: 'column', datasetId: DS.pend, id: COL.obs })).toBeGreaterThan(1)
    expect(pend.series.map((s) => s.id)).toEqual([SER_PEND])
    expect(pend.series[0].split).toBeNull()
    expect(pend.histogram).toMatchObject({ groupBy: null, groupMode: 'stack', value: COL.T })
    expect(doc.fits.find((f) => f.seriesId === SER_PEND)).toMatchObject({ perGroup: true })
    expect(checkRefs(doc)).toEqual([])
  })

  it('series: removes its fit only', () => {
    const doc = project()
    expect(cascadeRemoval(doc, { kind: 'series', id: SER.ohm })).toBe(2)
    expect(doc.plots[0].series.map((s) => s.id)).toEqual([SER.pow])
    expect(doc.fits.map((f) => f.seriesId)).toEqual([SER.pow])
  })

  it('a chain of derived columns is removed transitively', () => {
    const doc = project()
    const cols = ohm(doc).columns
    cols.push(derived('col_lnP', { op: 'ln', input: COL.P }, 'ln P'))
    cols.push(derived('col_sqrtLnP', { op: 'sqrt', input: 'col_lnP' as ColumnId }, '√ln P'))
    doc.plots[0].series[1].y = 'col_sqrtLnP' as ColumnId
    expect(checkRefs(doc)).toEqual([])
    expect(cascadeRemoval(doc, { kind: 'column', datasetId: DS.ohm, id: COL.I })).toBe(1 + 3 + 2 + 2)
    expect(columnIds(doc, DS.ohm)).toEqual([COL.V, COL.uV])
    expect(checkRefs(doc)).toEqual([])
  })

  it('removing something that does not exist changes nothing', () => {
    const doc = project()
    expect(cascadeRemoval(doc, { kind: 'dataset', id: 'ds_nope' as DatasetId })).toBe(0)
    expect(cascadeRemoval(doc, { kind: 'column', datasetId: DS.pend, id: COL.V })).toBe(0) // V is not in pend
    expect(cascadeRemoval(doc, { kind: 'series', id: 'ser_nope' as SeriesId })).toBe(0)
    expect(doc).toEqual(project())
  })

  it('works on an immer draft and leaves the base state untouched', () => {
    const base = freeze(project(), true)
    const next = produce(base, (draft) => {
      cascadeRemoval(draft as ProjectDoc, { kind: 'column', datasetId: DS.ohm, id: COL.V })
    })
    expect(base).toEqual(project())
    expect(columnIds(next as ProjectDoc, DS.ohm)).toEqual([COL.I, COL.uV])
    expect(next.fits).toEqual([])
    expect(checkRefs(next as ProjectDoc)).toEqual([])
    expect(next.datasets[1]).toBe(base.datasets[1]) // structural sharing: untouched dataset reused
  })
})

describe('repairRefs: schema 2 references', () => {
  it('reports a dangling split column and histogram grouping, then resets them to null', () => {
    const doc = multiplot()
    const pend = doc.plots[1]
    pend.series[0].split!.column = 'col_gone' as ColumnId
    pend.histogram.groupBy = 'col_gone2' as ColumnId
    const at = `plots[${PLOT_PEND}]`
    const found = checkRefs(doc).map((i) => `${i.params?.where} → ${i.params?.ref} (${i.params?.problem})`)
    expect(found).toEqual([
      `${at}.series[${SER_PEND}].split.column → col_gone (dangling)`,
      `${at}.histogram.groupBy → col_gone2 (dangling)`,
    ])
    expect(repairRefs(doc)).toBe(2)
    expect(pend.series[0].split).toBeNull()
    expect(pend.histogram.groupBy).toBeNull()
    expect(checkRefs(doc)).toEqual([])
  })

  it('a split column of ANOTHER dataset is dangling for the series', () => {
    const doc = multiplot()
    doc.plots[1].series[0].split = { column: COL.I, overrides: [] } // I is a column of the Ohm dataset
    expect(repairRefs(doc)).toBe(1)
    expect(doc.plots[1].series[0].split).toBeNull()
  })
})

describe('repairRefs', () => {
  it('returns 0 and changes nothing on a consistent project', () => {
    const doc = project()
    expect(repairRefs(doc)).toBe(0)
    expect(doc).toEqual(project())
  })

  it('breaks cycles between derived columns by removing the columns in the cycle', () => {
    const doc = project()
    const cols = ohm(doc).columns
    // P = ln(Q) and Q = P / I: P depends on itself.
    const p = cols[3]
    p.source = { type: 'derived', spec: { op: 'ln', input: 'col_Q' as ColumnId } }
    cols.push(derived('col_Q', { op: 'ratio', left: COL.P, right: COL.I }, 'Q'))
    const problems = checkRefs(doc).map((i) => i.params?.problem)
    expect(problems).toEqual(['cycle', 'cycle'])
    expect(repairRefs(doc)).toBe(2 + 1 + 1) // P and Q, the series on P, its fit
    expect(columnIds(doc, DS.ohm)).toEqual([COL.I, COL.V, COL.uV])
    expect(doc.fits.map((f) => f.id as FitId)).toEqual(['fit_6c7d8e9fk'])
    expect(checkRefs(doc)).toEqual([])
  })

  it('removes duplicate ids, keeping the first occurrence', () => {
    const doc = project()
    doc.datasets.push(structuredClone(doc.datasets[0]))
    ohm(doc).columns.push(structuredClone(ohm(doc).columns[0]))
    doc.exclusions.push(structuredClone(doc.exclusions[0]))
    expect(checkRefs(doc).map((i) => i.params?.problem)).toEqual(['duplicate', 'duplicate', 'duplicate'])
    expect(repairRefs(doc)).toBe(3)
    expect(doc).toEqual(project())
  })

  it('keeps the notebook row-id counter above every row id in use', () => {
    const doc = project()
    spring(doc).nextRowId = 3
    expect(repairRefs(doc)).toBe(1)
    expect(spring(doc).nextRowId).toBe(4)
  })
})

describe('wouldCreateCycle', () => {
  const ds = () => ohm(project()) // P = I · V

  it('accepts a new column built on existing ones', () => {
    expect(wouldCreateCycle(ds(), 'col_new' as ColumnId, { op: 'ln', input: COL.P })).toBe(false)
    expect(wouldCreateCycle(ds(), 'col_new' as ColumnId, { op: 'ratio', left: COL.V, right: COL.I })).toBe(
      false,
    )
  })

  it('rejects a column that would depend on itself, directly or through others', () => {
    expect(
      wouldCreateCycle(ds(), 'col_new' as ColumnId, { op: 'square', input: 'col_new' as ColumnId }),
    ).toBe(true)
    // I := 2·P + 0 while P = I·V
    expect(wouldCreateCycle(ds(), COL.I, { op: 'affine', input: COL.P, a: 2, b: 0 })).toBe(true)
    // V := P / I while P = I·V
    expect(wouldCreateCycle(ds(), COL.V, { op: 'ratio', left: COL.P, right: COL.I })).toBe(true)
    // P := P − I
    expect(wouldCreateCycle(ds(), COL.P, { op: 'difference', left: COL.P, right: COL.I })).toBe(true)
  })

  it('redefining a derived column drops its old dependencies', () => {
    // P := ln I no longer reads V, so V := P / I is fine afterwards.
    const d = ds()
    d.columns[3].source = { type: 'derived', spec: { op: 'ln', input: COL.I } }
    expect(wouldCreateCycle(d, COL.V, { op: 'ratio', left: COL.P, right: COL.I })).toBe(false)
  })

  it('lists transform inputs', () => {
    expect(transformInputs({ op: 'log10', input: COL.I })).toEqual([COL.I])
    expect(transformInputs({ op: 'affine', input: COL.I, a: 1, b: 2 })).toEqual([COL.I])
    expect(transformInputs({ op: 'product', left: COL.I, right: COL.V })).toEqual([COL.I, COL.V])
  })
})
