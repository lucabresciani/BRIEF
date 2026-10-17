import { describe, expect, it } from 'vitest'
import type { ColumnId, TransformSpec } from '@/domain/model'
import { parseColumn } from './parseColumn'
import { applyTransform, domainRows, transformInputs } from './transforms'
import { CELL } from './types'
import type { ParsedColumn } from './types'

const col = (id: string, texts: string[]) =>
  parseColumn(id as ColumnId, texts, { kind: 'numeric', decimal: 'dot', percent: 'display' })
const out = 'col_out' as ColumnId
const run = (spec: TransformSpec, cols: Record<string, ParsedColumn>, rowIds?: number[]) =>
  applyTransform(spec, (id) => cols[id], out, rowIds)

describe('applyTransform', () => {
  const x = col('x', ['1', String(Math.E), '0', '-1', '', 'abc', '4'])

  it('ln: x > 0 only; out-of-domain rows are CELL.domain and ALL listed; missing/invalid propagate', () => {
    const r = run({ op: 'ln', input: 'x' as ColumnId }, { x }, [10, 11, 12, 13, 14, 15, 16])
    expect(r.values[0]).toBe(0)
    expect(r.values[1]).toBeCloseTo(1, 15)
    expect(Array.from(r.status)).toEqual([
      CELL.ok,
      CELL.ok,
      CELL.domain,
      CELL.domain,
      CELL.missing,
      CELL.invalid,
      CELL.ok,
    ])
    expect(r.values[2]).toBeNaN()
    expect(domainRows(r)).toEqual([12, 13])
    expect(r.report).toMatchObject({ nRows: 7, nValid: 3, nMissing: 1, nInvalid: 3 })
    expect(r.settings.kind).toBe('numeric')
    expect(x.values[2]).toBe(0) // inputs untouched
  })

  it('log10, sqrt (0 allowed), reciprocal (0 excluded), square, affine', () => {
    const v = col('v', ['100', '0', '-4', '2'])
    const log10 = run({ op: 'log10', input: 'v' as ColumnId }, { v })
    expect(log10.values[0]).toBe(2)
    expect(Array.from(log10.status)).toEqual([CELL.ok, CELL.domain, CELL.domain, CELL.ok])
    const sqrt = run({ op: 'sqrt', input: 'v' as ColumnId }, { v })
    expect(Array.from(sqrt.values.slice(0, 2))).toEqual([10, 0])
    expect(sqrt.status[2]).toBe(CELL.domain)
    const rec = run({ op: 'reciprocal', input: 'v' as ColumnId }, { v })
    expect(rec.values[0]).toBe(0.01)
    expect(rec.status[1]).toBe(CELL.domain)
    expect(rec.values[2]).toBe(-0.25)
    expect(Array.from(run({ op: 'square', input: 'v' as ColumnId }, { v }).values)).toEqual([10000, 0, 16, 4])
    expect(Array.from(run({ op: 'affine', input: 'v' as ColumnId, a: 2, b: 1 }, { v }).values)).toEqual([
      201, 1, -7, 5,
    ])
  })

  it('binary ops: difference, ratio (denominator 0 out of domain), product; missing beats invalid', () => {
    const l = col('l', ['6', '1', '', 'bad', '2'])
    const r = col('r', ['3', '0', 'bad', '1', ''])
    const cols = { l, r }
    expect(run({ op: 'difference', left: 'l' as ColumnId, right: 'r' as ColumnId }, cols).values[0]).toBe(3)
    const ratio = run({ op: 'ratio', left: 'l' as ColumnId, right: 'r' as ColumnId }, cols)
    expect(ratio.values[0]).toBe(2)
    expect(Array.from(ratio.status)).toEqual([CELL.ok, CELL.domain, CELL.missing, CELL.invalid, CELL.missing])
    expect(run({ op: 'product', left: 'l' as ColumnId, right: 'r' as ColumnId }, cols).values[0]).toBe(18)
    expect(transformInputs({ op: 'ratio', left: 'l' as ColumnId, right: 'r' as ColumnId })).toEqual([
      'l',
      'r',
    ])
  })

  it('overflow is out of domain, never Infinity', () => {
    const big = col('b', ['1e200'])
    const sq = run({ op: 'square', input: 'b' as ColumnId }, { b: big })
    expect(sq.status[0]).toBe(CELL.domain)
    expect(sq.values[0]).toBeNaN()
  })

  it("an input already out of another transform's domain is invalid here (not counted as this op's domain)", () => {
    const lnx = run({ op: 'ln', input: 'x' as ColumnId }, { x })
    const sq = run({ op: 'square', input: 'l' as ColumnId }, { l: lnx })
    expect(sq.status[2]).toBe(CELL.invalid)
    expect(domainRows(sq)).toEqual([])
  })

  it('label inputs (categorical) are invalid; an absent input makes every row missing', () => {
    const cat = parseColumn('c' as ColumnId, ['A', 'B'], {
      kind: 'categorical',
      decimal: 'dot',
      percent: 'display',
    })
    expect(Array.from(run({ op: 'square', input: 'c' as ColumnId }, { c: cat }).status)).toEqual([
      CELL.invalid,
      CELL.invalid,
    ])
    const none = run({ op: 'ln', input: 'nope' as ColumnId }, {}, [1, 2, 3])
    expect(Array.from(none.status)).toEqual([CELL.missing, CELL.missing, CELL.missing])
  })
})
