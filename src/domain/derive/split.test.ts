import { produce } from 'immer'
import { describe, expect, it } from 'vitest'
import { docOf, exclusionOf, fitOf, importCsv, plotOf, rawTablesOf, series } from '@/domain/figure/testing'
import { runFit } from '@/domain/fit/runFit'
import { INACTIVE } from '@/domain/model'
import type { ColumnId, ProjectDoc, SplitSpec } from '@/domain/model'
import { type DerivedSeries, createDeriver, splitGroups } from './pipeline'
import { MAX_SPLIT_GROUPS, NO_VALUE_KEY, columnGroups, fnv1a36, groupUids } from './split'
import { GROUP_OUTSIDE } from './types'
import type { AnalysisSample, FitOk } from './types'

// Two observers measured alternately (A: y ≈ 2x + 1, B: y ≈ 3x − 1); the last row has no observer.
const CSV = [
  'x,y,z,who',
  '1,3.1,1.0,A',
  '1,2.0,1.1,B',
  '2,4.9,2.1,A',
  '2,5.1,2.0,B',
  '3,7.1,3.0,A',
  '3,7.9,3.2,B',
  '4,8.9,4.1,A',
  '4,11.1,3.9,B',
  '5,11.0,5.0,A',
  '5,14.0,5.1,B',
  '6,9.0,6.0,',
].join('\n')
const ds = importCsv(CSV, 'ds_split')
const who = ds.col('who')
const split = (over: Partial<SplitSpec> = {}): SplitSpec => ({ column: who, overrides: [], ...over })
const ys = (over: Parameters<typeof series>[4] = {}) => series('ser_y', ds, 'x', 'y', over)

function derive(doc: ProjectDoc, d = createDeriver()) {
  return d(doc, rawTablesOf([ds]))
}
const docWith = (s = ys({ split: split() }), extra: Parameters<typeof docOf>[2] = {}) =>
  produce(docOf([ds], plotOf({ series: [s] }), extra), () => {})

const countInvariant = (s: AnalysisSample) => {
  const c = s.counts
  expect(s.nActive + c.missing + c.invalid + c.excluded + c.filtered).toBe(s.nTotal)
}
const ok = (f: unknown): FitOk => {
  expect((f as FitOk | null)?.status).toBe('ok')
  return f as FitOk
}

describe('fnv1a36 / groupUids', () => {
  it('hashes like FNV-1a 32 bit (reference values) and writes base 36', () => {
    expect(fnv1a36('')).toBe((0x811c9dc5).toString(36))
    expect(fnv1a36('a')).toBe((0xe40c292c).toString(36))
  })

  it('uids are CSS identifiers without the "__" uid separator; a repeated hash gets a suffix', () => {
    const uids = groupUids(['A', 'B', 'A', 'A', ''])
    expect(uids[0]).toBe(`g${fnv1a36('A')}`)
    expect(uids[2]).toBe(`${uids[0]}_2`)
    expect(uids[3]).toBe(`${uids[0]}_3`)
    expect(new Set(uids).size).toBe(uids.length)
    for (const u of uids) {
      expect(u).toMatch(/^[A-Za-z][A-Za-z0-9_-]*$/)
      expect(u).not.toContain('__')
    }
  })
})

describe('columnGroups — order, keys and labels', () => {
  const view = (csv: string, id: string) => {
    const d = importCsv(csv, id)
    const r = createDeriver()(docOf([d], null), rawTablesOf([d]))
    return { d, view: r.views.get(d.dataset.id)! }
  }

  it('labels: first appearance; the rows without a value form the last group', () => {
    const { d, view: v } = view('x,g\n1,b\n2,\n3,a\n4,b\n5,c\n', 'ds_l')
    const cg = columnGroups(v.columns.get(d.col('g'))!)
    if (cg.tooMany) throw new Error('unexpected')
    expect(cg.groups.map((g) => g.key)).toEqual(['b', 'a', 'c', NO_VALUE_KEY])
    expect(cg.groups.map((g) => g.index)).toEqual([0, 1, 2, 3])
    expect(cg.groups[3]).toMatchObject({ label: '', value: null })
    expect([...cg.groupOf]).toEqual([0, 3, 1, 0, 2])
  })

  it('numbers: ascending, keyed by the value, labelled as first recorded (−0 is 0)', () => {
    const { d, view: v } = view('x,g\n1,3.50\n2,1\n3,3.5\n4,-0\n5,0\n6,x\n', 'ds_n')
    const cg = columnGroups(v.columns.get(d.col('g'))!)
    if (cg.tooMany) throw new Error('unexpected')
    expect(cg.groups.map((g) => g.key)).toEqual(['0', '1', '3.5', NO_VALUE_KEY])
    expect(cg.groups.map((g) => g.label)).toEqual(['-0', '1', '3.50', ''])
    expect(cg.groups.map((g) => g.value)).toEqual([0, 1, 3.5, null])
    // "x" is unreadable as a number: no value, never a group of its own.
    expect([...cg.groupOf]).toEqual([2, 1, 2, 0, 0, 3])
  })

  it(`more than ${MAX_SPLIT_GROUPS} values: only their count`, () => {
    const rows = Array.from({ length: 60 }, (_, i) => `${i},${i % 51}`).join('\n')
    const { d, view: v } = view(`x,g\n${rows}\n`, 'ds_many')
    expect(columnGroups(v.columns.get(d.col('g'))!)).toEqual({ tooMany: true, distinct: 51 })
  })
})

describe('splitGroups — masked samples', () => {
  const derived = derive(docWith())
  const s = derived.series[0]
  const view = derived.views.get(ds.dataset.id)!

  it('one group per value, in order, with the no-value group last; issues name the column', () => {
    const r = splitGroups(
      view,
      ds.dataset.columns.find((c) => c.id === who)!,
      s.data,
    )
    expect(r.groups?.map((g) => [g.key, g.rows.length])).toEqual([
      ['A', 5],
      ['B', 5],
      [NO_VALUE_KEY, 1],
    ])
    expect(r.issues).toEqual([
      expect.objectContaining({
        code: 'I_SPLIT_NO_VALUE',
        params: { count: 1, column: 'who' },
        rows: [s.data.rowIds[10]],
        columnId: who,
      }),
    ])
  })

  it('rows of other groups carry GROUP_OUTSIDE and are not counted; the groups partition the sample', () => {
    const groups = s.split!.groups
    for (const g of groups) {
      countInvariant(g.sample)
      expect(g.sample.nTotal).toBe(g.rows.length)
      expect(g.sample.rowIds).toBe(s.data.sample.rowIds)
      const members = new Set(g.rows)
      for (let i = 0; i < g.sample.reason.length; i++)
        if (!members.has(i)) expect(g.sample.reason[i]).toBe(GROUP_OUTSIDE)
        else expect(g.sample.reason[i]).toBe(s.data.sample.reason[i])
    }
    expect(Object.values(INACTIVE)).not.toContain(GROUP_OUTSIDE)
    const sum = (f: (x: AnalysisSample) => number) => groups.reduce((n, g) => n + f(g.sample), 0)
    expect(sum((x) => x.nActive)).toBe(s.data.sample.nActive)
    expect(sum((x) => x.nTotal)).toBe(s.data.sample.nTotal)
  })

  it('a group with nothing to show (every y missing) is left out but keeps the others their index', () => {
    const d = importCsv('x,y,g\n1,,a\n2,,a\n3,5,b\n4,6,b\n5,7,c\n', 'ds_gap')
    const r = createDeriver()(
      docOf(
        [d],
        plotOf({ series: [series('s', d, 'x', 'y', { split: { column: d.col('g'), overrides: [] } })] }),
      ),
      rawTablesOf([d]),
    )
    const g = r.series[0].split!.groups
    expect(g.map((x) => [x.key, x.index])).toEqual([
      ['b', 1],
      ['c', 2],
    ])
    expect(r.series[0].issues.map((i) => i.code)).toContain('I_ROWS_INACTIVE')
  })

  it('a dangling split column splits nothing and reports nothing', () => {
    const r = splitGroups(view, { id: 'col_none' as ColumnId, name: 'none' }, s.data)
    expect(r).toEqual({ groups: null, issues: [] })
  })
})

describe('pipeline — a split series', () => {
  it('splitting never changes the pooled sample, data or fit objects (invariance)', () => {
    const d = createDeriver()
    const plain = derive(docWith(ys(), { fits: [fitOf('fit_y', 'ser_y')] }), d)
    const splitDoc = docWith(ys({ split: split() }), { fits: [fitOf('fit_y', 'ser_y')] })
    const s0 = plain.series[0]
    const s1 = derive(splitDoc, d).series[0]
    expect(s1.data).toBe(s0.data)
    expect(s1.data.sample).toBe(s0.data.sample)
    expect(s1.fit).toBe(s0.fit)
    expect(s0.split).toBeNull()
    expect(s1.split?.groups).toHaveLength(3)
    // Per group: the series has no pooled fit; turning the split off brings back the same pooled fit.
    const perGroup = produce(splitDoc, (doc) => {
      doc.fits[0].perGroup = true
    })
    const s2 = derive(perGroup, d).series[0]
    expect(s2.fit).toBeNull()
    expect(s2.split!.groups.every((g) => g.fit !== null)).toBe(true)
    const off = produce(perGroup, (doc) => {
      doc.plots[0].series[0].split = null
    })
    const s3 = derive(off, d).series[0]
    expect(s3.fit).toBe(s0.fit)
    expect(s3.split).toBeNull()
  })

  it('a pooled fit (perGroup off) uses every row; the groups get no fits of their own', () => {
    const s = derive(docWith(ys({ split: split() }), { fits: [fitOf('fit_y', 'ser_y')] })).series[0]
    expect(ok(s.fit).provenance.nUsed).toBe(11)
    expect(s.split!.groups.map((g) => g.fit)).toEqual([null, null, null])
  })

  it('per-group fits use exactly the rows of their group (= runFit on the masked sample)', () => {
    const fit = fitOf('fit_y', 'ser_y', { perGroup: true })
    const s = derive(docWith(ys({ split: split() }), { fits: [fit] })).series[0]
    const [a, b, none] = s.split!.groups
    const fa = ok(a.fit)
    const fb = ok(b.fit)
    expect(fa.provenance.nUsed).toBe(5)
    expect(fa.provenance.nTotal).toBe(5)
    expect(fa.params[1].value).toBeCloseTo(1.98, 6)
    expect(fb.params[1].value).toBeCloseTo(3, 6)
    const direct = runFit(fit, { ...s.data, sample: a.sample }, { xUnit: null, yUnit: null })
    expect(ok(direct).params.map((p) => p.value)).toEqual(fa.params.map((p) => p.value))
    expect(new Set(fa.provenance.rowIdsUsed)).toEqual(new Set(Array.from(a.rows, (i) => s.data.rowIds[i])))
    // The single row without an observer cannot be fitted: reported for its group, never dropped.
    expect(none.fit?.status).toBe('error')
    expect(none.issues).toEqual([
      expect.objectContaining({ code: 'E_TOO_FEW_POINTS', params: expect.objectContaining({ group: '' }) }),
    ])
    expect(s.issues).toContainEqual(expect.objectContaining({ code: 'E_TOO_FEW_POINTS' }))
    expect(s.issues).toContainEqual(expect.objectContaining({ code: 'I_SPLIT_NO_VALUE' }))
  })

  it('exclusions stay excluded inside the group fits and are counted in their group only', () => {
    // The first row of A and the first row of B.
    const [firstA, firstB] = derive(docWith()).series[0].data.rowIds
    const fit = fitOf('fit_y', 'ser_y', { perGroup: true })
    const doc = docWith(ys({ split: split() }), {
      fits: [fit],
      exclusions: [exclusionOf('ex_1', ds, [firstA, firstB])],
    })
    const s = derive(doc).series[0]
    const [a, b, none] = s.split!.groups
    expect(a.sample.counts.excluded).toBe(1)
    expect(b.sample.counts.excluded).toBe(1)
    expect(none.sample.counts.excluded).toBe(0)
    expect(ok(a.fit).provenance.nUsed).toBe(4)
    expect(ok(a.fit).provenance.rowIdsUsed).not.toContain(firstA)
    expect(ok(b.fit).provenance.rowIdsUsed).not.toContain(firstB)
    expect(ok(a.fit).provenance.inactive.excluded).toBe(1)
  })

  it('caches: a rename of the split column or a style edit keeps every group and group fit', () => {
    const d = createDeriver()
    const doc = docWith(ys({ split: split() }), { fits: [fitOf('fit_y', 'ser_y', { perGroup: true })] })
    const s0 = derive(doc, d).series[0]
    const renamed = produce(doc, (x) => {
      x.datasets[0].columns.find((c) => c.id === who)!.name = 'observer'
      x.plots[0].series[0].style.markerSize = 9
    })
    const s1 = derive(renamed, d).series[0]
    expect(s1.split!.column.name).toBe('observer')
    s1.split!.groups.forEach((g, k) => {
      expect(g).toBe(s0.split!.groups[k])
      expect(g.fit).toBe(s0.split!.groups[k].fit)
    })
    // The same document again: the same series object.
    expect(derive(renamed, d).series[0]).toBe(s1)
  })

  it(`more than ${MAX_SPLIT_GROUPS} values: W_SPLIT_TOO_MANY_GROUPS and the series stays whole`, () => {
    const rows = Array.from({ length: 60 }, (_, i) => `${i},${2 * i},${i}`).join('\n')
    const many = importCsv(`x,y,id\n${rows}\n`, 'ds_many')
    const r = createDeriver()(
      docOf(
        [many],
        plotOf({
          series: [series('s', many, 'x', 'y', { split: { column: many.col('id'), overrides: [] } })],
        }),
        { fits: [fitOf('f', 's', { perGroup: true })] },
      ),
      rawTablesOf([many]),
    )
    const s: DerivedSeries = r.series[0]
    expect(s.split).toBeNull()
    expect(s.issues).toContainEqual(
      expect.objectContaining({
        code: 'W_SPLIT_TOO_MANY_GROUPS',
        params: { column: 'id', count: 60, limit: MAX_SPLIT_GROUPS },
      }),
    )
    // Not split, so the one fit of the series is drawn as usual.
    expect(ok(s.fit).provenance.nUsed).toBe(60)
  })

  it('replicate bars are computed within each group (means per x inside the group)', () => {
    const rep = ys({
      split: split(),
      errorBars: { x: { kind: 'none' }, y: { kind: 'sem', grouping: { by: 'sameX' } }, visible: true },
    })
    const s = derive(docWith(rep)).series[0]
    expect(s.replicate?.groups).toHaveLength(6) // pooled: one mean per x
    const [a, b] = s.split!.groups
    expect(a.replicate?.groups.map((g) => g.rowIds.length)).toEqual([1, 1, 1, 1, 1])
    expect(b.replicate?.groups.every((g) => g.n === 1)).toBe(true)
    // W_GROUP_SINGLE comes once per group, named by it, not from the pooled grouping.
    const singles = s.issues.filter((i) => i.code === 'W_GROUP_SINGLE')
    expect(singles.map((i) => i.params?.group)).toEqual(['A', 'B', ''])
  })

  it('an issue that does not depend on the group rows is stated once, without a group', () => {
    // Two replicates per x in both groups: the same ±1 SEM note for each, and a date x (no fit).
    const d = importCsv(
      't,y,g\n2024-01-01,1,A\n2024-01-01,2,A\n2024-01-02,3,A\n2024-01-02,4,A\n' +
        '2024-01-01,5,B\n2024-01-01,6,B\n2024-01-02,7,B\n2024-01-02,8,B\n',
      'ds_indep',
    )
    const s = createDeriver()(
      docOf(
        [d],
        plotOf({
          series: [
            series('s', d, 't', 'y', {
              split: { column: d.col('g'), overrides: [] },
              errorBars: {
                x: { kind: 'none' },
                y: { kind: 'sem', grouping: { by: 'sameX' } },
                visible: true,
              },
            }),
          ],
        }),
        { fits: [fitOf('f', 's', { perGroup: true })] },
      ),
      rawTablesOf([d]),
    ).series[0]
    const of = (code: string) => s.issues.filter((i) => i.code === code)
    expect(of('E_COLUMN_NOT_NUMERIC')).toEqual([
      expect.objectContaining({ params: { column: 't' }, columnId: d.col('t') }),
    ])
    expect(of('I_SEM_COVERAGE')).toEqual([expect.objectContaining({ params: { coverage: 50, n: 2 } })])
    // Each group still carries it (its own result), without a group name.
    for (const g of s.split!.groups)
      expect(g.issues.map((i) => i.params?.group)).toEqual([undefined, undefined])
  })
})
