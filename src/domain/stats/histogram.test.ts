import { describe, expect, it } from 'vitest'
import { MAX_HISTOGRAM_BINS, detectResolution, histogram, sturgesBins } from './histogram'

const ids = (n: number) => Array.from({ length: n }, (_, i) => i)
const sum = (a: number[]) => a.reduce((s, x) => s + x, 0)
const isIntegerish = (x: number, tol = 1e-9) => Math.abs(x - Math.round(x)) <= tol

/** Deterministic pseudo-random data (mulberry32). */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pendulum = [
  1.7, 1.75, 1.76, 1.7, 1.72, 1.7, 1.78, 1.72, 1.76, 1.74, 1.75, 1.7, 1.66, 1.72, 1.79, 1.74, 1.77, 1.61,
  1.98, 1.8, 1.83, 1.69, 1.81, 1.79,
]

/** Every member sits in its bin with the [a, b) / last [a, b] convention. */
function checkClosure(values: number[], h: ReturnType<typeof histogram>) {
  const k = h.counts.length
  h.members.forEach((m, j) => {
    expect(m.length).toBe(h.counts[j])
    for (const r of m) {
      const v = values[r]
      expect(v).toBeGreaterThanOrEqual(h.edges[j])
      if (j < k - 1) expect(v).toBeLessThan(h.edges[j + 1])
      else expect(v).toBeLessThanOrEqual(h.edges[j + 1])
    }
  })
  for (let j = 0; j < k; j++) expect(h.edges[j + 1]).toBeGreaterThan(h.edges[j])
}

describe('histogram', () => {
  it('the maximum lying exactly on the last edge is counted (last bin closed)', () => {
    const v = ids(11) // 0..10
    const byCount = histogram(v, ids(11), { mode: 'count', count: 5 })
    expect(byCount.edges).toEqual([0, 2, 4, 6, 8, 10])
    expect(byCount.counts).toEqual([2, 2, 2, 2, 3])
    expect(byCount.members[4]).toContain(10)
    const byWidth = histogram(v, ids(11), { mode: 'width', width: 2, start: 0 })
    expect(byWidth.edges).toEqual([0, 2, 4, 6, 8, 10])
    expect(byWidth.counts).toEqual([2, 2, 2, 2, 3])
    checkClosure(v, byWidth)
  })

  it('max on the last edge with a non-representable width (0.1) is still counted, no extra bin', () => {
    const v = [0, 0.1, 0.2, 0.3]
    const h = histogram(v, ids(4), { mode: 'width', width: 0.1, start: 0 })
    expect(h.counts.length).toBe(3)
    expect(sum(h.counts)).toBe(4)
    checkClosure(v, h)
  })

  it('Σ counts = n for auto, count and width on random data', () => {
    const r = rng(7)
    const v = Array.from({ length: 997 }, () => (r() - 0.3) * 123.456789)
    for (const bins of [
      { mode: 'auto' as const },
      { mode: 'count' as const, count: 13 },
      { mode: 'width' as const, width: 7.5, start: null },
      { mode: 'width' as const, width: 3, start: 50 }, // start above the minimum: extended downwards
    ]) {
      const h = histogram(v, ids(v.length), bins)
      expect(sum(h.counts)).toBe(v.length)
      checkClosure(v, h)
    }
  })

  it('by count: k equal bins from min to max', () => {
    const v = [3, 1, 4, 1, 5, 9, 2, 6]
    const h = histogram(v, ids(8), { mode: 'count', count: 4 })
    expect(h.counts).toHaveLength(4)
    expect(h.edges[0]).toBe(1)
    expect(h.edges[4]).toBe(9)
    expect(h.binWidth).toBe(2)
    expect(h.counts).toEqual([3, 2, 2, 1]) // [1,3) [3,5) [5,7) [7,9]
  })

  it('by width: edges aligned to the given start; a start above the minimum is extended by whole widths', () => {
    const v = [0.4, 1.2, 2.5, 3.9]
    const h = histogram(v, ids(4), { mode: 'width', width: 1, start: 2 })
    expect(h.edges[0]).toBe(0)
    expect(h.edges.every((e) => isIntegerish(e))).toBe(true)
    expect(sum(h.counts)).toBe(4)
    expect(h.binWidth).toBe(1)
  })

  it('IQR = 0 → Sturges bins (FD undefined)', () => {
    const s = Math.SQRT2
    const v = [s, s, s, s, s, s, s, s, 0.1 * Math.sqrt(3), 3 * Math.sqrt(5)]
    expect(detectResolution(v)).toBeNull()
    const h = histogram(v, ids(v.length), { mode: 'auto' })
    expect(h.counts).toHaveLength(sturgesBins(10))
    expect(sturgesBins(10)).toBe(5)
    expect(sum(h.counts)).toBe(10)
  })

  it('auto uses max(Sturges, Freedman–Diaconis)', () => {
    const r = rng(3)
    const v = Array.from({ length: 1000 }, () => Math.PI * (r() + r() + r()))
    const h = histogram(v, ids(1000), { mode: 'auto' })
    expect(h.counts.length).toBeGreaterThanOrEqual(sturgesBins(1000))
    expect(sum(h.counts)).toBe(1000)
  })

  it('data quantised at 0.01 s: width is a multiple of 0.01, edges are offset by 0.005, no value on an edge', () => {
    expect(detectResolution(pendulum)).toBeCloseTo(0.01, 15)
    const h = histogram(pendulum, ids(pendulum.length), { mode: 'auto' })
    expect(isIntegerish(h.binWidth / 0.01)).toBe(true)
    for (const e of h.edges) expect(isIntegerish((e - 0.005) / 0.01, 1e-6)).toBe(true)
    for (const v of pendulum) for (const e of h.edges) expect(Math.abs(v - e)).toBeGreaterThan(0.004)
    expect(sum(h.counts)).toBe(pendulum.length)
    checkClosure(pendulum, h)
  })

  it('resolution: GCD of steps (0.04 for the free-fall times), integers, not quantised', () => {
    expect(detectResolution([0, 0.04, 0.08, 0.12, 0.56])).toBeCloseTo(0.04, 15)
    expect(detectResolution([10, 20, 50])).toBe(10)
    expect(detectResolution([Math.PI, Math.E])).toBeNull()
  })

  it('n = 0 → empty; all values equal → one bin holding every value', () => {
    expect(histogram([], [], { mode: 'auto' })).toEqual({ edges: [], counts: [], members: [], binWidth: NaN })
    const h = histogram([1.7, 1.7, 1.7], [5, 6, 7], { mode: 'auto' })
    expect(h.counts).toEqual([3])
    expect(h.members).toEqual([[5, 6, 7]])
    expect(h.edges[0]).toBeLessThan(1.7)
    expect(h.edges[1]).toBeGreaterThan(1.7)
  })

  it('members are row ids; non-finite values are skipped', () => {
    const h = histogram([1, NaN, 2, 3], [10, 11, 12, 13], { mode: 'count', count: 2 })
    expect(sum(h.counts)).toBe(3)
    expect(h.members.flat().sort()).toEqual([10, 12, 13])
  })

  it('bin count is capped; an invalid width falls back to auto (never throws)', () => {
    const v = [0, 1]
    const tiny = histogram(v, ids(2), { mode: 'width', width: 1e-9, start: null })
    expect(tiny.counts.length).toBeLessThanOrEqual(MAX_HISTOGRAM_BINS)
    expect(sum(tiny.counts)).toBe(2)
    const many = histogram(v, ids(2), { mode: 'count', count: 1e9 })
    expect(many.counts.length).toBe(MAX_HISTOGRAM_BINS)
    const bad = histogram(v, ids(2), { mode: 'width', width: -1, start: null })
    expect(sum(bad.counts)).toBe(2)
  })
})
