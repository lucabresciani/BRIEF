import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isOutsideFences, quantile7, sortedCopy, tukey } from './quantile'

const pendulum = JSON.parse(readFileSync(resolve('tests/fixtures/reference/pendulum.json'), 'utf8'))
const A = [1.7, 1.75, 1.76, 1.7, 1.72, 1.7, 1.78, 1.72, 1.76, 1.74, 1.75, 1.7]
const B = [1.66, 1.72, 1.79, 1.74, 1.77, 1.61, 1.98, 1.8, 1.83, 1.69, 1.81, 1.79]

const close = (got: number, want: number, rel = 1e-12) =>
  expect(Math.abs(got - want)).toBeLessThanOrEqual(rel * Math.max(1, Math.abs(want)))

describe('quantile7 (R type 7)', () => {
  it('[1,2,3,4] → 1.75 / 2.5 / 3.25', () => {
    const s = sortedCopy([4, 1, 3, 2])
    expect(quantile7(s, 0.25)).toBe(1.75)
    expect(quantile7(s, 0.5)).toBe(2.5)
    expect(quantile7(s, 0.75)).toBe(3.25)
  })

  it('[3,6,7,8,8,9,10,13,15,16,20] → 7.5 / 9 / 14', () => {
    const s = sortedCopy([3, 6, 7, 8, 8, 9, 10, 13, 15, 16, 20])
    expect(quantile7(s, 0.25)).toBe(7.5)
    expect(quantile7(s, 0.5)).toBe(9)
    expect(quantile7(s, 0.75)).toBe(14)
  })

  it('extremes, n = 0 and n = 1', () => {
    const s = sortedCopy([5, -1, 2])
    expect(quantile7(s, 0)).toBe(-1)
    expect(quantile7(s, 1)).toBe(5)
    expect(quantile7([], 0.5)).toBeNaN()
    expect(quantile7([7], 0.25)).toBe(7)
  })

  it('sorts numerically, never lexicographically', () => {
    expect(Array.from(sortedCopy([10, 9, 100, -2]))).toEqual([-2, 9, 10, 100])
  })

  it('p outside [0, 1] is a programmer error', () => {
    expect(() => quantile7([1, 2], 1.5)).toThrow(RangeError)
    expect(() => quantile7([1, 2], NaN)).toThrow(RangeError)
  })
})

describe('tukey', () => {
  it('n < 4 → null', () => {
    expect(tukey(sortedCopy([1, 2, 3]))).toBeNull()
  })

  it('pendulum observer A: Q3 = 1.7525 (type 7; Plotly would give 1.755), no outlier', () => {
    const ref = pendulum.observerA
    const t = tukey(sortedCopy(A))!
    close(t.q1, Number(ref.q1))
    close(t.median, Number(ref.median))
    close(t.q3, 1.7525)
    close(t.iqr, Number(ref.iqr))
    close(t.fences[0], Number(ref.fences[0]))
    close(t.fences[1], Number(ref.fences[1]))
    expect(t.whiskers).toEqual([1.7, 1.78])
    expect(A.filter((v) => isOutsideFences(v, t.fences))).toEqual([])
  })

  it('pendulum observer B: fences [1.5775, 1.9375], whiskers are OBSERVED values [1.61, 1.83], outlier 1.98', () => {
    const ref = pendulum.observerB
    const t = tukey(sortedCopy(B))!
    close(t.q1, Number(ref.q1))
    close(t.q3, Number(ref.q3))
    close(t.fences[0], 1.5775)
    close(t.fences[1], 1.9375)
    expect(t.whiskers).toEqual([1.61, 1.83])
    // The whisker end is a measurement, never the fence value.
    expect(B).toContain(t.whiskers[0])
    expect(B).toContain(t.whiskers[1])
    expect(t.whiskers[0]).not.toBeCloseTo(1.5775, 6)
    expect(B.filter((v) => isOutsideFences(v, t.fences))).toEqual([1.98])
  })

  it('all 24 pendulum values', () => {
    const ref = pendulum.all
    const t = tukey(sortedCopy([...A, ...B]))!
    close(t.median, Number(ref.median))
    close(t.q1, Number(ref.q1))
    close(t.q3, Number(ref.q3))
    expect(t.whiskers).toEqual(ref.whiskers.map(Number))
  })

  it('a value ON a fence is inside it, whatever the binary noise of q1 − 1.5·IQR', () => {
    // q1 = 1.1, q3 = 1.3: 1.1 − 1.5·0.2 is the double 0.8000000000000002, exactly 0.8 in decimals.
    expect(1.1 - 1.5 * (1.3 - 1.1)).toBe(0.8000000000000002)
    const v = [0.8, 1.1, 1.2, 1.3, 1.5]
    const t = tukey(sortedCopy(v))!
    expect(t.fences).toEqual([0.8, 1.6])
    expect(t.whiskers).toEqual([0.8, 1.5])
    expect(v.filter((x) => isOutsideFences(x, t.fences))).toEqual([])
    // Genuinely outside by less than the old noise, but more than 1e-15 relative: still a candidate.
    const w = [0.7999999999999, 1.1, 1.2, 1.3, 1.5]
    expect(isOutsideFences(0.7999999999999, tukey(sortedCopy(w))!.fences)).toBe(true)
  })

  it('IQR = 0: fences collapse onto the observed value', () => {
    const t = tukey(sortedCopy([2, 2, 2, 2, 2, 9]))!
    expect(t.iqr).toBe(0)
    expect(t.whiskers).toEqual([2, 2])
    expect(isOutsideFences(9, t.fences)).toBe(true)
  })
})
