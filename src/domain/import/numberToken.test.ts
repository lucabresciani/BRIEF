import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CELL } from '@/domain/derive/types'
import {
  classifyNumberToken,
  foreignGroupingAllowed,
  hasPercentSuffix,
  normalizeUnit,
  parseNumber,
  tokenVotes,
  type TokenClass,
} from './numberToken'

interface Case {
  text: string
  cls: TokenClass
  dot: number | null
  comma: number | null
  unit: string | null
  percent: boolean
  note?: string
}

const fixture = JSON.parse(readFileSync(resolve('tests/fixtures/numberToken.cases.json'), 'utf8')) as {
  cases: Case[]
}

const asValue = (v: number | null) => (v === null ? NaN : v)

describe('classifyNumberToken — fixture cases', () => {
  it('has at least 39 cases covering every class', () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(39)
    const classes = new Set(fixture.cases.map((c) => c.cls))
    expect([...classes].sort()).toEqual(['ambiguous', 'comma', 'dot', 'invalid', 'neutral'])
  })

  for (const c of fixture.cases) {
    it(`${JSON.stringify(c.text)} → ${c.cls}${c.note ? ` (${c.note})` : ''}`, () => {
      const tok = classifyNumberToken(c.text)
      expect(tok.cls).toBe(c.cls)
      expect(tok.dotValue).toBe(asValue(c.dot))
      expect(tok.commaValue).toBe(asValue(c.comma))
      expect(tok.unit).toBe(c.unit)
      expect(tok.percent).toBe(c.percent)
    })
  }

  it('never yields negative zero', () => {
    expect(Object.is(classifyNumberToken('-0').dotValue, 0)).toBe(true)
    expect(Object.is(classifyNumberToken('-0,0').commaValue, 0)).toBe(true)
  })

  it('reads values exactly, not through parseFloat', () => {
    expect(classifyNumberToken('12abc').unit).toBe('abc') // a unit tail, judged at column level
    expect(classifyNumberToken('0.1').dotValue).toBe(0.1)
    expect(classifyNumberToken('6.02214076e23').dotValue).toBe(6.02214076e23)
    expect(classifyNumberToken('9007199254740993').dotValue).toBe(Number('9007199254740993'))
  })
})

describe('parseNumber', () => {
  it('missing tokens → NaN + missing, never 0', () => {
    for (const t of ['', '   ', 'NA', 'n/a', 'NaN', '-', '—', '?', 'null', 'n.d.']) {
      const p = parseNumber(t, 'dot')
      expect(p.status, t).toBe(CELL.missing)
      expect(Number.isNaN(p.value), t).toBe(true)
    }
  })

  it('spreadsheet errors → sheetError (EN and IT)', () => {
    for (const t of ['#DIV/0!', '#N/A', '#N/D', '#VALORE!', '#RIF!', '#NOME?', 'Err:502']) {
      const p = parseNumber(t, 'comma')
      expect(p.status, t).toBe(CELL.sheetError)
      expect(Number.isNaN(p.value)).toBe(true)
    }
  })

  it("dot mode: ambiguous ',' is grouping, ambiguous '.' is decimal, comma-only conflicts", () => {
    expect(parseNumber('1,234', 'dot')).toMatchObject({ status: CELL.ok, value: 1234 })
    expect(parseNumber('1.234', 'dot')).toMatchObject({ status: CELL.ok, value: 1.234 })
    expect(parseNumber('0.5', 'dot')).toMatchObject({ status: CELL.ok, value: 0.5 })
    const conflict = parseNumber('0,5', 'dot')
    expect(conflict.status).toBe(CELL.separatorConflict)
    expect(Number.isNaN(conflict.value)).toBe(true)
  })

  it('comma mode is the mirror image', () => {
    expect(parseNumber('1,234', 'comma')).toMatchObject({ status: CELL.ok, value: 1.234 })
    expect(parseNumber('1.234', 'comma')).toMatchObject({ status: CELL.ok, value: 1234 })
    expect(parseNumber('\u22123,2', 'comma')).toMatchObject({ status: CELL.ok, value: -3.2 })
    expect(parseNumber('0.5', 'comma').status).toBe(CELL.separatorConflict)
  })

  it('mixed mode: each token with its own separator, ambiguous tokens invalid', () => {
    expect(parseNumber('0.5', 'mixed')).toMatchObject({ status: CELL.ok, value: 0.5 })
    expect(parseNumber('0,5', 'mixed')).toMatchObject({ status: CELL.ok, value: 0.5 })
    expect(parseNumber('12', 'mixed')).toMatchObject({ status: CELL.ok, value: 12 })
    const amb = parseNumber('1,234', 'mixed')
    expect(amb.status).toBe(CELL.invalid)
    expect(Number.isNaN(amb.value)).toBe(true)
  })

  it('invalid text → invalid, NaN', () => {
    for (const t of ['abc', '0x1A', 'Infinity', '1e']) {
      const p = parseNumber(t, 'dot')
      expect(p.status, t).toBe(CELL.invalid)
      expect(Number.isNaN(p.value)).toBe(true)
    }
  })

  it('keeps unit and percent information; percent is not divided', () => {
    expect(parseNumber('2,5 °C', 'comma')).toEqual({
      status: CELL.ok,
      value: 2.5,
      unit: '°C',
      percent: false,
    })
    expect(parseNumber('12%', 'dot')).toEqual({ status: CELL.ok, value: 12, unit: null, percent: true })
  })

  it('expectedUnit: different unit → unexpectedUnit; same or no unit → ok; µ/μ unified', () => {
    expect(parseNumber('12 mV', 'dot', { expectedUnit: 'V' }).status).toBe(CELL.unexpectedUnit)
    expect(Number.isNaN(parseNumber('12 mV', 'dot', { expectedUnit: 'V' }).value)).toBe(true)
    expect(parseNumber('12 V', 'dot', { expectedUnit: 'V' })).toMatchObject({ status: CELL.ok, value: 12 })
    expect(parseNumber('12', 'dot', { expectedUnit: 'V' })).toMatchObject({ status: CELL.ok, value: 12 })
    expect(parseNumber('12abc', 'dot', { expectedUnit: null }).status).toBe(CELL.unexpectedUnit)
    expect(parseNumber('12%', 'dot', { expectedUnit: '%' }).status).toBe(CELL.ok)
    expect(parseNumber('12%', 'dot', { expectedUnit: 'V' }).status).toBe(CELL.unexpectedUnit)
    expect(parseNumber('5 μs', 'dot', { expectedUnit: 'µs' }).status).toBe(CELL.ok)
    // without expectedUnit the unit is reported but not judged
    expect(parseNumber('12abc', 'dot')).toMatchObject({ status: CELL.ok, value: 12, unit: 'abc' })
  })

  it('separator conflict wins over unit checks (value is not readable at all)', () => {
    expect(parseNumber('0,5 mV', 'dot', { expectedUnit: 'V' }).status).toBe(CELL.separatorConflict)
  })

  it('foreignGrouping: false → an ambiguous token read through the other separator conflicts', () => {
    expect(parseNumber('1.000', 'comma', { foreignGrouping: false }).status).toBe(CELL.separatorConflict)
    expect(parseNumber('1,000', 'dot', { foreignGrouping: false }).status).toBe(CELL.separatorConflict)
    // Its own separator is a decimal, never affected.
    expect(parseNumber('1,005', 'comma', { foreignGrouping: false })).toMatchObject({ value: 1.005 })
    expect(parseNumber('-1.234', 'dot', { foreignGrouping: false })).toMatchObject({ value: -1.234 })
    expect(parseNumber('-1.234', 'comma', { foreignGrouping: false }).status).toBe(CELL.separatorConflict)
    expect(parseNumber('1.000', 'comma')).toMatchObject({ status: CELL.ok, value: 1000 }) // default: allowed
  })

  it('spaceGrouping: false → an ASCII space between digits ends the number (NBSP still groups)', () => {
    expect(classifyNumberToken('10 100.9').dotValue).toBe(10100.9)
    expect(classifyNumberToken('10 100.9', { spaceGrouping: false }).cls).toBe('invalid')
    expect(parseNumber('1 234', 'dot', { spaceGrouping: false }).status).toBe(CELL.invalid)
    expect(classifyNumberToken('1\u00a0234,5', { spaceGrouping: false })).toMatchObject({
      cls: 'comma',
      commaValue: 1234.5,
    })
  })
})

describe('column-level grouping rule', () => {
  it('grouping evidence: a token readable one way only that contains the other separator', () => {
    expect(classifyNumberToken('1,234.5').grouping).toBe(true)
    expect(classifyNumberToken('101.298,5').grouping).toBe(true)
    expect(classifyNumberToken('1,234,567').grouping).toBe(true)
    for (const t of ['1,234', '0,5', '12.5', '1 234,5', 'abc'])
      expect([t, classifyNumberToken(t).grouping]).toEqual([t, false])
  })

  it('foreignGroupingAllowed: with grouping evidence or without any token of its own convention', () => {
    const votes = (texts: string[]) => tokenVotes(texts.map((t) => classifyNumberToken(t)))
    expect(foreignGroupingAllowed('comma', votes(['0,995', '1.000']))).toBe(false)
    expect(foreignGroupingAllowed('comma', votes(['101.298,5', '101.325']))).toBe(true)
    expect(foreignGroupingAllowed('comma', votes(['1.234', '2.345']))).toBe(true) // a tie-break, reported apart
    expect(foreignGroupingAllowed('dot', votes(['0.5', '1,000']))).toBe(false)
    expect(foreignGroupingAllowed('mixed', votes(['0.5', '0,5']))).toBe(true)
    expect(tokenVotes([null, classifyNumberToken('0.5'), classifyNumberToken('x')])).toEqual({
      dot: 1,
      comma: 0,
      grouping: false,
    })
  })
})

describe('helpers', () => {
  it('normalizeUnit unifies micro and ohm spellings', () => {
    expect(normalizeUnit('μm')).toBe('µm')
    expect(normalizeUnit('kΩ')).toBe('kΩ')
  })
  it('hasPercentSuffix', () => {
    expect(hasPercentSuffix('12%')).toBe(true)
    expect(hasPercentSuffix('12.5 % ')).toBe(true)
    expect(hasPercentSuffix('12')).toBe(false)
  })
})
