import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { groupSummaries, zeroSpreadIssue } from './groups'

const ref = JSON.parse(readFileSync(resolve('tests/fixtures/reference/beerLambert.json'), 'utf8'))
const c = [0, 0, 0, 2, 2, 2, 4, 4, 4, 6, 6, 6, 8, 8, 8, 10, 10, 10]
const A = [
  0.001, 0.001, 0.003, 0.195, 0.194, 0.186, 0.378, 0.384, 0.378, 0.576, 0.575, 0.583, 0.76, 0.761, 0.76,
  0.947, 0.95, 0.949,
]

const close = (got: number | null, want: number, rel = 1e-12) => {
  expect(got).not.toBeNull()
  expect(Math.abs((got as number) - want)).toBeLessThanOrEqual(rel * Math.abs(want))
}

describe('groupSummaries', () => {
  it('Beer–Lambert: 6 groups at identical c, mean / SD / SEM / CI with t(0.975, 2) = 4.30265272974946', () => {
    const rowIds = c.map((_, i) => i + 1)
    const g = groupSummaries(c, Float64Array.from(A), rowIds, () => true, { level: 0.95, numericKey: true })
    expect(g).toHaveLength(6)
    g.forEach((grp, j) => {
      const r = ref.groups[j]
      expect(grp.x).toBe(Number(r.c))
      expect(grp.key).toBe(r.c)
      expect(grp.n).toBe(3)
      close(grp.mean, Number(r.mean))
      close(grp.sd, Number(r.sd), 1e-10)
      close(grp.sem, Number(r.sem), 1e-10)
      close(grp.t, 4.30265272974946, 1e-13)
      close(grp.ciHalf, Number(r.ci95HalfWidth), 1e-10)
      expect(grp.rowIds).toEqual([3 * j + 1, 3 * j + 2, 3 * j + 3])
    })
  })

  it('SD, SEM and CI half-width are different quantities', () => {
    const g = groupSummaries(
      c,
      Float64Array.from(A),
      c.map((_, i) => i),
      () => true,
      { level: 0.95, numericKey: true },
    )
    for (const grp of g) {
      expect(grp.sem!).toBeLessThan(grp.sd!)
      expect(grp.ciHalf!).toBeGreaterThan(grp.sd!)
    }
  })

  it('n_g = 1 → no spread: sd, sem, ciHalf and t are null (never 0)', () => {
    const g = groupSummaries([1, 2, 2], Float64Array.from([5, 6, 8]), [0, 1, 2], () => true, {
      level: 0.95,
      numericKey: true,
    })
    expect(g[0]).toMatchObject({ n: 1, mean: 5, sd: null, sem: null, ciHalf: null, t: null })
    expect(g[1].n).toBe(2)
    expect(g[1].sd).not.toBeNull()
  })

  it('numeric keys ascending; string keys in order of first appearance', () => {
    const num = groupSummaries([10, 2, 10, 2], Float64Array.from([1, 2, 3, 4]), [0, 1, 2, 3], () => true, {
      level: 0.95,
      numericKey: true,
    })
    expect(num.map((g) => g.x)).toEqual([2, 10])
    const str = groupSummaries(['B', 'A', 'B'], Float64Array.from([1, 2, 3]), [0, 1, 2], () => true, {
      level: 0.95,
      numericKey: false,
    })
    expect(str.map((g) => g.key)).toEqual(['B', 'A'])
    expect(str[0].x).toBeNull()
  })

  it('only included rows with finite values are grouped (unbalanced groups after an exclusion)', () => {
    const exclude = new Set([0, 4])
    const g = groupSummaries(
      c,
      Float64Array.from(A),
      c.map((_, i) => i),
      (i) => !exclude.has(i),
      {
        level: 0.95,
        numericKey: true,
      },
    )
    expect(g.map((x) => x.n)).toEqual([2, 2, 3, 3, 3, 3])
    close(g[0].mean, (0.001 + 0.003) / 2)
    const withNaN = groupSummaries([1, 1, 1], Float64Array.from([1, NaN, 3]), [0, 1, 2], () => true, {
      level: 0.95,
      numericKey: true,
    })
    expect(withNaN[0].rowIds).toEqual([0, 2])
    expect(withNaN[0].mean).toBe(2)
  })

  it('confidence 0.99 uses t(0.995, n_g − 1)', () => {
    const g = groupSummaries([1, 1, 1], Float64Array.from([1, 2, 3]), [0, 1, 2], () => true, {
      level: 0.99,
      numericKey: true,
    })
    close(g[0].t, 9.92484320091829, 1e-12)
  })
})

describe('zeroSpreadIssue', () => {
  it('groups of n ≥ 2 identical values → I_ZERO_SPREAD {scope, count, n} with their rows; others → null', () => {
    const keys = ['A', 'A', 'A', 'B', 'B', 'C', 'D', 'D']
    const y = Float64Array.from([0.5, 0.5, 0.5, 0.4, 0.6, 0.7, 0.2, 0.2])
    const g = groupSummaries(keys, y, [10, 11, 12, 13, 14, 15, 16, 17], () => true, {
      level: 0.95,
      numericKey: false,
    })
    // A and D have zero spread (their SD, SEM and CI half-width are exactly 0); C is a single observation.
    expect(g.filter((x) => x.sd === 0).map((x) => [x.key, x.sem, x.ciHalf])).toEqual([
      ['A', 0, 0],
      ['D', 0, 0],
    ])
    expect(zeroSpreadIssue(g)).toEqual({
      code: 'I_ZERO_SPREAD',
      severity: 'info',
      params: { scope: 'groups', count: 2, n: 5 },
      rows: [10, 11, 12, 16, 17],
    })
    expect(zeroSpreadIssue(g.filter((x) => x.key === 'B' || x.key === 'C'))).toBeNull()
    expect(zeroSpreadIssue([])).toBeNull()
  })
})
