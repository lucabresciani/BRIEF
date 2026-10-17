import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CELL } from '@/domain/derive/types'
import type { AnalysisSample, DatasetView, ParsedColumn } from '@/domain/derive/types'
import { INACTIVE } from '@/domain/model'
import type { ColumnId, DatasetId } from '@/domain/model'
import { lre, readNistUniv } from '@/test/nist'
import { mean, sampleSD, sdRelativeUncertaintyPct, summarizeColumn } from './descriptive'

const pendulum = JSON.parse(readFileSync(resolve('tests/fixtures/reference/pendulum.json'), 'utf8'))
const A = [1.7, 1.75, 1.76, 1.7, 1.72, 1.7, 1.78, 1.72, 1.76, 1.74, 1.75, 1.7]
const B = [1.66, 1.72, 1.79, 1.74, 1.77, 1.61, 1.98, 1.8, 1.83, 1.69, 1.81, 1.79]

const close = (got: number | null, want: number, rel = 1e-12) => {
  expect(got).not.toBeNull()
  expect(Math.abs((got as number) - want)).toBeLessThanOrEqual(rel * Math.max(1e-300, Math.abs(want)))
}

/** Minimal one-column view: null = missing token, 'bad' = invalid cell. */
function viewOf(cells: (number | null | 'bad')[], rowIds?: number[]): { view: DatasetView; id: ColumnId } {
  const id = 'col_y' as ColumnId
  const n = cells.length
  const values = new Float64Array(n).fill(NaN)
  const status = new Uint8Array(n)
  cells.forEach((c, i) => {
    if (c === null) status[i] = CELL.missing
    else if (c === 'bad') status[i] = CELL.invalid
    else values[i] = c
  })
  const col: ParsedColumn = {
    columnId: id,
    settings: { kind: 'numeric', decimal: 'dot', percent: 'display' },
    values,
    status,
    categories: null,
    text: cells.map((c) => (c === null ? '' : String(c))),
    report: {
      nRows: n,
      nValid: 0,
      nMissing: 0,
      nSheetError: 0,
      nInvalid: 0,
      invalidExamples: [],
      missingTokens: [],
    },
  }
  const ids = Int32Array.from(rowIds ?? cells.map((_, i) => i))
  const view: DatasetView = {
    datasetId: 'ds_1' as DatasetId,
    rowIds: ids,
    rowIndex: new Map(Array.from(ids, (r, i) => [r, i])),
    blankRows: new Int32Array(0),
    sourceRow: ids.map((r) => r + 2),
    recordAxis: 'row',
    columns: new Map([[id, col]]),
    columnOrder: [id],
  }
  return { view, id }
}

/** Sample for this column alone with optional excluded/filtered row indices. */
function sampleOf(
  view: DatasetView,
  id: ColumnId,
  excluded: number[] = [],
  filtered: number[] = [],
): AnalysisSample {
  const col = view.columns.get(id)!
  const reason = new Uint8Array(view.rowIds.length)
  const counts = { missing: 0, invalid: 0, excluded: 0, filtered: 0 }
  for (let i = 0; i < reason.length; i++) {
    const s = col.status[i]
    if (s === CELL.missing) reason[i] = INACTIVE.missing
    else if (s !== CELL.ok) reason[i] = INACTIVE.invalid
    else if (excluded.includes(i)) reason[i] = INACTIVE.excluded
    else if (filtered.includes(i)) reason[i] = INACTIVE.filtered
    if (reason[i] === INACTIVE.missing) counts.missing++
    if (reason[i] === INACTIVE.invalid) counts.invalid++
    if (reason[i] === INACTIVE.excluded) counts.excluded++
    if (reason[i] === INACTIVE.filtered) counts.filtered++
  }
  const nActive = reason.filter((r) => r === INACTIVE.active).length
  return { rowIds: view.rowIds, reason, nTotal: reason.length, nActive, counts }
}

describe('NIST StRD univariate: mean and sample SD (LRE)', () => {
  const sdMin: Record<string, number> = {
    NumAcc2: 13,
    NumAcc3: 9,
    NumAcc4: 8,
    Michelso: 13,
    Mavro: 12,
  }
  for (const name of [
    'PiDigits',
    'Lottery',
    'Lew',
    'Mavro',
    'Michelso',
    'NumAcc1',
    'NumAcc2',
    'NumAcc3',
    'NumAcc4',
  ]) {
    const d = readNistUniv(name)
    const m = mean(d.y)
    const s = sampleSD(d.y)
    const lreMean = lre(m, d.mean)
    const lreSD = lre(s, d.sd)
    const sdRule = name === 'NumAcc1' ? '(exact)' : `≥ ${sdMin[name] ?? 14}`
    it(`${name} (n = ${d.y.length}): mean LRE ${lreMean.toFixed(2)} ≥ 14, SD LRE ${lreSD.toFixed(2)} ${sdRule}`, () => {
      expect(lreMean).toBeGreaterThanOrEqual(14)
      if (name === 'NumAcc1')
        expect(s).toBe(1) // certified exactly 1
      else expect(lreSD).toBeGreaterThanOrEqual(sdMin[name] ?? 14)
    })
  }
})

describe('mean / sampleSD edge cases', () => {
  it('n = 0 → NaN mean, NaN SD', () => {
    expect(mean([])).toBeNaN()
    expect(sampleSD([])).toBeNaN()
  })
  it('n = 1 → mean defined, SD NaN', () => {
    expect(mean([3.5])).toBe(3.5)
    expect(sampleSD([3.5])).toBeNaN()
  })
  it('n = 2 → SD = |a − b|/√2', () => {
    close(sampleSD([1, 2]), Math.SQRT1_2)
  })
  it('constant data → SD exactly 0', () => {
    expect(sampleSD([0.1, 0.1, 0.1])).toBe(0)
  })
  it('no overflow for |x| ≈ 1e300 and no underflow for spreads ≈ 1e-170', () => {
    close(mean([1e308, 1e308]), 1e308)
    close(sampleSD([1e300, 3e300]), Math.SQRT2 * 1e300, 1e-14)
    close(sampleSD([1e-170, 3e-170]), Math.SQRT2 * 1e-170, 1e-14)
  })
  it('non-finite input → NaN SD (never a fake number)', () => {
    expect(sampleSD([1, Infinity])).toBeNaN()
  })
  it('W_SMALL_SAMPLE percentage ≈ 1/√(2(n−1))', () => {
    expect(sdRelativeUncertaintyPct(3)).toBe(50)
    expect(sdRelativeUncertaintyPct(5)).toBe(35)
  })
})

describe('summarizeColumn', () => {
  it('pendulum observer A: mean, SD, SEM, CI with t(11), median, quartiles, no outliers', () => {
    const ref = pendulum.observerA
    const { view, id } = viewOf(A)
    const s = summarizeColumn(view, id, sampleOf(view, id))
    expect(s.n).toBe(12)
    close(s.mean, Number(ref.mean))
    close(s.sd, Number(ref.sd))
    close(s.sem, Number(ref.sem))
    close(s.tCritical, Number(ref.tCritical))
    close(s.ci![0], Number(ref.ci95[0]))
    close(s.ci![1], Number(ref.ci95[1]))
    close(s.median, 1.73)
    close(s.q1, 1.7)
    close(s.q3, 1.7525)
    close(s.min, 1.7)
    close(s.max, 1.78)
    close(s.range, Number(ref.range))
    expect(s.whiskers).toEqual([1.7, 1.78])
    expect(s.outlierCandidates).toEqual([])
    expect(s.warnings).toEqual([])
  })

  it('pendulum observer B: outlier candidate is the row holding 1.98 (RowId, not index)', () => {
    const rowIds = B.map((_, i) => 100 + i)
    const { view, id } = viewOf(B, rowIds)
    const s = summarizeColumn(view, id, sampleOf(view, id))
    close(s.mean, Number(pendulum.observerB.mean))
    close(s.sd, Number(pendulum.observerB.sd))
    expect(s.fences![0]).toBeCloseTo(1.5775, 12)
    expect(s.whiskers).toEqual([1.61, 1.83])
    expect(s.outlierCandidates).toEqual([100 + B.indexOf(1.98)])
  })

  it('a value lying on the Tukey fence is neither an outlier candidate nor cut from the whisker', () => {
    const { view, id } = viewOf([0.8, 1.1, 1.2, 1.3, 1.5])
    const s = summarizeColumn(view, id, sampleOf(view, id))
    expect(s.fences).toEqual([0.8, 1.6])
    expect(s.whiskers).toEqual([0.8, 1.5])
    expect(s.outlierCandidates).toEqual([])
  })

  it('all 24 pendulum values', () => {
    const ref = pendulum.all
    const { view, id } = viewOf([...A, ...B])
    const s = summarizeColumn(view, id, sampleOf(view, id))
    close(s.mean, Number(ref.mean))
    close(s.sd, Number(ref.sd))
    close(s.ci![0], Number(ref.ci95[0]))
    close(s.ci![1], Number(ref.ci95[1]))
  })

  it('n = 0 → every statistic null', () => {
    const { view, id } = viewOf([null, 'bad'])
    const s = summarizeColumn(view, id, sampleOf(view, id))
    expect(s.n).toBe(0)
    expect(s.nMissing).toBe(1)
    expect(s.nInvalid).toBe(1)
    for (const k of [
      'mean',
      'median',
      'sd',
      'sem',
      'ci',
      'min',
      'max',
      'range',
      'q1',
      'q3',
      'fences',
    ] as const)
      expect(s[k]).toBeNull()
  })

  it('n = 1 → mean/median/min/max only, SD null + I_SINGLE_OBSERVATION, quartiles null + I_QUARTILES_NEED_4', () => {
    const { view, id } = viewOf([2.5, null])
    const s = summarizeColumn(view, id, sampleOf(view, id))
    expect(s.n).toBe(1)
    expect(s.mean).toBe(2.5)
    expect(s.median).toBe(2.5)
    expect(s.min).toBe(2.5)
    expect(s.max).toBe(2.5)
    expect(s.sd).toBeNull()
    expect(s.sem).toBeNull()
    expect(s.ci).toBeNull()
    expect(s.q1).toBeNull()
    const codes = s.warnings.map((w) => w.code)
    expect(codes).toContain('I_SINGLE_OBSERVATION')
    expect(codes).toContain('I_QUARTILES_NEED_4')
    expect(codes).not.toContain('W_SMALL_SAMPLE')
  })

  it('n = 2 → SD, SEM, CI with t(0.975, 1) = 12.706…, W_SMALL_SAMPLE {pct: 71}', () => {
    const { view, id } = viewOf([1, 2])
    const s = summarizeColumn(view, id, sampleOf(view, id))
    close(s.sd, Math.SQRT1_2)
    close(s.sem, 0.5)
    close(s.tCritical, 12.7062047361747, 1e-12)
    close(s.ci![1] - s.ci![0], 2 * 12.7062047361747 * 0.5, 1e-12)
    const w = s.warnings.find((x) => x.code === 'W_SMALL_SAMPLE')
    expect(w?.params?.pct).toBe(71)
    expect(s.q1).toBeNull()
  })

  it('counts every row once: excluded and filtered rows leave n but are counted', () => {
    const { view, id } = viewOf([1, 2, null, 4, 5, 'bad', 7])
    const sample = sampleOf(view, id, [0], [1])
    const s = summarizeColumn(view, id, sample)
    expect(s.n).toBe(3)
    expect([s.nMissing, s.nInvalid, s.nExcluded, s.nFiltered]).toEqual([1, 1, 1, 1])
    expect(s.n + s.nMissing + s.nInvalid + s.nExcluded + s.nFiltered).toBe(sample.nTotal)
    close(s.mean, (4 + 5 + 7) / 3)
  })

  it('missing values never become 0', () => {
    const { view, id } = viewOf([10, null, 20])
    const s = summarizeColumn(view, id, sampleOf(view, id))
    expect(s.mean).toBe(15)
    expect(s.min).toBe(10)
  })

  it('confidence level 0.99 uses t(0.995, n − 1)', () => {
    const { view, id } = viewOf(A)
    const s = summarizeColumn(view, id, sampleOf(view, id), 0.99)
    expect(s.tCritical!).toBeGreaterThan(3)
  })

  it('identical values (n ≥ 2) → SD = SEM = 0 and a zero-width CI, always reported as I_ZERO_SPREAD', () => {
    // e.g. a timer read to 0.1 s: five readings all shown as 1.7
    const { view, id } = viewOf([1.7, 1.7, null, 1.7, 1.7, 1.7])
    const s = summarizeColumn(view, id, sampleOf(view, id))
    expect([s.sd, s.sem]).toEqual([0, 0])
    expect(s.ci).toEqual([1.7, 1.7])
    expect(s.warnings.find((w) => w.code === 'I_ZERO_SPREAD')).toEqual({
      code: 'I_ZERO_SPREAD',
      severity: 'info',
      params: { scope: 'column', n: 5, count: 1 },
      columnId: id,
    })
    // n = 2 identical values as well; n = 1 has no spread at all (I_SINGLE_OBSERVATION instead).
    const two = viewOf([3, 3])
    const twoCodes = summarizeColumn(two.view, two.id, sampleOf(two.view, two.id)).warnings.map((w) => w.code)
    expect(twoCodes).toContain('I_ZERO_SPREAD')
    // A zero SD has no relative uncertainty: no "the SD itself is uncertain by about ±71 %" next to it.
    expect(twoCodes).not.toContain('W_SMALL_SAMPLE')
    const four = viewOf([-0.002, -0.002, -0.002, -0.002])
    expect(
      summarizeColumn(four.view, four.id, sampleOf(four.view, four.id)).warnings.map((w) => w.code),
    ).toEqual(['I_ZERO_SPREAD'])
    const one = viewOf([3, null])
    expect(
      summarizeColumn(one.view, one.id, sampleOf(one.view, one.id)).warnings.map((w) => w.code),
    ).not.toContain('I_ZERO_SPREAD')
    // A real spread, however small, is not zero.
    const tiny = viewOf([1, 1 + 2 ** -52, 1])
    expect(
      summarizeColumn(tiny.view, tiny.id, sampleOf(tiny.view, tiny.id)).warnings.map((w) => w.code),
    ).not.toContain('I_ZERO_SPREAD')
    const a = viewOf(A)
    expect(summarizeColumn(a.view, a.id, sampleOf(a.view, a.id)).warnings.map((w) => w.code)).not.toContain(
      'I_ZERO_SPREAD',
    )
  })
})
