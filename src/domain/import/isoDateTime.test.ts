import { describe, expect, it } from 'vitest'
import type { ColumnId } from '@/domain/model'
import { parseColumn } from '@/domain/derive/parseColumn'
import { CELL } from '@/domain/derive/types'
import { inferColumn } from './columnInfer'
import { isIsoDateTime, parseIsoDateTime } from './isoDateTime'

describe('parseIsoDateTime', () => {
  it('parses dates and date-times in UTC, honouring explicit offsets', () => {
    expect(parseIsoDateTime('2024-03-15')).toBe(Date.UTC(2024, 2, 15))
    expect(parseIsoDateTime('2024-03-15T10:30')).toBe(Date.UTC(2024, 2, 15, 10, 30))
    expect(parseIsoDateTime('2024-03-15 10:30:15.5Z')).toBe(Date.UTC(2024, 2, 15, 10, 30, 15, 500))
    expect(parseIsoDateTime('2024-03-15T10:30:00+02:00')).toBe(Date.UTC(2024, 2, 15, 8, 30))
    expect(parseIsoDateTime('2024-03-15T10:30:00-0130')).toBe(Date.UTC(2024, 2, 15, 12, 0))
    expect(parseIsoDateTime('2024-03-15T10:30:00+05')).toBe(Date.UTC(2024, 2, 15, 5, 30))
  })

  it('accepts lowercase t and z, a blank before the offset and a decimal comma', () => {
    expect(parseIsoDateTime('2024-03-15t10:30z')).toBe(Date.UTC(2024, 2, 15, 10, 30))
    expect(parseIsoDateTime('2024-03-15 10:30 +01:00')).toBe(Date.UTC(2024, 2, 15, 9, 30))
    expect(parseIsoDateTime('2024-03-15T10:30:15,25')).toBe(Date.UTC(2024, 2, 15, 10, 30, 15, 250))
  })

  it('reads the years 0–99 as written, never as 1900–1999', () => {
    const d = new Date(0)
    d.setUTCFullYear(50, 0, 1)
    expect(parseIsoDateTime('0050-01-01')).toBe(d.getTime())
    expect(new Date(parseIsoDateTime('0099-12-31T23:00')).getUTCFullYear()).toBe(99)
  })

  it('a time of day alone → milliseconds since midnight', () => {
    expect(parseIsoDateTime('12:30')).toBe(45_000_000)
    expect(parseIsoDateTime('00:00:01.250')).toBe(1250)
    expect(parseIsoDateTime('24:00')).toBeNaN()
    expect(parseIsoDateTime('12:60')).toBeNaN()
  })

  it('rejects impossible and non-ISO dates', () => {
    for (const t of [
      '2023-02-29',
      '2023-02-30',
      '2024-13-01',
      '2024-03-15T24:00',
      '2024-03-15T10:30+24:00',
      '15/03/2024',
      '2024-3-5',
      '20240315',
      '1:30',
      '',
    ]) {
      expect(isIsoDateTime(t), t).toBe(false)
    }
    expect(isIsoDateTime('2024-02-29')).toBe(true)
  })
})

describe('import detection and column parsing agree', () => {
  const columnId = 'col_t' as ColumnId
  const SAMPLES = [
    '2024-03-15',
    '2024-03-15T10:30',
    '2024-03-15t10:30:15z',
    '2024-03-15 10:30:15.125 +02:00',
    '2024-03-15T10:30-0130',
    '0050-06-01',
    '10:30',
    '23:59:59.5',
    '2023-02-29',
    '24:00',
    '15/03/2024',
    'tomorrow',
  ]

  it.each(SAMPLES)('"%s": a column detected as dates is read without a failing cell', (text) => {
    const texts = Array.from({ length: 5 }, () => text)
    const rowIds = texts.map((_, i) => i)
    const detected = inferColumn(texts, rowIds, { columnId, delimiter: ',' }).detection
    const parsed = parseColumn(columnId, texts, { ...detected, kind: 'datetime' })
    const readable = Array.from(parsed.status).every((s) => s === CELL.ok)
    expect(detected.kind === 'datetime').toBe(readable)
    expect(readable).toBe(isIsoDateTime(text))
    if (readable) expect(Array.from(parsed.values)).toEqual(texts.map(parseIsoDateTime))
  })
})
