import { describe, expect, it } from 'vitest'
import { NATIVE, type ColumnId, type Issue, type ReasonCode } from '@/domain/model'
import { CELL } from '@/domain/derive/types'
import { inferColumn, referenceUnit, type InferColumnOptions } from './columnInfer'
import { parseNumber } from './numberToken'

const columnId = 'col_test' as ColumnId
const ids = (n: number, from = 0) => Array.from({ length: n }, (_, i) => i + from)
const infer = (texts: string[], opts: Partial<InferColumnOptions> = {}, rowIds = ids(texts.length)) =>
  inferColumn(texts, rowIds, { columnId, delimiter: ',', ...opts })
const find = (issues: readonly Issue[], code: ReasonCode) => issues.find((i) => i.code === code)
const codes = (issues: readonly Issue[]) => issues.map((i) => i.code)

describe('inferColumn — decimal vote', () => {
  it("only '.' votes → dot, high confidence", () => {
    const r = infer(['0.5', '1.25', '2', '-3.75'])
    expect(r.detection).toMatchObject({
      kind: 'numeric',
      decimal: 'dot',
      confidence: 'high',
      percent: 'display',
    })
    expect(r.issues).toEqual([])
  })

  it("only ',' votes → comma, high confidence (ambiguous tokens follow the vote)", () => {
    const r = infer(['0,5', '1,25', '2', '1,234'])
    expect(r.detection).toMatchObject({ kind: 'numeric', decimal: 'comma', confidence: 'high' })
    expect(r.issues).toEqual([])
    expect(parseNumber('1,234', r.detection.decimal).value).toBe(1.234)
  })

  it('no separators at all → dot, high (nothing to decide)', () => {
    expect(infer(['1', '2', '3']).detection).toMatchObject({ decimal: 'dot', confidence: 'high' })
  })

  it('only ambiguous tokens, comma delimiter → dot, low, W_DECIMAL_AMBIGUOUS explained', () => {
    const r = infer(['1,234', '2,345', '3,456'], {}, [5, 6, 7])
    expect(r.detection).toMatchObject({ kind: 'numeric', decimal: 'dot', confidence: 'low' })
    const w = find(r.issues, 'W_DECIMAL_AMBIGUOUS')
    expect(w?.params).toMatchObject({
      example: '1,234',
      a: 1234,
      b: 1.234,
      chosen: 1234,
      mode: 'dot',
      because: 'default',
      count: 3,
    })
    expect(w?.rows).toEqual([5, 6, 7])
    expect(w?.columnId).toBe(columnId)
  })

  it("only ambiguous tokens with ';' delimiter → comma", () => {
    const r = infer(['1,234', '2,345'], { delimiter: ';' })
    expect(r.detection).toMatchObject({ decimal: 'comma', confidence: 'low' })
    expect(find(r.issues, 'W_DECIMAL_AMBIGUOUS')?.params).toMatchObject({
      chosen: 1.234,
      because: 'semicolonDelimiter',
    })
  })

  it('only ambiguous tokens follow the hint from other columns', () => {
    const r = infer(['12.500', '13.250'], { decimalHint: 'comma' })
    expect(r.detection.decimal).toBe('comma')
    expect(find(r.issues, 'W_DECIMAL_AMBIGUOUS')?.params).toMatchObject({
      chosen: 12500,
      because: 'otherColumns',
    })
  })

  it("both '.' and ',' without grouping → mixed; ambiguous tokens become invalid with their rows", () => {
    const texts = ['0.5', '1,5', '2.25', '1,234', '3']
    const r = infer(texts, {}, [10, 11, 12, 13, 14])
    expect(r.detection).toMatchObject({ kind: 'numeric', decimal: 'mixed', confidence: 'low' })
    expect(find(r.issues, 'W_DECIMAL_MIXED')?.params).toMatchObject({ n: 2, m: 1 })
    const amb = find(r.issues, 'W_DECIMAL_AMBIGUOUS')
    expect(amb?.params).toMatchObject({ mode: 'mixed', count: 1, example: '1,234' })
    expect(amb?.rows).toEqual([13])
    const values = texts.map((t) => parseNumber(t, 'mixed'))
    expect(values.map((p) => p.value)).toEqual([0.5, 1.5, 2.25, NaN, 3])
    expect(values[3].status).toBe(CELL.invalid)
  })

  it('both with thousands grouping → majority wins, minority are separator conflicts', () => {
    const texts = ['1,234.5', '2,345.75', '3.5', '0,5']
    const r = infer(texts, {}, [1, 2, 3, 4])
    expect(r.detection).toMatchObject({ decimal: 'dot', confidence: 'low' })
    expect(codes(r.issues)).not.toContain('W_DECIMAL_MIXED')
    const c = find(r.issues, 'W_SEPARATOR_CONFLICT')
    expect(c?.params).toMatchObject({ count: 1 })
    expect(c?.rows).toEqual([4])
    expect(parseNumber('0,5', r.detection.decimal).status).toBe(CELL.separatorConflict)
  })

  it('Italian grouping majority → comma, English minority conflicts', () => {
    const r = infer(['1.234,5', '2.000,25', '7,5', '3.5'])
    expect(r.detection.decimal).toBe('comma')
    expect(find(r.issues, 'W_SEPARATOR_CONFLICT')?.params).toMatchObject({ count: 1 })
  })
})

describe('inferColumn — ambiguous tokens with the other separator', () => {
  it('"1.000" among comma decimals (or "1,000" among dot decimals) is a conflict, never 1000', () => {
    const it_ = infer(['0,995', '1.000', '1,005', '1,010'], { delimiter: ';' }, [1, 2, 3, 4])
    expect(it_.detection).toMatchObject({ kind: 'numeric', decimal: 'comma', confidence: 'low' })
    const c = find(it_.issues, 'W_SEPARATOR_CONFLICT')
    expect(c?.params).toMatchObject({ count: 1, mode: 'comma' })
    expect(c?.rows).toEqual([2])
    const en = infer(['0.995', '1,000', '1.005', '1.010'], { delimiter: '\t' })
    expect(en.detection).toMatchObject({ decimal: 'dot', confidence: 'low' })
    expect(find(en.issues, 'W_SEPARATOR_CONFLICT')?.params).toMatchObject({ count: 1 })
  })

  it('grouping evidence elsewhere in the column keeps the grouping reading (Italian "101.325")', () => {
    const r = infer(['101.325', '101.298,5', '101.310'], { delimiter: ';' })
    expect(r.detection).toMatchObject({ decimal: 'comma', confidence: 'high' })
    expect(codes(r.issues)).toEqual([])
    // Own separator: "1,105" in a comma column is 1.105.
    expect(codes(infer(['0,12', '1,105', '1,23'], { delimiter: ';' }).issues)).toEqual([])
  })
})

describe('inferColumn — single-column and whitespace text', () => {
  it('delimiter \'none\': a space between digits is not grouping ("10 100.9" is two numbers)', () => {
    const r = infer(['0 101.3', '5 101.1', '10 100.9'], { delimiter: 'none' })
    expect(r.detection.kind).not.toBe('numeric')
    // With a delimiter, "1 234,5" keeps its group separator.
    expect(infer(['1 234,5', '2 345,25'], { delimiter: ';' }).detection).toMatchObject({
      kind: 'numeric',
      decimal: 'comma',
    })
  })

  it('singleColumnComma: only-ambiguous "1,425" follows the detector (decimal comma)', () => {
    const r = infer(['1,425', '1,438'], { delimiter: 'none', singleColumnComma: true })
    expect(r.detection).toMatchObject({ decimal: 'comma', confidence: 'low' })
    expect(find(r.issues, 'W_DECIMAL_AMBIGUOUS')?.params).toMatchObject({
      chosen: 1.425,
      because: 'singleColumnComma',
    })
  })
})

describe('inferColumn — labels that look like missing values', () => {
  it('in a categorical column "none", "Na", "nd", "-" are labels; only blank cells are missing', () => {
    const r = infer(['none', 'none', 'fertilizer', 'fertilizer', '', '-'], {}, [1, 2, 3, 4, 5, 6])
    expect(r.detection.kind).toBe('categorical')
    const m = find(r.issues, 'I_MISSING_VALUES')
    expect(m?.params).toMatchObject({ count: 1, tokens: '""' })
    expect(m?.rows).toEqual([5])
    const el = infer(['Li', 'Na', 'K', 'Nd', 'Rb'])
    expect(el.detection.kind).toBe('categorical')
    expect(codes(el.issues)).toEqual([])
  })

  it('in a numeric column the same words are missing values', () => {
    const r = infer(['1.5', 'none', '2.5', 'NA'])
    expect(r.detection.kind).toBe('numeric')
    expect(find(r.issues, 'I_MISSING_VALUES')?.params).toMatchObject({ count: 2, tokens: 'none, NA' })
  })
})

describe('referenceUnit (the unit cells are checked against, independent of the unit label)', () => {
  it('header unit first, else the unit carried by ≥ 80 % of the number-like cells', () => {
    expect(referenceUnit(['12 mV', '13'], null, 'V')).toBe('V')
    expect(referenceUnit(['12 mV', '13 mV', '14 mV', 'NA'], null, null)).toBe('mV')
    expect(referenceUnit(['12 mV', '13', '14', '15'], null, null)).toBeNull()
    expect(referenceUnit(['  '], null, '  ')).toBeNull()
  })
})

describe('inferColumn — kind thresholds', () => {
  const numbers = (k: number) => ids(k).map((i) => `${i + 1}.5`)
  const words = (k: number) => ids(k).map((i) => `word${i}`)

  it('exactly 80 % numeric → numeric, high, the non-numbers are listed', () => {
    const r = infer([...numbers(8), ...words(2)])
    expect(r.detection).toMatchObject({ kind: 'numeric', confidence: 'high' })
    const w = find(r.issues, 'W_COLUMN_PARTLY_NUMERIC')
    expect(w?.params).toMatchObject({ count: 2 })
    expect(w?.rows).toEqual([8, 9])
  })

  it('50–80 % numeric → numeric, low confidence, W_COLUMN_PARTLY_NUMERIC with column name', () => {
    const r = infer([...numbers(7), ...words(3)], { columnName: 'Voltage' })
    expect(r.detection).toMatchObject({ kind: 'numeric', confidence: 'low' })
    expect(find(r.issues, 'W_COLUMN_PARTLY_NUMERIC')?.params).toEqual({ count: 3, column: 'Voltage' })
    expect(infer([...numbers(5), ...words(5)]).detection).toMatchObject({
      kind: 'numeric',
      confidence: 'low',
    })
  })

  it('below 50 % numeric → categorical or text', () => {
    expect(infer([...numbers(4), ...words(6)]).detection.kind).toBe('categorical')
    expect(infer(words(40)).detection.kind).toBe('text')
    expect(infer(['A', 'B', 'A', 'C', 'B', 'A']).detection).toMatchObject({
      kind: 'categorical',
      confidence: 'high',
    })
  })

  it('missing cells are outside the denominator and reported, never zero', () => {
    const r = infer(['1.5', 'NA', '', '3.5', 'n/a'], {}, [3, 4, 5, 6, 7])
    expect(r.detection).toMatchObject({ kind: 'numeric', confidence: 'high' })
    const m = find(r.issues, 'I_MISSING_VALUES')
    expect(m?.params).toMatchObject({ count: 3, tokens: 'NA, "", n/a' })
    expect(m?.rows).toEqual([4, 5, 7])
    expect(m?.severity).toBe('info')
  })

  it('sheet errors are counted separately with an example', () => {
    const r = infer(['1', '#DIV/0!', '2', '#N/D'])
    const e = find(r.issues, 'I_SHEET_ERRORS')
    expect(e?.params).toMatchObject({ count: 2, example: '#DIV/0!' })
    expect(e?.rows).toEqual([1, 3])
    expect(r.detection.kind).toBe('numeric')
  })

  it('a column with nothing but missing values → W_ALL_MISSING', () => {
    const r = infer(['', 'NA', '-'], { columnName: 'u(y)' })
    expect(find(r.issues, 'W_ALL_MISSING')?.params).toMatchObject({ column: 'u(y)', count: 3 })
    expect(r.detection.confidence).toBe('low')
  })

  it('ISO 8601 dates → datetime', () => {
    const r = infer(['2024-03-15', '2024-03-16T10:30', '2024-03-17 08:00:05', 'NA'])
    expect(r.detection.kind).toBe('datetime')
    expect(infer(['15/03/2024', '16/03/2024']).detection.kind).not.toBe('datetime')
  })
})

describe('inferColumn — units and percent', () => {
  it('unit from cells when ≥ 80 % share it (comma decimals + unit)', () => {
    const r = infer(['2,5 °C', '3,1 °C', '4 °C', '5,5 °C', '6,0 °C'])
    expect(r.unit).toBe('°C')
    expect(r.detection.decimal).toBe('comma')
    expect(find(r.issues, 'I_UNIT_FROM_CELLS')?.params).toMatchObject({ unit: '°C', count: 5 })
    expect(r.detection.confidence).toBe('high')
  })

  it('a different unit is flagged (never converted)', () => {
    const r = infer(['2.5 °C', '3.1 °C', '4 °C', '5.5 °C', '300 K'], {}, [1, 2, 3, 4, 5])
    expect(r.unit).toBe('°C')
    const w = find(r.issues, 'W_UNEXPECTED_UNIT')
    expect(w?.params).toMatchObject({ count: 1, unit: '°C' })
    expect(w?.rows).toEqual([5])
    expect(parseNumber('300 K', 'dot', { expectedUnit: r.unit }).status).toBe(CELL.unexpectedUnit)
  })

  it('a junk tail in a unitless column is not silently read as a number', () => {
    const r = infer(['1', '2', '3', '4', '5', '6', '7', '8', '9', '12abc'])
    expect(r.unit).toBeNull()
    expect(r.detection.kind).toBe('numeric')
    expect(find(r.issues, 'W_UNEXPECTED_UNIT')?.params).toMatchObject({ count: 1 })
  })

  it('cells are checked against the header unit when given', () => {
    const r = infer(['12 mV', '13 mV', '14 mV'], { headerUnit: 'V' })
    expect(find(r.issues, 'W_UNEXPECTED_UNIT')?.params).toMatchObject({ count: 3, unit: 'V' })
    expect(codes(r.issues)).not.toContain('I_UNIT_FROM_CELLS')
    expect(r.detection.confidence).toBe('low')
    const same = infer(['12 V', '13'], { headerUnit: 'V' })
    expect(codes(same.issues)).not.toContain('W_UNEXPECTED_UNIT')
  })

  it("CSV '12%' cells → unit '%', value not divided", () => {
    const r = infer(['12%', '7.5%', '100%'])
    expect(r.unit).toBe('%')
    expect(find(r.issues, 'I_UNIT_FROM_CELLS')?.params).toMatchObject({ unit: '%' })
    expect(parseNumber('7.5%', r.detection.decimal, { expectedUnit: r.unit }).value).toBe(7.5)
  })
})

describe('inferColumn — native spreadsheet cells', () => {
  const nativeOf = (kinds: number[], nums: number[]) => ({
    kind: Uint8Array.from(kinds),
    num: Float64Array.from(nums),
  })

  it('number cells are numeric regardless of their formatted text and do not vote', () => {
    const native = nativeOf([NATIVE.number, NATIVE.number, NATIVE.number], [1234, 1.5, 2])
    const r = infer(['1,234', '1.50', '2'], { native })
    expect(r.detection).toMatchObject({ kind: 'numeric', decimal: 'dot', confidence: 'high' })
    expect(codes(r.issues)).not.toContain('W_DECIMAL_AMBIGUOUS')
  })

  it('percent-formatted cells → I_PERCENT, unit %, display mode by default', () => {
    const native = nativeOf([NATIVE.number, NATIVE.number], [0.12, 0.075])
    const r = infer(['12%', '7.50%'], { native }, [2, 3])
    expect(r.detection.percent).toBe('display')
    expect(r.unit).toBe('%')
    const p = find(r.issues, 'I_PERCENT')
    expect(p?.params).toMatchObject({ count: 2 })
    expect(p?.rows).toEqual([2, 3])
    expect(codes(r.issues)).not.toContain('I_UNIT_FROM_CELLS')
  })

  it('empty, error, date and text cells are told apart', () => {
    const native = nativeOf(
      [NATIVE.number, NATIVE.empty, NATIVE.error, NATIVE.text, NATIVE.number],
      [1, NaN, NaN, NaN, 3],
    )
    const r = infer(['1', '', '#DIV/0!', '2,5', '3'], { native })
    expect(find(r.issues, 'I_MISSING_VALUES')?.params).toMatchObject({ count: 1 })
    expect(find(r.issues, 'I_SHEET_ERRORS')?.params).toMatchObject({ count: 1, example: '#DIV/0!' })
    expect(r.detection).toMatchObject({ kind: 'numeric', decimal: 'comma' }) // the text cell '2,5' votes
  })

  it('native dates → datetime', () => {
    const native = nativeOf(
      [NATIVE.date, NATIVE.date, NATIVE.empty],
      [Date.UTC(2024, 0, 1), Date.UTC(2024, 0, 2), NaN],
    )
    expect(infer(['1/1/24', '1/2/24', ''], { native }).detection.kind).toBe('datetime')
  })

  it('rejects misaligned arrays as a programmer error', () => {
    expect(() => inferColumn(['1'], [0, 1], { columnId, delimiter: ',' })).toThrow()
    expect(() => infer(['1', '2'], { native: nativeOf([NATIVE.number], [1]) })).toThrow()
  })
})

describe('inferColumn — explanations', () => {
  it('explanations hold the decision issues without row lists', () => {
    const r = infer(['0.5', '1,5', 'NA', 'x'])
    const explained = r.detection.explanations.map((i) => i.code)
    expect(explained).toContain('W_DECIMAL_MIXED')
    expect(explained).not.toContain('I_MISSING_VALUES')
    for (const e of r.detection.explanations) expect(e.rows).toBeUndefined()
  })
})
