import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { DatasetId, FitId, FitModel, FitSpec, SeriesId } from '@/domain/model'
import type { FitResult, SeriesData } from '@/domain/derive/types'
import { readNistLLS } from '@/test/nist'
import { countDistinct, fitPreconditions } from './gates'
import { runFit } from './runFit'

const ids = (n: number) => Int32Array.from({ length: n }, (_, i) => i)
const f64 = (a: readonly (number | string)[]) => Float64Array.from(a, Number)
const gate = (model: FitModel, x: readonly number[], y: readonly number[]) =>
  fitPreconditions(model, f64(x), f64(y), ids(x.length))

function series(x: readonly number[], y: readonly number[], reason?: Uint8Array): SeriesData {
  const n = x.length
  const r = reason ?? new Uint8Array(n)
  const ids_ = ids(n)
  return {
    seriesId: 'ser' as SeriesId,
    datasetId: 'ds' as DatasetId,
    rowIds: ids_,
    x: f64(x),
    y: f64(y),
    sample: {
      rowIds: ids_,
      reason: r,
      nTotal: n,
      nActive: r.filter((v) => v === 0).length,
      counts: { missing: 0, invalid: 0, excluded: 0, filtered: 0 },
    },
    render: new Uint8Array(n),
  }
}
const spec = (model: FitModel): FitSpec => ({
  id: 'fit' as FitId,
  seriesId: 'ser' as SeriesId,
  model,
  confidence: 0.95,
  show: { curve: true, confidenceBand: false, predictionBand: false, residuals: false },
  curveRange: { mode: 'data' },
  style: { color: { mode: 'series' }, dash: 'auto', width: 2 },
  perGroup: false,
})
const fit = (model: FitModel, x: readonly number[], y: readonly number[]): FitResult =>
  runFit(spec(model), series(x, y), { xUnit: null, yUnit: null })
const code = (r: FitResult) => (r.status === 'error' ? r.error.code : 'ok')

describe('fitPreconditions', () => {
  it('n < p + 1 → E_TOO_FEW_POINTS {model, needed, n}', () => {
    const e = gate({ type: 'linear' }, [1, 2], [1, 2])
    expect(e?.code).toBe('E_TOO_FEW_POINTS')
    expect(e?.params).toEqual({ model: 'linear', needed: 3, n: 2 })
    expect(gate({ type: 'polynomial', degree: 3 }, [1, 2, 3, 4], [1, 2, 3, 4])?.params).toEqual({
      model: 'polynomial',
      k: 3,
      needed: 5,
      n: 4,
    })
    expect(gate({ type: 'linear' }, [1, 2, 3], [1, 2, 4])).toBeNull()
  })

  it('constant x → E_CONSTANT_X; relative spread ≤ 1e-12 → E_X_EFFECTIVELY_CONSTANT', () => {
    expect(gate({ type: 'linear' }, [2, 2, 2, 2], [1, 2, 3, 4])?.code).toBe('E_CONSTANT_X')
    expect(gate({ type: 'polynomial', degree: 2 }, [2, 2, 2, 2], [1, 2, 3, 4])?.code).toBe('E_CONSTANT_X')
    const x = [1e6, 1e6 + 1e-7, 1e6 + 2e-7, 1e6 + 3e-7]
    expect(gate({ type: 'linear' }, x, [1, 2, 3, 4])?.code).toBe('E_X_EFFECTIVELY_CONSTANT')
    const ok = [1e6, 1e6 + 1e-3, 1e6 + 2e-3, 1e6 + 3e-3]
    expect(gate({ type: 'linear' }, ok, [1, 2, 3, 4])).toBeNull()
  })

  it('|x| ≈ 1e-170 is NOT constant (no squaring, no underflow)', () => {
    expect(gate({ type: 'linear' }, [1e-170, 2e-170, 3e-170, 4e-170], [1, 2, 3, 4])).toBeNull()
    expect(gate({ type: 'polynomial', degree: 2 }, [1e-170, 2e-170, 3e-170, 4e-170], [1, 2, 3, 5])).toBeNull()
  })

  it('distinct x < p → E_TOO_FEW_DISTINCT_X {k, p, d} (Anscombe IV: linear yes, quadratic no)', () => {
    const sets = JSON.parse(readFileSync(resolve('tests/fixtures/reference/anscombe.json'), 'utf8')).sets
    const x = (sets.IV.x as string[]).map(Number)
    const y = (sets.IV.y as string[]).map(Number)
    expect(gate({ type: 'linear' }, x, y)).toBeNull()
    const e = gate({ type: 'polynomial', degree: 2 }, x, y)
    expect(e?.code).toBe('E_TOO_FEW_DISTINCT_X')
    expect(e?.params).toEqual({ k: 2, p: 3, d: 2 })
  })

  it('log-linear domain: rows listed, never dropped silently', () => {
    const e = gate({ type: 'exponential' }, [1, 2, 3, 4, 5], [1, -2, 3, 0, 5])
    expect(e?.code).toBe('E_LOG_DOMAIN_FIT')
    expect(e?.rows).toEqual([1, 3])
    expect(e?.params).toEqual({ model: 'exponential', count: 2 })
    const p = gate({ type: 'power' }, [-1, 2, 3, 0, 5], [1, 2, 3, 4, 5])
    expect(p?.rows).toEqual([0, 3])
    expect(gate({ type: 'power' }, [1, 2, 3, 4], [1, 2, 3, 4])).toBeNull()
    expect(gate({ type: 'linear' }, [1, 2, 3, 4], [-1, -2, 0, 4])).toBeNull()
  })

  it('filters non-finite values defensively and counts only finite pairs', () => {
    const e = gate({ type: 'linear' }, [1, NaN, 3, Infinity], [1, 2, NaN, 4])
    expect(e?.code).toBe('E_TOO_FEW_POINTS')
    expect(e?.params?.n).toBe(1)
  })

  it('countDistinct uses exact equality', () => {
    expect(countDistinct([1, 1, 2, 2 + 2e-16, 3])).toBe(3)
    expect(countDistinct([1, 1, 1 + Number.EPSILON])).toBe(2)
    expect(countDistinct([])).toBe(0)
  })
})

describe('gates through runFit', () => {
  it('near-duplicate cluster: ε = 1e-4 fits, ε = 1e-8 warns, smaller is refused', () => {
    const y = [1, 1.1, 0.9, 2, 2.1, 1.9, 2.05, 1.95, 2.0]
    const design = (eps: number) => [0, 0, 0, 1, 1, 1, 1 + eps, 1 + eps, 1 + eps]
    const quad = { type: 'polynomial' as const, degree: 2 }
    const a = fit(quad, design(1e-4), y)
    expect(code(a)).toBe('ok')
    expect(a.status === 'ok' && a.warnings.map((w) => w.code)).not.toContain('W_ILL_CONDITIONED')
    const b = fit(quad, design(1e-8), y)
    expect(b.status === 'ok' && b.warnings.map((w) => w.code)).toContain('W_ILL_CONDITIONED')
    expect(code(fit(quad, design(1e-12), y))).toBe('E_ILL_CONDITIONED')
    // Below the relative-spread limit the points are the same x: two distinct values for a quadratic.
    expect(code(fit(quad, design(1e-17), y))).toBe('E_TOO_FEW_DISTINCT_X')
  })

  it('constant y → valid fit, R² undefined', () => {
    const r = fit({ type: 'polynomial', degree: 2 }, [1, 2, 3, 4, 5], [7, 7, 7, 7, 7])
    expect(r.status === 'ok' && r.r2).toBeNull()
    expect(r.status === 'ok' && r.warnings.map((w) => w.code)).toContain('I_R2_UNDEFINED')
  })

  it('Wampler1 → exact fit flagged, SEs null', () => {
    const nist = readNistLLS('Wampler1')
    const r = fit({ type: 'polynomial', degree: 5 }, nist.x, nist.y)
    expect(r.status).toBe('ok')
    if (r.status === 'ok') {
      expect(r.exactFit).toBe(true)
      expect(r.params.every((p) => p.se === null)).toBe(true)
      expect(Math.abs((r.r2 as number) - 1)).toBeLessThanOrEqual(1e-12)
      expect(r.warnings.map((w) => w.code)).toContain('I_EXACT_FIT')
    }
  })

  it('Wampler2 → exact fit flagged', () => {
    const nist = readNistLLS('Wampler2')
    const r = fit({ type: 'polynomial', degree: 5 }, nist.x, nist.y)
    expect(r.status === 'ok' && r.exactFit).toBe(true)
  })

  it('|x| ≈ 1e-170: a correct fit, not E_CONSTANT_X', () => {
    const x = [1, 2, 3, 4, 5, 6].map((k) => k * 1e-170)
    const y = x.map((v, i) => 3 * v * (1 + (i % 2 ? 1e-3 : -1e-3)))
    const r = fit({ type: 'linear' }, x, y)
    expect(code(r)).toBe('ok')
    if (r.status === 'ok') {
      expect(r.params[1].value).toBeCloseTo(3, 2)
      expect(r.params[1].se as number).toBeGreaterThan(0)
      expect(r.r2 as number).toBeGreaterThan(0.99)
    }
    // Quadratic: SE(a₂) ≈ s/h² ≈ 1e167, so Var(a₂) ≈ 1e334 cannot be represented → E_OVERFLOW
    // ("change units"), never a false "all x identical".
    const q = fit({ type: 'polynomial', degree: 2 }, x, y)
    expect(['ok', 'E_OVERFLOW']).toContain(code(q))
    expect(code(q)).not.toBe('E_CONSTANT_X')
    expect(code(q)).not.toBe('E_X_EFFECTIVELY_CONSTANT')
  })

  it('1e200 values never crash: representable results or E_OVERFLOW ("change units")', () => {
    const x = [1, 2, 3, 4, 5, 6].map((k) => k * 1e200)
    const yBig = x.map((v, i) => 2 * v + (i % 2 ? 1e199 : -1e199))
    // s ≈ 1e199 → RSS and Var(b₀) exceed the double range.
    expect(code(fit({ type: 'linear' }, x, yBig))).toBe('E_OVERFLOW')
    expect(code(fit({ type: 'polynomial', degree: 2 }, x, yBig))).toBe('E_OVERFLOW')
    // x huge, y moderate: slope ≈ 1e-200 is representable and correct.
    const yMod = [1.1, 1.9, 3.2, 3.9, 5.1, 6.0]
    const r = fit({ type: 'linear' }, x, yMod)
    expect(code(r)).toBe('ok')
    const unscaled = fit({ type: 'linear' }, [1, 2, 3, 4, 5, 6], yMod)
    if (r.status === 'ok' && unscaled.status === 'ok') {
      expect(r.params[1].value / 1e-200 / unscaled.params[1].value).toBeCloseTo(1, 12)
      expect((r.params[1].se as number) / 1e-200 / (unscaled.params[1].se as number)).toBeCloseTo(1, 12)
    }
  })

  it('fuzz: random data (NaN, ±Infinity, duplicates, extremes) never throws', () => {
    let seed = 20261014
    const rnd = () => {
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    const specials = [
      NaN,
      Infinity,
      -Infinity,
      0,
      -0,
      1e-300,
      1e300,
      1e-170,
      1e200,
      -1e200,
      5e-324,
      1.7e308,
      -1.7e308,
    ]
    const value = () => {
      const r = rnd()
      if (r < 0.1) return specials[Math.floor(rnd() * specials.length)]
      if (r < 0.25) return Math.round(rnd() * 3)
      return (rnd() - 0.5) * 10 ** Math.floor(rnd() * 20 - 10)
    }
    const models: FitModel[] = [
      { type: 'linear' },
      { type: 'exponential' },
      { type: 'power' },
      ...Array.from({ length: 10 }, (_, k) => ({ type: 'polynomial' as const, degree: k + 1 })),
    ]
    const seen = new Set<string>()
    for (let trial = 0; trial < 600; trial++) {
      const n = Math.floor(rnd() * 25)
      const x = Array.from({ length: n }, value)
      const y = Array.from({ length: n }, value)
      const reason = Uint8Array.from({ length: n }, () => (rnd() < 0.15 ? 1 + Math.floor(rnd() * 4) : 0))
      const model = models[Math.floor(rnd() * models.length)]
      let r: FitResult | undefined
      expect(() => {
        r = runFit(spec(model), series(x, y, reason), { xUnit: 'a', yUnit: 'b' })
      }).not.toThrow()
      seen.add(code(r as FitResult))
      if (r?.status === 'ok') {
        for (const p of r.params) expect(Number.isFinite(p.value)).toBe(true)
        expect(Number.isFinite(r.s)).toBe(true)
      }
    }
    expect(seen.size).toBeGreaterThan(3)
  })
})
