import { INACTIVE, issue, modelParameterCount, type FitSpec, type Issue, type RowId } from '@/domain/model'
import type {
  ErrorBarArrays,
  EquationTokens,
  FitBasis,
  FitError,
  FitErrorCode,
  FitOk,
  FitParameter,
  FitProvenance,
  FitResult,
  SeriesData,
} from '@/domain/derive/types'
import { superscript } from '@/domain/format/number'
import {
  fewDofIssue,
  highLeverageIssue,
  isExactFit,
  leverageSummary,
  rSquared,
  residualSignRuns,
  roundingNoiseScale,
  uComparison,
} from './diagnostics'
import { logLinearEquation, polynomialEquation, subscripted } from './equation'
import { fitPreconditions } from './gates'
import { fitLinear } from './linear'
import { fitPolynomial, horner, polyCoefficientsAt } from './polyQR'
import { fitLogLinear } from './transformFits'

const MIN_NORMAL = 2.2250738585072014e-308
type FitIssue = Issue & { code: FitErrorCode }

// ---- units -------------------------------------------------------------------------------------

const wrapNumerator = (u: string) => (u.includes('/') ? `(${u})` : u)
const wrapDenominator = (u: string) => (/[/·*\s^⁰¹²³⁴⁵⁶⁷⁸⁹⁻]/.test(u) ? `(${u})` : u)

/** Unit of the coefficient of xᵏ: y/xᵏ, written literally ("V/A", "m/s²"); null if a unit is unknown. */
export function coefficientUnit(yUnit: string | null, xUnit: string | null, power: number): string | null {
  if (power === 0) return yUnit
  if (yUnit === null || xUnit === null) return null
  return `${wrapNumerator(yUnit)}/${wrapDenominator(xUnit)}${power === 1 ? '' : superscript(power)}`
}

// ---- shared assembly ---------------------------------------------------------------------------

interface CoreFit {
  algorithm: FitProvenance['algorithm']
  params: FitParameter[]
  basis: FitBasis
  covariance: number[][]
  /** Covariance rows/columns that are NaN by design (the `a` of log-linear models). */
  covarianceUndefined: number[]
  df: number
  s: number
  rss: number
  /** Response actually fitted (y or ln y), residuals in that space, leverage; aligned with used rows. */
  response: Float64Array
  residuals: Float64Array
  leverage: Float64Array
  kappa1: number
  tCritical: number
  degree: number
  p: number
  r2Of: 'y' | 'lnY'
  warnings: Issue[]
  /** Equation builder (needs the final exactFit/params). */
  equation: (
    params: readonly FitParameter[],
    exactFit: boolean,
  ) => { tokens: EquationTokens; issue: Issue | null }
}

function baseProvenance(
  spec: FitSpec,
  data: SeriesData,
  rowIdsUsed: RowId[],
): Omit<FitProvenance, 'algorithm' | 'tCritical'> {
  return {
    rowIdsUsed,
    nUsed: rowIdsUsed.length,
    nTotal: data.sample.nTotal,
    inactive: { ...data.sample.counts },
    usesGroupMeans: false,
    confidence: spec.confidence,
  }
}

const algorithmOf = (spec: FitSpec): FitProvenance['algorithm'] =>
  spec.model.type === 'linear'
    ? 'ols-linear-centred@1'
    : spec.model.type === 'polynomial'
      ? 'ols-householder-scaled@1'
      : 'ols-loglinear@1'

function failure(spec: FitSpec, data: SeriesData, rows: RowId[], error: FitIssue): FitError {
  return {
    status: 'error',
    fitId: spec.id,
    model: spec.model,
    error,
    provenance: { ...baseProvenance(spec, data, rows), algorithm: algorithmOf(spec), tCritical: null },
  }
}

/** κ₁ of R for the centred, scaled design [1, u] (orthogonal columns: diag(√n, √Σu²)). */
function kappaCentred(n: number, suu: number): number {
  const a = Math.sqrt(n)
  const b = Math.sqrt(suu)
  return Math.max(a, b) / Math.min(a, b)
}

function param(
  symbol: string,
  value: number,
  se: number,
  ci: readonly [number, number],
  unit: string | null,
): FitParameter {
  return { symbol, value, se, ci: [ci[0], ci[1]], unit }
}

function linearCore(
  x: Float64Array,
  y: Float64Array,
  rows: Int32Array,
  spec: FitSpec,
  units: { xUnit: string | null; yUnit: string | null },
): CoreFit {
  const L = fitLinear(x, y, rows, spec.confidence)
  const params = [
    param('b₀', L.b0, L.se0, L.ci0, units.yUnit),
    param('b₁', L.b1, L.se1, L.ci1, coefficientUnit(units.yUnit, units.xUnit, 1)),
  ]
  const coefficientsAt = (x0: number) => {
    const u = (x0 - L.xbar) / L.xScale
    return {
      values: [L.ybar + L.b1 * (x0 - L.xbar), L.b1],
      se: [L.s * Math.sqrt(1 / L.n + (u * u) / L.suu), L.se1],
    }
  }
  return {
    algorithm: 'ols-linear-centred@1',
    params,
    basis: { kind: 'linear', b0: L.b0, b1: L.b1, xbar: L.xbar, sxx: L.sxx, xScale: L.xScale, suu: L.suu },
    covariance: [
      [L.var0, L.cov01],
      [L.cov01, L.var1],
    ],
    covarianceUndefined: [],
    df: L.df,
    s: L.s,
    rss: L.rss,
    response: y,
    residuals: L.residuals,
    leverage: L.leverage,
    kappa1: kappaCentred(L.n, L.suu),
    tCritical: L.tCritical,
    degree: 1,
    p: 2,
    r2Of: 'y',
    warnings: [],
    equation: (ps, exactFit) =>
      polynomialEquation({
        params: ps,
        coefficientsAt,
        curve: (v) => L.b0 + L.b1 * v,
        x,
        s: L.s,
        exactFit,
        tCritical: L.tCritical,
      }),
  }
}

function polynomialCore(
  x: Float64Array,
  y: Float64Array,
  rows: Int32Array,
  degree: number,
  spec: FitSpec,
  units: { xUnit: string | null; yUnit: string | null },
): CoreFit | FitIssue {
  const P = fitPolynomial(x, y, rows, degree, spec.confidence)
  if ('code' in P) return P
  const params = P.coefficients.map((b, k) =>
    param(subscripted('a', k), b, P.se[k], P.ci[k], coefficientUnit(units.yUnit, units.xUnit, k)),
  )
  return {
    algorithm: 'ols-householder-scaled@1',
    params,
    basis: { kind: 'scaledPoly', m: P.m, h: P.h, sy: P.sy, c: P.c, r: P.r },
    covariance: P.covariance,
    covarianceUndefined: [],
    df: P.df,
    s: P.s,
    rss: P.rss,
    response: y,
    residuals: P.residuals,
    leverage: P.leverage,
    kappa1: P.kappa1,
    tCritical: P.tCritical,
    degree,
    p: P.p,
    r2Of: 'y',
    warnings: P.warnings,
    equation: (ps, exactFit) =>
      polynomialEquation({
        params: ps,
        coefficientsAt: (x0) => polyCoefficientsAt(P, x0),
        curve: (v) => P.sy * horner(P.c, (v - P.m) / P.h),
        x,
        s: P.s,
        exactFit,
        tCritical: P.tCritical,
      }),
  }
}

function logLinearCore(
  model: 'exponential' | 'power',
  x: Float64Array,
  y: Float64Array,
  rows: Int32Array,
  spec: FitSpec,
  units: { xUnit: string | null; yUnit: string | null },
): CoreFit | FitIssue {
  const G = fitLogLinear(model, x, y, rows, spec.confidence)
  if ('code' in G) return G
  const L = G.linear
  const aUnit =
    model === 'exponential'
      ? units.yUnit
      : units.yUnit !== null && units.xUnit !== null
        ? `${wrapNumerator(units.yUnit)}/${wrapDenominator(units.xUnit)}^b`
        : null
  const bUnit = model === 'exponential' && units.xUnit !== null ? `1/${wrapDenominator(units.xUnit)}` : null
  const a: FitParameter = {
    symbol: 'a',
    value: G.a,
    se: null,
    ci: [G.aCI[0], G.aCI[1]],
    unit: aUnit,
    note: 'asymmetric-ci',
  }
  const params = [a, param('b', L.b1, L.se1, L.ci1, bUnit), param('ln a', L.b0, L.se0, L.ci0, null)]
  return {
    algorithm: 'ols-loglinear@1',
    params,
    basis: {
      kind: 'logLinear',
      lnA: G.lnA,
      b: G.b,
      x: model === 'power' ? 'ln' : 'identity',
      xbar: L.xbar,
      xScale: L.xScale,
      suu: L.suu,
    },
    // Order [a, b, ln a]; a has no symmetric (co)variance by design.
    covariance: [
      [NaN, NaN, NaN],
      [NaN, L.var1, L.cov01],
      [NaN, L.cov01, L.var0],
    ],
    covarianceUndefined: [0],
    df: L.df,
    s: L.s,
    rss: L.rss,
    response: G.Y,
    residuals: L.residuals,
    leverage: L.leverage,
    kappa1: kappaCentred(L.n, L.suu),
    tCritical: L.tCritical,
    degree: 1,
    p: 2,
    r2Of: 'lnY',
    warnings: [],
    equation: (ps) => ({ tokens: logLinearEquation(ps[0], ps[1]), issue: null }),
  }
}

/** Every reported number must be representable; otherwise E_OVERFLOW ("change units"). */
function representable(core: CoreFit, exactFit: boolean): boolean {
  const finite = Number.isFinite
  if (!finite(core.s) || !finite(core.rss)) return false
  for (const p of core.params) {
    if (!finite(p.value)) return false
    if (exactFit) continue
    if (p.se !== null && (!finite(p.se) || (core.s > 0 && p.se < MIN_NORMAL))) return false
    if (p.ci && (!finite(p.ci[0]) || !finite(p.ci[1]))) return false
  }
  for (let k = 0; k < core.covariance.length; k++) {
    if (core.covarianceUndefined.includes(k) || exactFit) continue
    for (let l = 0; l < core.covariance.length; l++) {
      if (!core.covarianceUndefined.includes(l) && !finite(core.covariance[k][l])) return false
    }
  }
  for (let i = 0; i < core.residuals.length; i++) if (!finite(core.residuals[i])) return false
  return true
}

/**
 * The ONLY fit entry point used by the pipeline: FitSpec + SeriesData → FitResult.
 *
 * Uses exactly the rows with data.sample.reason === INACTIVE.active (the pairwise analysis sample);
 * axis scales and other display settings never reach it. Fits are unweighted OLS on the individual
 * observations (never group means); the SE comes from the residual scatter s with df = n − p
 * (seSource 'residual-scatter'); supplied u(y) are only compared with s (uComparison), never used as
 * weights. Never throws for problems in user data: they become a FitError with a reason code.
 * An active row with ±Infinity (an overflowed number in the file) → E_OVERFLOW with the rows; a NaN in
 * an active row cannot come from a valid sample and is skipped defensively.
 */
export function runFit(
  spec: FitSpec,
  data: SeriesData,
  opts: { xUnit: string | null; yUnit: string | null; yUncertainty?: ErrorBarArrays | null },
): FitResult {
  const len = data.rowIds.length
  if (data.x.length !== len || data.y.length !== len || data.sample.reason.length !== len)
    throw new RangeError('SeriesData arrays are not aligned')

  const used: number[] = []
  const overflowRows: RowId[] = []
  for (let i = 0; i < len; i++) {
    if (data.sample.reason[i] !== INACTIVE.active) continue
    const xi = data.x[i]
    const yi = data.y[i]
    if (Number.isNaN(xi) || Number.isNaN(yi)) continue
    if (!Number.isFinite(xi) || !Number.isFinite(yi)) {
      overflowRows.push(data.rowIds[i] as RowId)
      continue
    }
    used.push(i)
  }
  const n = used.length
  const x = new Float64Array(n)
  const y = new Float64Array(n)
  const rows = new Int32Array(n)
  for (let j = 0; j < n; j++) {
    x[j] = data.x[used[j]]
    y[j] = data.y[used[j]]
    rows[j] = data.rowIds[used[j]]
  }
  const rowIdsUsed = Array.from(rows) as RowId[]
  if (overflowRows.length > 0)
    return failure(
      spec,
      data,
      rowIdsUsed,
      issue('E_OVERFLOW', { stage: 'input', count: overflowRows.length }, { rows: overflowRows }) as FitIssue,
    )

  const gate = fitPreconditions(spec.model, x, y, rows)
  if (gate) return failure(spec, data, rowIdsUsed, gate)

  const units = { xUnit: opts.xUnit, yUnit: opts.yUnit }
  const model = spec.model
  let core: CoreFit | FitIssue
  switch (model.type) {
    case 'linear':
      core = linearCore(x, y, rows, spec, units)
      break
    case 'polynomial':
      core = polynomialCore(x, y, rows, model.degree, spec, units)
      break
    case 'exponential':
    case 'power':
      core = logLinearCore(model.type, x, y, rows, spec, units)
      break
  }
  if ('code' in core) return failure(spec, data, rowIdsUsed, core)

  const exactFit = isExactFit(core.s, roundingNoiseScale(core.basis, x, core.response))
  if (!representable(core, exactFit))
    return failure(spec, data, rowIdsUsed, issue('E_OVERFLOW', { stage: 'result' }) as FitIssue)

  const params: FitParameter[] = exactFit
    ? core.params.map((p) => ({ ...p, se: null, ci: null }))
    : core.params
  const covariance = exactFit ? core.covariance.map((row) => row.map(() => NaN)) : core.covariance

  const { r2, adjR2, responseConstant } = rSquared(core.response, core.residuals, modelParameterCount(model))
  if ((r2 !== null && !Number.isFinite(r2)) || (adjR2 !== null && !Number.isFinite(adjR2)))
    return failure(spec, data, rowIdsUsed, issue('E_OVERFLOW', { stage: 'r2' }) as FitIssue)
  const maxLeverage = leverageSummary(core.leverage, rows)
  const equation = core.equation(params, exactFit)

  const warnings: Issue[] = [...core.warnings]
  const fewDof = fewDofIssue(core.df, core.degree, n, spec.confidence)
  if (fewDof) warnings.push(fewDof)
  const lev = highLeverageIssue(maxLeverage)
  if (lev) warnings.push(lev)
  if (exactFit) warnings.push(issue('I_EXACT_FIT', { s: core.s }))
  if (responseConstant) warnings.push(issue('I_R2_UNDEFINED'))
  if (equation.issue) warnings.push(equation.issue)

  const ok: FitOk = {
    status: 'ok',
    fitId: spec.id,
    model,
    params,
    basis: core.basis,
    covariance,
    df: core.df,
    s: core.s,
    rss: core.rss,
    r2,
    adjR2,
    r2Of: core.r2Of,
    seSource: 'residual-scatter',
    uComparison: core.r2Of === 'y' ? uComparison(opts.yUncertainty, used, core.s) : null,
    kappa1: core.kappa1,
    maxLeverage,
    exactFit,
    residuals: core.residuals,
    residualX: x,
    residualSignRuns: residualSignRuns(core.residuals, x, rows, core.s, exactFit),
    equation: equation.tokens,
    warnings,
    provenance: {
      ...baseProvenance(spec, data, rowIdsUsed),
      algorithm: core.algorithm,
      tCritical: Number.isFinite(core.tCritical) ? core.tCritical : null,
    },
  }
  return ok
}
