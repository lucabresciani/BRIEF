/**
 * Derived columns (non-destructive transformations). The inputs are never modified; a derived
 * value is recomputed from them every time.
 * Domains: ln and log10 need x > 0, sqrt x ≥ 0, reciprocal x ≠ 0, ratio a denominator ≠ 0; a result
 * that is not finite (overflow) is out of domain as well. Out-of-domain rows get CELL.domain + NaN and
 * are ALL listed in report.invalidExamples with code E_TRANSFORM_DOMAIN (the pipeline turns them into
 * one E_TRANSFORM_DOMAIN {count, op} issue). Missing/invalid inputs propagate their own status.
 */
import type { ColumnId, ReasonCode, RowId, TransformSpec } from '@/domain/model'
import { MAX_INVALID_EXAMPLES, invalidCode } from './parseColumn'
import { CELL, isMissingStatus } from './types'
import type { CellStatus, ParseReport, ParsedColumn } from './types'

/** Input column ids of a transform (one for unary ops, two for binary ones). */
export function transformInputs(spec: TransformSpec): ColumnId[] {
  return 'input' in spec ? [spec.input] : [spec.left, spec.right]
}

type Unary = (v: number) => number

function unaryOp(spec: Extract<TransformSpec, { input: ColumnId }>): Unary {
  switch (spec.op) {
    case 'ln':
      return (v) => (v > 0 ? Math.log(v) : NaN)
    case 'log10':
      return (v) => (v > 0 ? Math.log10(v) : NaN)
    case 'sqrt':
      return (v) => (v >= 0 ? Math.sqrt(v) : NaN)
    case 'reciprocal':
      return (v) => (v !== 0 ? 1 / v : NaN)
    case 'square':
      return (v) => v * v
    case 'affine': {
      const { a, b } = spec
      return (v) => a * v + b
    }
  }
}

function binaryOp(op: 'difference' | 'ratio' | 'product'): (l: number, r: number) => number {
  switch (op) {
    case 'difference':
      return (l, r) => l - r
    case 'ratio':
      return (l, r) => (r !== 0 ? l / r : NaN)
    case 'product':
      return (l, r) => l * r
  }
}

/**
 * Status of an input cell: its own status, or invalid when it is "ok" but not a finite number (a label).
 * An input that is itself out of ANOTHER transform's domain is invalid here: CELL.domain is reserved
 * for the rows outside this transform's own domain.
 */
function inputStatus(col: ParsedColumn | undefined, i: number): CellStatus {
  if (!col || i >= col.status.length) return CELL.missing
  const s = col.status[i] as CellStatus
  if (s === CELL.domain) return CELL.invalid
  if (s === CELL.ok && !Number.isFinite(col.values[i])) return CELL.invalid
  return s
}

/**
 * Computes a derived column. `rowIds` (aligned with the inputs, i.e. the DatasetView rows) gives the
 * RowIds of the report and the row count when an input column is absent (then every row is missing).
 */
export function applyTransform(
  spec: TransformSpec,
  inputs: (id: ColumnId) => ParsedColumn | undefined,
  columnId: ColumnId,
  rowIds?: ArrayLike<number>,
): ParsedColumn {
  const ids = transformInputs(spec)
  const cols = ids.map((id) => inputs(id))
  const n = rowIds ? rowIds.length : Math.max(0, ...cols.map((c) => (c ? c.values.length : 0)))
  const rowIdOf = (i: number) => (rowIds ? rowIds[i] : i) as RowId
  const values = new Float64Array(n).fill(NaN)
  const status = new Uint8Array(n)
  const text: string[] = new Array(n).fill('')
  const report: ParseReport = {
    nRows: n,
    nValid: 0,
    nMissing: 0,
    nSheetError: 0,
    nInvalid: 0,
    invalidExamples: [],
    missingTokens: [],
  }
  let otherExamples = 0
  const unary = 'input' in spec ? unaryOp(spec) : null
  const binary = 'input' in spec ? null : binaryOp(spec.op)

  for (let i = 0; i < n; i++) {
    let s: CellStatus
    if (unary) s = inputStatus(cols[0], i)
    else {
      const sl = inputStatus(cols[0], i)
      const sr = inputStatus(cols[1], i)
      if (isMissingStatus(sl)) s = sl
      else if (isMissingStatus(sr)) s = sr
      else s = sl !== CELL.ok ? sl : sr
    }
    if (s === CELL.ok) {
      const v = unary ? unary(cols[0]!.values[i]) : binary!(cols[0]!.values[i], cols[1]!.values[i])
      if (Number.isFinite(v)) {
        values[i] = v === 0 ? 0 : v
        text[i] = String(values[i])
        report.nValid++
        continue
      }
      s = CELL.domain
    }
    status[i] = s
    if (s === CELL.missing) report.nMissing++
    else if (s === CELL.sheetError) report.nSheetError++
    else {
      report.nInvalid++
      const code: ReasonCode = invalidCode(s)
      if (s === CELL.domain) report.invalidExamples.push({ rowId: rowIdOf(i), text: '', code })
      else if (otherExamples < MAX_INVALID_EXAMPLES) {
        otherExamples++
        const src = cols.find((c) => c && inputStatus(c, i) === s)
        report.invalidExamples.push({ rowId: rowIdOf(i), text: src ? (src.text[i] ?? '') : '', code })
      }
    }
  }

  return {
    columnId,
    settings: { kind: 'numeric', decimal: cols[0]?.settings.decimal ?? 'dot', percent: 'display' },
    values,
    status,
    categories: null,
    text,
    report,
  }
}

/** Rows of a derived column that are out of the transform's domain (for E_TRANSFORM_DOMAIN). */
export function domainRows(col: ParsedColumn): RowId[] {
  return col.report.invalidExamples.filter((e) => e.code === 'E_TRANSFORM_DOMAIN').map((e) => e.rowId)
}
