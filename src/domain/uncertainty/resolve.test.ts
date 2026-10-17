import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildDatasetView } from '@/domain/derive/datasetView'
import { seriesData } from '@/domain/derive/series'
import { CELL } from '@/domain/derive/types'
import { DEFAULT_SERIES_STYLE, NO_UNCERTAINTY } from '@/domain/model'
import type {
  ColumnId,
  ColumnKind,
  ColumnMeta,
  ColumnSource,
  DatasetId,
  Exclusion,
  ExclusionId,
  ImportedDataset,
  RawTable,
  RawTableId,
  RowId,
  SeriesId,
  UncertaintySpec,
  XYSeriesSpec,
} from '@/domain/model'
import { describeUncertainty } from './describe'
import { resolveMeasurementBars, resolveReplicateBars, semCoveragePct } from './resolve'

function rawFromCsv(text: string): RawTable {
  const rows = text
    .replace(/\r/g, '')
    .trim()
    .split('\n')
    .map((l) => l.split(','))
  return {
    id: 'raw_u' as RawTableId,
    source: {
      kind: 'csv',
      fileName: null,
      sheetName: null,
      encoding: 'utf-8',
      delimiter: ',',
      byteSize: null,
      importedAt: '',
    },
    rowCount: rows.length,
    sourceRow: Int32Array.from(rows.map((_, i) => i + 1)),
    columns: Array.from({ length: rows[0].length }, (_, c) => ({
      text: rows.map((r) => r[c] ?? ''),
      native: null,
    })),
    tokenIssues: [],
  }
}
const meta = (
  id: string,
  source: ColumnSource,
  unit: string | null = null,
  kind: ColumnKind = 'numeric',
): ColumnMeta => ({
  id: id as ColumnId,
  source,
  name: id,
  unit,
  unitSource: unit ? 'header' : null,
  role: 'measurement',
  uncertaintyOf: null,
  detected: { kind, decimal: 'dot', percent: 'display', confidence: 'high', explanations: [] },
  override: {},
})
const DS = 'ds_u' as DatasetId
function setup(csv: string, cols: ColumnMeta[]) {
  const raw = rawFromCsv(csv)
  const ds: ImportedDataset = {
    id: DS,
    name: 'u',
    createdAt: '',
    example: null,
    columns: cols,
    notes: [],
    origin: 'import',
    rawTableId: raw.id,
    layout: { headerRow: 0, unitsRow: null, dataStartRow: 1, dataEndRow: raw.rowCount - 1 },
  }
  const view = buildDatasetView(ds, raw)
  const byId = (id: ColumnId) => cols.find((c) => c.id === id)
  return { view, byId, col: (id: string) => byId(id as ColumnId)! }
}
const measurement = (
  source: Extract<UncertaintySpec, { kind: 'measurement' }>['source'],
): Extract<UncertaintySpec, { kind: 'measurement' }> => ({
  kind: 'measurement',
  origin: 'user',
  source,
  meaning: { type: 'standard' },
})
const series = (x: string, y: string, errY: UncertaintySpec = NO_UNCERTAINTY): XYSeriesSpec => ({
  id: 'ser_u' as SeriesId,
  datasetId: DS,
  name: null,
  x: x as ColumnId,
  y: y as ColumnId,
  visible: true,
  style: DEFAULT_SERIES_STYLE,
  errorBars: { x: NO_UNCERTAINTY, y: errY, visible: true },
  split: null,
})
const exclude = (rowIds: number[]): Exclusion[] => [
  {
    id: 'ex_u' as ExclusionId,
    datasetId: DS,
    rowIds: rowIds as RowId[],
    reason: 'other',
    note: '',
    createdAt: '',
  },
]
const LIN = { x: 'linear', y: 'linear' } as const
const codes = (issues: readonly { code: string }[]) => issues.map((i) => i.code)

describe('resolveMeasurementBars', () => {
  const { view, byId, col } = setup(
    'x,y,u,um,d\n1,-5,0.1,0.2,1\n2,0,-0.2,,2\n3,10,,0.3,3\n4,,0,,4\n5,7,abc,0.1,5\n6,8,,,6',
    [
      meta('x', { type: 'raw', index: 0 }, 's'),
      meta('y', { type: 'raw', index: 1 }, 'm'),
      meta('u', { type: 'raw', index: 2 }, 'm'),
      meta('um', { type: 'raw', index: 3 }, 'cm'),
      meta('d', { type: 'derived', spec: { op: 'square', input: 'x' as ColumnId } }),
    ],
  )
  const y = view.columns.get('y' as ColumnId)!.values

  it("kind 'none' → null", () => {
    expect(resolveMeasurementBars(NO_UNCERTAINTY, y, view, col('y'), byId)).toBeNull()
  })

  it('absolute: the same half-length on every row; zero is a valid bar; a negative value is never used', () => {
    const b = resolveMeasurementBars(measurement({ type: 'absolute', value: 0.05 }), y, view, col('y'), byId)!
    expect(Array.from(b.plus)).toEqual([0.05, 0.05, 0.05, 0.05, 0.05, 0.05])
    expect(b.minus).toBeNull()
    expect(Array.from(b.status).every((s) => s === CELL.ok)).toBe(true)
    expect(b.descriptor).toMatchObject({
      kind: 'measurement',
      labelKey: 'uncertainty.label.measurement.standard',
    })
    const zero = resolveMeasurementBars(measurement({ type: 'absolute', value: 0 }), y, view, col('y'), byId)!
    expect(zero.plus[0]).toBe(0)
    const neg = resolveMeasurementBars(
      measurement({ type: 'absolute', value: -0.05 }),
      y,
      view,
      col('y'),
      byId,
    )!
    expect(Array.from(neg.plus).every(Number.isNaN)).toBe(true)
    expect(Array.from(neg.status).every((s) => s === CELL.invalid)).toBe(true)
    expect(codes(neg.issues)).toEqual(['E_UNCERTAINTY_NEGATIVE'])
  })

  it('percent: |y|·p/100; y = 0 → zero-length bar + I_ZERO_VALUE_PERCENT; missing y → no bar; p > 100 warned', () => {
    const b = resolveMeasurementBars(measurement({ type: 'percent', percent: 2 }), y, view, col('y'), byId)!
    expect(b.plus[0]).toBeCloseTo(0.1, 15) // |−5|·2/100
    expect(b.plus[1]).toBe(0)
    expect(b.plus[2]).toBeCloseTo(0.2, 15)
    expect(b.plus[3]).toBeNaN()
    expect(b.status[3]).toBe(CELL.missing)
    const z = b.issues.find((i) => i.code === 'I_ZERO_VALUE_PERCENT')!
    expect(z.params).toEqual({ count: 1 })
    expect(z.rows).toEqual([2])
    const over = resolveMeasurementBars(
      measurement({ type: 'percent', percent: 150 }),
      y,
      view,
      col('y'),
      byId,
    )!
    expect(codes(over.issues)).toContain('W_PERCENT_OVER_100')
  })

  it('column: negative → invalid with NaN (never abs), missing → NaN, zero valid, unreadable → invalid', () => {
    const b = resolveMeasurementBars(
      measurement({ type: 'column', column: 'u' as ColumnId }),
      y,
      view,
      col('y'),
      byId,
    )!
    expect(b.plus[0]).toBe(0.1)
    expect(b.plus[1]).toBeNaN() // −0.2: no bar, NOT 0.2
    expect(b.plus[2]).toBeNaN()
    expect(b.plus[3]).toBe(0)
    expect(b.plus[4]).toBeNaN()
    expect(Array.from(b.status)).toEqual([
      CELL.ok,
      CELL.invalid,
      CELL.missing,
      CELL.ok,
      CELL.invalid,
      CELL.missing,
    ])
    const inv = b.issues.find((i) => i.code === 'W_UNCERTAINTY_ROWS_INVALID')!
    expect(inv.params).toEqual({ count: 2 })
    expect(inv.rows).toEqual([2, 5])
    const mis = b.issues.find((i) => i.code === 'I_UNCERTAINTY_ROWS_MISSING')!
    expect(mis.rows).toEqual([3, 6])
    expect(mis.params).toEqual({ count: 2 })
    expect(codes(b.issues)).not.toContain('W_UNCERTAINTY_UNIT_MISMATCH') // m vs m
  })

  it('asymmetric: one side missing or invalid → NaN on BOTH sides; both missing → missing', () => {
    const spec = measurement({ type: 'columnAsymmetric', plus: 'u' as ColumnId, minus: 'um' as ColumnId })
    const b = resolveMeasurementBars(spec, y, view, col('y'), byId)!
    expect(b.plus[0]).toBe(0.1)
    expect(b.minus![0]).toBe(0.2)
    for (const i of [1, 2, 3, 4, 5]) {
      expect(b.plus[i]).toBeNaN()
      expect(b.minus![i]).toBeNaN()
    }
    // rows 3 and 4 have only one side, row 2 and 5 an invalid side, row 6 neither side
    expect(Array.from(b.status)).toEqual([
      CELL.ok,
      CELL.invalid,
      CELL.invalid,
      CELL.invalid,
      CELL.invalid,
      CELL.missing,
    ])
    const inv = b.issues.find((i) => i.code === 'W_UNCERTAINTY_ROWS_INVALID')!
    expect(inv.rows).toEqual([2, 3, 5]) // row 4 has no y value: not drawn, not reported
    expect(b.issues.find((i) => i.code === 'I_UNCERTAINTY_ROWS_MISSING')!.rows).toEqual([6])
    expect(codes(b.issues)).toContain('W_UNCERTAINTY_UNIT_MISMATCH') // um is in cm
  })

  it('unit of the uncertainty column ≠ unit of the value column → W_UNCERTAINTY_UNIT_MISMATCH, no conversion', () => {
    const b = resolveMeasurementBars(
      measurement({ type: 'column', column: 'um' as ColumnId }),
      y,
      view,
      col('y'),
      byId,
    )!
    const w = b.issues.find((i) => i.code === 'W_UNCERTAINTY_UNIT_MISMATCH')!
    expect(w.params).toEqual({ u: 'um', uu: 'cm', col: 'y', cu: 'm' })
    expect(b.plus[0]).toBe(0.2) // shown as given
  })

  it('a derived column cannot be an uncertainty (propagation not implemented)', () => {
    const b = resolveMeasurementBars(
      measurement({ type: 'column', column: 'd' as ColumnId }),
      y,
      view,
      col('y'),
      byId,
    )!
    expect(codes(b.issues)).toEqual(['E_DERIVED_UNCERTAINTY'])
    expect(Array.from(b.plus).every(Number.isNaN)).toBe(true)
  })

  it('x and y bars are independent arrays', () => {
    const x = view.columns.get('x' as ColumnId)!.values
    const bx = resolveMeasurementBars(measurement({ type: 'absolute', value: 0.5 }), x, view, col('x'), byId)!
    const by = resolveMeasurementBars(
      measurement({ type: 'column', column: 'u' as ColumnId }),
      y,
      view,
      col('y'),
      byId,
    )!
    expect(bx.plus).not.toBe(by.plus)
    expect(bx.plus[0]).toBe(0.5)
    expect(by.plus[0]).toBe(0.1)
  })

  it('free fall: u(y) column read as given', () => {
    const csv = readFileSync(resolve('src/examples/freeFall.csv'), 'utf8')
    const ff = setup(csv, [
      meta('t', { type: 'raw', index: 0 }, 's'),
      meta('y', { type: 'raw', index: 1 }, 'm'),
      meta('uy', { type: 'raw', index: 2 }, 'm'),
    ])
    const yy = ff.view.columns.get('y' as ColumnId)!.values
    const b = resolveMeasurementBars(
      measurement({ type: 'column', column: 'uy' as ColumnId }),
      yy,
      ff.view,
      ff.col('y'),
      ff.byId,
    )!
    expect(Array.from(b.plus)).toEqual([
      0.002, 0.002, 0.003, 0.003, 0.003, 0.003, 0.004, 0.004, 0.004, 0.005, 0.005, 0.005, 0.005, 0.006, 0.006,
    ])
    expect(b.issues).toEqual([])
  })
})

describe('resolveReplicateBars', () => {
  const ref = JSON.parse(readFileSync(resolve('tests/fixtures/reference/beerLambert.json'), 'utf8'))
  const bl = setup(readFileSync(resolve('src/examples/beerLambert.csv'), 'utf8'), [
    meta('c', { type: 'raw', index: 0 }, 'mg/L'),
    meta('A', { type: 'raw', index: 1 }, 'AU'),
    meta('rep', { type: 'raw', index: 2 }),
  ])
  const s = seriesData(series('c', 'A'), bl.view, [], [], LIN)

  it('Beer–Lambert: SD, SEM and CI bars are distinct and match the oracle', () => {
    const sd = resolveReplicateBars({ kind: 'sd', grouping: { by: 'sameX' } }, s, bl.view)
    const sem = resolveReplicateBars({ kind: 'sem', grouping: { by: 'sameX' } }, s, bl.view)
    const ci = resolveReplicateBars(
      { kind: 'ci', grouping: { by: 'sameX' }, level: 0.95, method: 't' },
      s,
      bl.view,
    )
    expect(sd.groups.map((g) => g.x)).toEqual([0, 2, 4, 6, 8, 10])
    for (let j = 0; j < 6; j++) {
      const r = ref.groups[j]
      expect(sd.bars.plus[j]).toBeCloseTo(Number(r.sd), 12)
      expect(sem.bars.plus[j]).toBeCloseTo(Number(r.sem), 12)
      expect(ci.bars.plus[j]).toBeCloseTo(Number(r.ci95HalfWidth), 12)
      expect(new Set([sd.bars.plus[j], sem.bars.plus[j], ci.bars.plus[j]]).size).toBe(3)
    }
    expect(sd.bars.descriptor).toMatchObject({ labelKey: 'uncertainty.label.sd', params: { n: 3 } })
    expect(sem.bars.descriptor.labelKey).toBe('uncertainty.label.sem')
    expect(ci.bars.descriptor).toMatchObject({
      labelKey: 'uncertainty.label.ci',
      params: { level: 95, n: 3 },
    })
    expect(sem.bars.issues).toEqual([
      { code: 'I_SEM_COVERAGE', severity: 'info', params: { coverage: 58, n: 3 } },
    ])
    expect(sd.bars.minus).toBeNull()
  })

  it('groups use only the active pairwise sample; n_g = 1 → no bar + W_GROUP_SINGLE; n_g = 2 with CI → W_GROUP_PAIR_CI', () => {
    // grid rows 1–3 are c = 0; rows 4–6 are c = 2
    const ex = seriesData(series('c', 'A'), bl.view, exclude([1, 2, 4]), [], LIN)
    const ci = resolveReplicateBars(
      { kind: 'ci', grouping: { by: 'sameX' }, level: 0.95, method: 't' },
      ex,
      bl.view,
    )
    expect(ci.groups.map((g) => g.n)).toEqual([1, 2, 3, 3, 3, 3])
    expect(ci.bars.plus[0]).toBeNaN()
    expect(ci.bars.status[0]).toBe(CELL.missing)
    expect(ci.groups[0]).toMatchObject({ sd: null, sem: null, ciHalf: null })
    const single = ci.bars.issues.find((i) => i.code === 'W_GROUP_SINGLE')!
    expect(single.params).toEqual({ count: 1 })
    expect(single.rows).toEqual([3])
    const pair = ci.bars.issues.find((i) => i.code === 'W_GROUP_PAIR_CI')!
    // t(0.95, 1) = 12.7062…, shown to 4 significant figures like W_FEW_DOF.
    expect(pair.params).toEqual({ count: 1, t: 12.71, level: 95 })
    expect(ci.bars.descriptor.params.n).toBe('1–3')
    // The multiplier follows the chosen level (never a hard-coded 12.71).
    const at = (level: 0.9 | 0.99) =>
      resolveReplicateBars(
        { kind: 'ci', grouping: { by: 'sameX' }, level, method: 't' },
        ex,
        bl.view,
      ).bars.issues.find((i) => i.code === 'W_GROUP_PAIR_CI')!.params
    expect(at(0.9)).toEqual({ count: 1, t: 6.314, level: 90 })
    expect(at(0.99)).toEqual({ count: 1, t: 63.66, level: 99 })
  })

  it('grouping by a column (pendulum observer): group means and x = mean x of the group', () => {
    const pd = setup(readFileSync(resolve('src/examples/pendulum.csv'), 'utf8'), [
      meta('trial', { type: 'raw', index: 0 }),
      meta('obs', { type: 'raw', index: 1 }, null, 'categorical'),
      meta('T', { type: 'raw', index: 2 }, 's'),
    ])
    const pref = JSON.parse(readFileSync(resolve('tests/fixtures/reference/pendulum.json'), 'utf8'))
    const ps = seriesData(series('trial', 'T'), pd.view, [], [], LIN)
    const r = resolveReplicateBars(
      { kind: 'sd', grouping: { by: 'column', column: 'obs' as ColumnId } },
      ps,
      pd.view,
    )
    expect(r.groups.map((g) => g.key)).toEqual(['A', 'B'])
    expect(r.groups[0].mean).toBeCloseTo(Number(pref.observerA.mean), 12)
    expect(r.bars.plus[1]).toBeCloseTo(Number(pref.observerB.sd), 12)
    const trialsA = Array.from(ps.x).slice(0, 12)
    expect(r.groups[0].x).toBeCloseTo(trialsA.reduce((a, b) => a + b, 0) / 12, 12)
  })

  it('a group of identical values keeps its zero-length bar and is reported (I_ZERO_SPREAD with its rows)', () => {
    // Readings rounded to the instrument resolution: the three values at x = 1 are all 2.0.
    const z = setup('x,y\n1,2.0\n1,2.0\n1,2.0\n2,3.1\n2,3.3\n2,3.2\n', [
      meta('x', { type: 'raw', index: 0 }),
      meta('y', { type: 'raw', index: 1 }),
    ])
    const zs = seriesData(series('x', 'y'), z.view, [], [], LIN)
    for (const spec of [
      { kind: 'sd', grouping: { by: 'sameX' } },
      { kind: 'sem', grouping: { by: 'sameX' } },
      { kind: 'ci', grouping: { by: 'sameX' }, level: 0.95, method: 't' },
    ] as const) {
      const r = resolveReplicateBars(spec, zs, z.view)
      expect(r.bars.plus[0]).toBe(0)
      expect(r.bars.status[0]).toBe(CELL.ok)
      expect(r.bars.plus[1]).toBeGreaterThan(0)
      expect(r.bars.issues.find((i) => i.code === 'I_ZERO_SPREAD')).toEqual({
        code: 'I_ZERO_SPREAD',
        severity: 'info',
        params: { scope: 'groups', count: 1, n: 3 },
        rows: [1, 2, 3],
      })
    }
    // Beer–Lambert has a real spread in every group: no such note.
    const sd = resolveReplicateBars({ kind: 'sd', grouping: { by: 'sameX' } }, s, bl.view)
    expect(codes(sd.bars.issues)).not.toContain('I_ZERO_SPREAD')
  })

  it('a pair of identical values has a zero-width CI: I_ZERO_SPREAD, never "very wide" (W_GROUP_PAIR_CI)', () => {
    const p = setup('x,y\n1,2.0\n1,2.0\n2,3.1\n2,3.5\n3,4.0\n3,4.4\n3,4.1\n', [
      meta('x', { type: 'raw', index: 0 }),
      meta('y', { type: 'raw', index: 1 }),
    ])
    const ps = seriesData(series('x', 'y'), p.view, [], [], LIN)
    const ci = { kind: 'ci', grouping: { by: 'sameX' }, level: 0.95, method: 't' } as const
    const r = resolveReplicateBars(ci, ps, p.view)
    expect(r.bars.plus[0]).toBe(0)
    expect(r.bars.issues.find((i) => i.code === 'I_ZERO_SPREAD')?.rows).toEqual([1, 2])
    // Only the pair at x = 2 (a real spread) has the very wide t = 12.71 interval.
    expect(r.bars.issues.find((i) => i.code === 'W_GROUP_PAIR_CI')).toMatchObject({
      params: { count: 1, t: 12.71, level: 95 },
      rows: [3, 4],
    })
    const onlyZero = setup('x,y\n1,2.0\n1,2.0\n3,4.0\n3,4.4\n3,4.1\n', [
      meta('x', { type: 'raw', index: 0 }),
      meta('y', { type: 'raw', index: 1 }),
    ])
    const os = seriesData(series('x', 'y'), onlyZero.view, [], [], LIN)
    expect(codes(resolveReplicateBars(ci, os, onlyZero.view).bars.issues)).not.toContain('W_GROUP_PAIR_CI')
  })

  it('grouping by a column lets x vary inside a group → W_GROUP_X_VARIES, unless x is an identifier', () => {
    // Beer–Lambert grouped by 'replicate': each group mixes all six concentrations.
    const byRep = resolveReplicateBars(
      { kind: 'sd', grouping: { by: 'column', column: 'rep' as ColumnId } },
      s,
      bl.view,
    )
    expect(byRep.groups.map((g) => g.key)).toEqual(['1', '2', '3'])
    const varies = byRep.bars.issues.find((i) => i.code === 'W_GROUP_X_VARIES')!
    expect(varies.params).toEqual({ count: 3 })
    expect([...varies.rows!].sort((a, b) => a - b)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1))
    // Grouped by the concentration column itself: x is constant in every group.
    const byC = resolveReplicateBars(
      { kind: 'sd', grouping: { by: 'column', column: 'c' as ColumnId } },
      s,
      bl.view,
    )
    expect(byC.groups.map((g) => g.x)).toEqual([0, 2, 4, 6, 8, 10])
    expect(codes(byC.bars.issues)).not.toContain('W_GROUP_X_VARIES')
    expect(
      codes(resolveReplicateBars({ kind: 'sd', grouping: { by: 'sameX' } }, s, bl.view).bars.issues),
    ).not.toContain('W_GROUP_X_VARIES')

    // Pendulum: x = trial number grouped by observer. A trial number only places the group.
    const pd = setup(readFileSync(resolve('src/examples/pendulum.csv'), 'utf8'), [
      meta('trial', { type: 'raw', index: 0 }),
      meta('obs', { type: 'raw', index: 1 }, null, 'categorical'),
      meta('T', { type: 'raw', index: 2 }, 's'),
    ])
    const ps = seriesData(series('trial', 'T'), pd.view, [], [], LIN)
    const spec = { kind: 'sem', grouping: { by: 'column', column: 'obs' as ColumnId } } as const
    expect(codes(resolveReplicateBars(spec, ps, pd.view, { xRole: 'identifier' }).bars.issues)).not.toContain(
      'W_GROUP_X_VARIES',
    )
    // The same x read as a measured quantity mixes 12 different x values per observer.
    expect(
      resolveReplicateBars(spec, ps, pd.view, { xRole: 'measurement' }).bars.issues.find(
        (i) => i.code === 'W_GROUP_X_VARIES',
      )?.params,
    ).toEqual({ count: 2 })
  })

  it('SEM coverage under t: 50 % for n = 2, 58 % for n = 3', () => {
    expect(semCoveragePct(2)).toBe(50)
    expect(semCoveragePct(3)).toBe(58)
    expect(semCoveragePct(5)).toBe(63)
  })
})

describe('describeUncertainty', () => {
  it('names each kind distinctly; expanded keeps k; unspecified meaning is labelled as such', () => {
    expect(describeUncertainty(NO_UNCERTAINTY).labelKey).toBe('uncertainty.label.none')
    const exp = describeUncertainty({
      kind: 'measurement',
      origin: 'instrument',
      source: { type: 'percent', percent: 0.5 },
      meaning: { type: 'expanded', k: 2 },
    })
    expect(exp).toEqual({
      kind: 'measurement',
      labelKey: 'uncertainty.label.measurement.expanded',
      params: { origin: 'instrument', source: 'percent', percent: 0.5, k: 2 },
    })
    const uns = describeUncertainty({
      kind: 'measurement',
      origin: 'user',
      source: { type: 'column', column: 'u' as ColumnId },
      meaning: { type: 'unspecified' },
    })
    expect(uns.labelKey).toBe('uncertainty.label.measurement.unspecified')
    expect(uns.params.k).toBeUndefined()
    const ci = describeUncertainty(
      { kind: 'ci', grouping: { by: 'sameX' }, level: 0.99, method: 't' },
      { groupN: [4, 4] },
    )
    expect(ci.params).toEqual({ grouping: 'sameX', n: 4, level: 99, method: 't' })
  })
})
