import { describe, expect, it } from 'vitest'
import { NATIVE } from '@/domain/model'
import type { ColumnId, ColumnParseSettings } from '@/domain/model'
import { parseColumn } from './parseColumn'
import { CELL } from './types'

const id = 'col_a' as ColumnId
const num = (
  decimal: ColumnParseSettings['decimal'] = 'dot',
  percent: ColumnParseSettings['percent'] = 'display',
) => ({ kind: 'numeric', decimal, percent }) as ColumnParseSettings

describe('parseColumn — numeric', () => {
  it('reads values, keeps every unreadable cell with a status, never turns a missing value into 0', () => {
    const texts = ['1.5', '', 'NA', '#DIV/0!', 'abc', '2,5', ' -3 ', '0']
    const p = parseColumn(id, texts, num('dot'))
    expect(Array.from(p.status)).toEqual([
      CELL.ok,
      CELL.missing,
      CELL.missing,
      CELL.sheetError,
      CELL.invalid,
      CELL.separatorConflict,
      CELL.ok,
      CELL.ok,
    ])
    expect(p.values[0]).toBe(1.5)
    expect(p.values[6]).toBe(-3)
    expect(p.values[7]).toBe(0)
    for (const i of [1, 2, 3, 4, 5]) expect(p.values[i]).toBeNaN()
    expect(p.report).toMatchObject({ nRows: 8, nValid: 3, nMissing: 2, nSheetError: 1, nInvalid: 2 })
    expect(p.report.missingTokens).toEqual(['', 'NA'])
    expect(p.report.invalidExamples.map((e) => e.code)).toEqual(['E_NOT_A_NUMBER', 'W_SEPARATOR_CONFLICT'])
    expect(p.text).toBe(texts) // original tokens kept for display
  })

  it('a decimal override changes the values ("1,234": 1234 dot / 1.234 comma / invalid mixed)', () => {
    const texts = ['1,234', '0,5', '2']
    const dot = parseColumn(id, texts, num('dot'))
    expect(dot.values[0]).toBe(1234)
    expect(dot.status[1]).toBe(CELL.separatorConflict)
    const comma = parseColumn(id, texts, num('comma'))
    expect(comma.values[0]).toBe(1.234)
    expect(comma.values[1]).toBe(0.5)
    const mixed = parseColumn(id, texts, num('mixed'))
    expect(mixed.status[0]).toBe(CELL.invalid)
    expect(mixed.values[1]).toBe(0.5)
    expect(mixed.report.invalidExamples[0]).toMatchObject({ code: 'W_DECIMAL_AMBIGUOUS', text: '1,234' })
  })

  it('report rows are RowIds when given', () => {
    const p = parseColumn(id, ['x', '1'], num(), null, { rowIds: [41, 42] })
    expect(p.report.invalidExamples[0].rowId).toBe(41)
  })

  it('unit tails: checked against the column unit only when given; never converted', () => {
    const texts = ['12 V', '13 mV', '14']
    const checked = parseColumn(id, texts, num(), null, { unit: 'V' })
    expect(Array.from(checked.status)).toEqual([CELL.ok, CELL.unexpectedUnit, CELL.ok])
    expect(checked.values[0]).toBe(12)
    expect(checked.values[1]).toBeNaN()
    expect(checked.report.invalidExamples[0].code).toBe('W_UNEXPECTED_UNIT')
    const unchecked = parseColumn(id, texts, num())
    expect(unchecked.values[1]).toBe(13)
  })

  it('"1.000" in a comma column with no grouping elsewhere → separatorConflict, never 1000', () => {
    const p = parseColumn(id, ['0,995', '1.000', '1,005'], num('comma'))
    expect(Array.from(p.status)).toEqual([CELL.ok, CELL.separatorConflict, CELL.ok])
    expect(p.values[1]).toBeNaN()
    expect(p.report.invalidExamples[0]).toMatchObject({ code: 'W_SEPARATOR_CONFLICT', text: '1.000' })
    // Grouping used elsewhere in the column: "101.325" is 101325 (Italian Excel export).
    expect(Array.from(parseColumn(id, ['101.325', '101.298,5'], num('comma')).values)).toEqual([
      101325, 101298.5,
    ])
    // No token of the column's own convention (a tie-break the importer reported): grouping is allowed.
    expect(Array.from(parseColumn(id, ['1.234', '2.345'], num('comma')).values)).toEqual([1234, 2345])
    // Mirror image in a dot column.
    expect(parseColumn(id, ['0.995', '1,000'], num('dot')).status[1]).toBe(CELL.separatorConflict)
  })

  it('spaceGrouping: false (text read without a delimiter) never fuses "10 100.9" into 10100.9', () => {
    const fused = parseColumn(id, ['10 100.9', '1 234'], num('dot'))
    expect(Array.from(fused.values)).toEqual([10100.9, 1234])
    const p = parseColumn(id, ['10 100.9', '1 234', '1\u00a0234'], num('dot'), null, { spaceGrouping: false })
    expect(Array.from(p.status)).toEqual([CELL.invalid, CELL.invalid, CELL.ok])
    expect(p.values[2]).toBe(1234)
  })

  it('text percent: "12%" is 12 in display mode and 0.12 in fraction mode', () => {
    expect(parseColumn(id, ['12%', '7%'], num('dot', 'display')).values).toEqual(Float64Array.from([12, 7]))
    expect(parseColumn(id, ['12%', '7%'], num('dot', 'fraction')).values).toEqual(
      Float64Array.from([0.12, 0.07]),
    )
  })

  it('native spreadsheet cells win over text; percent cells ×100 with toPrecision(15)', () => {
    const native = {
      kind: Uint8Array.from([
        NATIVE.number,
        NATIVE.number,
        NATIVE.error,
        NATIVE.empty,
        NATIVE.date,
        NATIVE.text,
        NATIVE.boolean,
      ]),
      num: Float64Array.from([0.07, 1.5, NaN, NaN, 1.7e12, NaN, 1]),
    }
    const texts = ['7%', '1,5', '#N/D', '', '14/10/2026', '2.5', 'TRUE']
    const d = parseColumn(id, texts, num('dot', 'display'), native)
    expect(d.values[0]).toBe(7) // not 7.000000000000001
    expect(d.values[1]).toBe(1.5) // the native value, not the Italian-formatted text
    expect(d.status[2]).toBe(CELL.sheetError)
    expect(d.status[3]).toBe(CELL.missing)
    expect(d.status[4]).toBe(CELL.invalid) // a date in a numeric column
    expect(d.values[5]).toBe(2.5) // text cell → classifier
    expect(d.status[6]).toBe(CELL.invalid)
    const f = parseColumn(id, texts, num('dot', 'fraction'), native)
    expect(f.values[0]).toBe(0.07)
  })
})

describe('parseColumn — categorical / text', () => {
  it('codes in order of first appearance, blank → −1, values NaN (labels are never numbers)', () => {
    const p = parseColumn(id, ['A', 'B', ' A ', '', '   ', '#REF!'], {
      kind: 'categorical',
      decimal: 'dot',
      percent: 'display',
    })
    expect(p.categories!.labels).toEqual(['A', 'B'])
    expect(Array.from(p.categories!.codes)).toEqual([0, 1, 0, -1, -1, -1])
    expect(Array.from(p.status)).toEqual([
      CELL.ok,
      CELL.ok,
      CELL.ok,
      CELL.missing,
      CELL.missing,
      CELL.sheetError,
    ])
    expect(Array.from(p.values).every(Number.isNaN)).toBe(true)
    expect(p.report).toMatchObject({ nValid: 3, nMissing: 2, nSheetError: 1, nInvalid: 0 })
  })

  it('missing-value words are labels in a categorical column ("none" control group, sodium "Na")', () => {
    const cat = { kind: 'categorical', decimal: 'dot', percent: 'display' } as ColumnParseSettings
    const groups = parseColumn(id, ['none', 'none', 'fertilizer', 'NA', '-', ''], cat)
    expect(groups.categories!.labels).toEqual(['none', 'fertilizer', 'NA', '-'])
    expect(Array.from(groups.categories!.codes)).toEqual([0, 0, 1, 2, 3, -1])
    expect(groups.report).toMatchObject({ nValid: 5, nMissing: 1 })
    const elements = parseColumn(id, ['Li', 'Na', 'K', 'Nd'], { ...cat, kind: 'text' })
    expect(elements.categories!.labels).toEqual(['Li', 'Na', 'K', 'Nd'])
    // In a numeric column the same words are still missing values.
    expect(Array.from(parseColumn(id, ['1', 'NA', 'none'], num()).status)).toEqual([
      CELL.ok,
      CELL.missing,
      CELL.missing,
    ])
  })
})

describe('parseColumn — datetime', () => {
  it('ISO 8601 in UTC, offsets applied, invalid dates rejected, native dates used', () => {
    const texts = [
      '2026-10-14',
      '2026-10-14T12:30:15Z',
      '2026-10-14 12:30+02:00',
      '2026-02-30',
      'yesterday',
      '',
      'x',
    ]
    const native = {
      kind: Uint8Array.from([
        NATIVE.text,
        NATIVE.text,
        NATIVE.text,
        NATIVE.text,
        NATIVE.text,
        NATIVE.empty,
        NATIVE.date,
      ]),
      num: Float64Array.from([NaN, NaN, NaN, NaN, NaN, NaN, 86_400_000]),
    }
    const p = parseColumn(id, texts, { kind: 'datetime', decimal: 'dot', percent: 'display' }, native)
    expect(p.values[0]).toBe(Date.UTC(2026, 9, 14))
    expect(p.values[1]).toBe(Date.UTC(2026, 9, 14, 12, 30, 15))
    expect(p.values[2]).toBe(Date.UTC(2026, 9, 14, 10, 30))
    expect(p.status[3]).toBe(CELL.invalid)
    expect(p.status[4]).toBe(CELL.invalid)
    expect(p.status[5]).toBe(CELL.missing)
    expect(p.values[6]).toBe(86_400_000)
  })
})
