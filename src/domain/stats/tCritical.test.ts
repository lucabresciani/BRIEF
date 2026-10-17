import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { studentTwoSided, tCritical } from './tCritical'

const table = JSON.parse(readFileSync(resolve('tests/fixtures/reference/t-table.json'), 'utf8')) as {
  entries: { confidence: number; df: number; t: string }[]
}

describe('tCritical', () => {
  it('matches the independent oracle table to 1e-12 relative', () => {
    let worst = 0
    for (const e of table.entries) {
      const ref = Number(e.t)
      const rel = Math.abs(tCritical(e.confidence, e.df) - ref) / ref
      worst = Math.max(worst, rel)
    }
    expect(worst).toBeLessThan(1e-12)
  })

  it('uses the two-sided quantile (95 % → p = 0.975)', () => {
    expect(tCritical(0.95, 10)).toBeCloseTo(2.22813885198627, 13)
    expect(tCritical(0.95, 2)).toBeCloseTo(4.30265272974946, 13)
    expect(tCritical(0.9, 1)).toBeCloseTo(6.31375151467504, 12)
    expect(studentTwoSided(tCritical(0.99, 7), 7)).toBeCloseTo(0.99, 14)
  })

  it('rejects invalid arguments', () => {
    expect(() => tCritical(0.95, 0)).toThrow(RangeError)
    expect(() => tCritical(1, 5)).toThrow(RangeError)
    expect(() => tCritical(0, 5)).toThrow(RangeError)
    expect(() => tCritical(0.95, 2.5)).toThrow(RangeError)
  })
})
