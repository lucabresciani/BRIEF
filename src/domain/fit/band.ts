import type { FitBasis, FitOk } from '@/domain/derive/types'
import { horner, solveRTranspose } from './polyQR'

/** ln of the largest finite double (exp overflows above) and of the smallest subnormal. */
export const EXP_MAX = 709.78
export const EXP_MIN = -745.13

/** exp() for curves: NaN above EXP_MAX (the curve stops: W_CURVE_TRUNCATED), 0 below EXP_MIN. */
function expCurve(eta: number): number {
  if (eta > EXP_MAX) return NaN
  if (eta < EXP_MIN) return 0
  return Math.exp(eta)
}

/** Regressor of a log-linear basis: x (exponential) or ln x (power; NaN for x ≤ 0). */
function logRegressor(basis: Extract<FitBasis, { kind: 'logLinear' }>, x: number): number {
  if (basis.x === 'identity') return x
  return x > 0 ? Math.log(x) : NaN
}

/** Linear predictor in the fitted space (y for linear/polynomial, ln y for log-linear). */
function fittedSpace(basis: FitBasis, x: number): number {
  switch (basis.kind) {
    case 'linear':
      return basis.b0 + basis.b1 * x
    case 'scaledPoly':
      return basis.sy * horner(basis.c, (x - basis.m) / basis.h)
    case 'logLinear':
      return basis.lnA + basis.b * logRegressor(basis, x)
  }
}

/**
 * Fitted value ŷ(x). Polynomials are ALWAYS evaluated by Horner in the scaled t basis (never with
 * the back-transformed monomial coefficients); log-linear models as exp(ln a + b·X), the
 * geometric-mean (median) prediction, computed in log space.
 */
export function predict(fit: FitOk, x: number): number {
  const eta = fittedSpace(fit.basis, x)
  return fit.basis.kind === 'logLinear' ? expCurve(eta) : eta
}

/** √(v₀ᵀ(XᵀX)⁻¹v₀) of the fitted mean at x, in units of s (the fitted space). */
function leverageFactor(fit: FitOk, x: number): number {
  const b = fit.basis
  switch (b.kind) {
    case 'linear':
    case 'logLinear': {
      const X = b.kind === 'linear' ? x : logRegressor(b, x)
      const u = (X - b.xbar) / b.xScale
      return Math.sqrt(1 / fit.provenance.nUsed + (u * u) / b.suu)
    }
    case 'scaledPoly': {
      const t = (x - b.m) / b.h
      const v: number[] = []
      let pw = 1
      for (let j = 0; j < b.c.length; j++) {
        v.push(pw)
        pw *= t
      }
      const w = solveRTranspose(b.r, v)
      let q = 0
      for (const wj of w) q += wj * wj
      return Math.sqrt(q)
    }
  }
}

/**
 * POINTWISE bands at the given x: confidence band of the fitted mean ŷ ± t·s·√(v₀ᵀ(XᵀX)⁻¹v₀), or
 * prediction band for ONE new observation ŷ ± t·s·√(1 + v₀ᵀ(XᵀX)⁻¹v₀) (assumes constant, normal,
 * independent scatter). Not simultaneous bands. Polynomials solve Rᵀw = v₀ in the scaled basis;
 * log-linear models build the band in ln space and exponentiate it, so it is asymmetric in y.
 * Exact fits have no estimable scatter: lower/upper are NaN (no band rather than a zero-width one).
 */
export function band(
  fit: FitOk,
  xs: readonly number[],
  kind: 'confidence' | 'prediction',
): { x: number[]; yhat: number[]; lower: number[]; upper: number[] } {
  const t = fit.provenance.tCritical
  const usable = !fit.exactFit && t !== null && Number.isFinite(t) && fit.s > 0
  const log = fit.basis.kind === 'logLinear'
  const out = { x: [...xs], yhat: [] as number[], lower: [] as number[], upper: [] as number[] }
  for (const x of xs) {
    const eta = fittedSpace(fit.basis, x)
    out.yhat.push(log ? expCurve(eta) : eta)
    if (!usable || !Number.isFinite(eta)) {
      out.lower.push(NaN)
      out.upper.push(NaN)
      continue
    }
    const g = leverageFactor(fit, x)
    const half = (t as number) * fit.s * (kind === 'prediction' ? Math.sqrt(1 + g * g) : g)
    out.lower.push(log ? expCurve(eta - half) : eta - half)
    out.upper.push(log ? expCurve(eta + half) : eta + half)
  }
  return out
}
