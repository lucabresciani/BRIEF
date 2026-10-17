import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import { buildDatasetView } from '@/domain/derive/datasetView'
import { CELL, type DatasetView } from '@/domain/derive/types'
import { NATIVE, type ColumnMeta, type DatasetId, type ImportedDataset, type Result } from '@/domain/model'
import { recommend } from '@/domain/recommend/recommend'
import { importBytes, importText, type ImportDraft } from './importPipeline'

const fixtureBytes = (name: string) => new Uint8Array(readFileSync(resolve('tests/fixtures/import', name)))
const example = (name: string) => readFileSync(resolve('src/examples', name), 'utf8')

function draftOf(r: Result<ImportDraft>): ImportDraft {
  if (!r.ok) throw new Error(`import failed: ${r.error.code} ${JSON.stringify(r.error.params ?? {})}`)
  return r.value
}
const codes = (d: { issues: readonly { code: string }[] }) => d.issues.map((i) => i.code)

/** The dataset the app creates from a draft. */
function datasetOf(d: ImportDraft, columns: ColumnMeta[] = d.columns): ImportedDataset {
  return {
    id: 'ds_import' as DatasetId,
    name: d.suggestedName,
    createdAt: '2026-10-14T00:00:00Z',
    example: null,
    columns,
    notes: d.notes,
    origin: 'import',
    rawTableId: d.rawTable.id,
    layout: d.layout,
  }
}
const viewOf = (d: ImportDraft, columns?: ColumnMeta[]): DatasetView =>
  buildDatasetView(datasetOf(d, columns), d.rawTable)

/** Values of one column exactly as the analysis reads them (the dataset view; NaN when not ok). */
function values(d: ImportDraft, name: string): number[] {
  const col = d.columns.find((c) => c.name === name)
  if (!col) throw new Error(`no column ${name}`)
  const p = viewOf(d).columns.get(col.id)!
  return Array.from(p.values, (v, i) => (p.status[i] === CELL.ok ? v : NaN))
}
const labels = (d: ImportDraft, name: string) =>
  viewOf(d).columns.get(d.columns.find((c) => c.name === name)!.id)!.categories?.labels
const byName = (d: ImportDraft, name: string): ColumnMeta => d.columns.find((c) => c.name === name)!

/** Non-empty cells of the raw table vs an independent Papa parse of the same text: nothing may be lost. */
function nonEmptyRaw(d: ImportDraft): number {
  let n = 0
  for (const c of d.rawTable.columns) for (const t of c.text) if (t !== '') n++
  return n
}
function nonEmptyIndependent(text: string, delimiter: string): number {
  const rows = Papa.parse<string[]>(text, { delimiter, header: false, skipEmptyLines: false }).data
  let n = 0
  for (const r of rows) for (const t of r) if (t.replace(/\r$/, '') !== '') n++
  return n
}

describe('importBytes: Italian Excel CSV (cp1252, ";", decimal ",")', () => {
  const d = draftOf(importBytes(fixtureBytes('it-cp1252-semicolon.csv'), 'it-cp1252-semicolon.csv'))

  it('detects encoding, delimiter, header and takes the fast path', () => {
    expect(d.detection).toEqual({
      encoding: 'windows-1252',
      delimiter: ';',
      delimiterConfidence: 'high',
      alternatives: [],
      headerConfidence: 'high',
      sheetName: null,
      sheets: null,
      sheet: null,
    })
    expect(codes(d)).toEqual(['W_ENCODING_FALLBACK'])
    expect(d.fastPath).toBe(true)
    expect(d.suggestedName).toBe('it-cp1252-semicolon')
    expect(d.layout).toEqual({ headerRow: 0, unitsRow: null, dataStartRow: 1, dataEndRow: 10 })
  })

  it('reads names and units with °C and µ intact', () => {
    expect(d.columns.map((c) => [c.name, c.unit, c.unitSource])).toEqual([
      ['Tempo', 's', 'header'],
      ['Temperatura', '°C', 'header'],
      ['Tensione', 'µV', 'header'],
      ['Pressione', 'Pa', 'header'],
    ])
    expect(d.columns.every((c) => c.detected.kind === 'numeric' && c.detected.confidence === 'high')).toBe(
      true,
    )
  })

  it('reads the values with "," as decimal and "." as grouping', () => {
    expect(byName(d, 'Temperatura').detected.decimal).toBe('comma')
    expect(values(d, 'Tempo')).toEqual([0, 30, 60, 90, 120, 150, 180, 210, 240, 270])
    expect(values(d, 'Temperatura')).toEqual([21.5, 23.8, 26.1, 28, 30.4, 32.2, 34.7, 36.5, 38.9, 40.6])
    // "1,105" is ambiguous on its own; the column votes comma → 1.105, never 1105.
    expect(values(d, 'Tensione')).toEqual([0.12, 0.25, 0.37, 0.49, 0.61, 0.74, 0.86, 0.98, 1.105, 1.23])
    // "101.325" (grouping) and "101.298,5" (grouping + decimal comma).
    expect(values(d, 'Pressione')).toEqual([
      101325, 101298.5, 101310, 101287.25, 101301, 101276.5, 101290, 101265.75, 101280, 101254.5,
    ])
  })

  it('keeps the raw table exactly as read', () => {
    expect(d.rawTable.rowCount).toBe(11)
    expect(d.rawTable.source).toMatchObject({
      kind: 'csv',
      encoding: 'windows-1252',
      delimiter: ';',
      sheetName: null,
    })
    expect(d.rawTable.source.byteSize).toBe(fixtureBytes('it-cp1252-semicolon.csv').length)
    expect(d.rawTable.columns[3]!.text[2]).toBe('101.298,5')
    expect(d.rawTable.columns[1]!.text[0]).toBe('Temperatura (°C)')
    expect(Array.from(d.rawTable.sourceRow)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    expect(d.rawTable.tokenIssues.map((i) => i.code)).toEqual(['W_ENCODING_FALLBACK'])
    expect(d.rawTable.columns.every((c) => c.native === null && c.text.length === 11)).toBe(true)
    expect(d.rawTable.id).toMatch(/^raw_/)
    expect(new Set(d.columns.map((c) => c.id)).size).toBe(4)
    expect(d.columns.every((c) => /^col_/.test(c.id) && Object.keys(c.override).length === 0)).toBe(true)
  })
})

describe('importText: English CSV and pasted TSV', () => {
  it('English CSV with dot decimals', () => {
    const d = draftOf(
      importText('Time (s),Distance (m)\n0.0,0.00\n0.5,1.21\n1.0,4.93\n1.5,11.02\n', {
        kind: 'csv',
        fileName: 'run 3.csv',
      }),
    )
    expect(d.fastPath).toBe(true)
    expect(d.issues).toEqual([])
    expect(d.columns.map((c) => [c.name, c.unit, c.detected.decimal])).toEqual([
      ['Time', 's', 'dot'],
      ['Distance', 'm', 'dot'],
    ])
    expect(values(d, 'Distance')).toEqual([0, 1.21, 4.93, 11.02])
    expect(d.suggestedName).toBe('run 3')
  })

  it('TSV pasted from Italian Excel', () => {
    const d = draftOf(
      importText('t (s)\tV (V)\r\n0\t0,12\r\n1\t0,25\r\n2\t0,37\r\n', { kind: 'clipboard', fileName: null }),
    )
    expect(d.detection.delimiter).toBe('\t')
    expect(d.detection.encoding).toBeNull()
    expect(d.suggestedName).toBe('Pasted data')
    expect(values(d, 'V')).toEqual([0.12, 0.25, 0.37])
    expect(codes(d)).toEqual(['I_CLIPBOARD_PRECISION'])
    expect(d.fastPath).toBe(true)
    expect(d.rawTable.source.kind).toBe('clipboard')
  })

  it('a leading BOM in pasted text is not part of the first header', () => {
    const d = draftOf(importText('\ufeffx,y\n1,2\n3,4\n', { kind: 'clipboard', fileName: null }))
    expect(d.columns[0]!.name).toBe('x')
  })
})

describe('example datasets', () => {
  const files = readdirSync(resolve('src/examples')).filter((f) => f.endsWith('.csv'))

  it.each(files)('%s imports on the fast path with every value read', (f) => {
    const d = draftOf(importText(example(f), { kind: 'example', fileName: f }))
    expect(d.fastPath).toBe(true)
    expect(d.issues).toEqual([])
    expect(d.detection.delimiter).toBe(',')
    expect(d.layout.headerRow).toBe(0)
    for (const c of d.columns) {
      if (c.detected.kind !== 'numeric') continue
      expect([c.name, values(d, c.name).every(Number.isFinite)]).toEqual([c.name, true])
    }
  })

  it('ohm.csv: "I (A)" → I [A], "V (V)" → V [V]', () => {
    const d = draftOf(importText(example('ohm.csv'), { kind: 'example', fileName: 'ohm.csv' }))
    expect(d.columns.map((c) => [c.name, c.unit, c.role])).toEqual([
      ['I', 'A', 'measurement'],
      ['V', 'V', 'measurement'],
    ])
    expect(values(d, 'V')).toEqual([0.464, 0.941, 1.402, 1.882, 2.339, 2.808, 3.294, 3.764, 4.241, 4.706])
  })

  it('freeFall.csv: "u(y) (m)" → name u(y), unit m, suggested as the uncertainty of y', () => {
    const d = draftOf(importText(example('freeFall.csv'), { kind: 'example', fileName: 'freeFall.csv' }))
    expect(d.columns.map((c) => [c.name, c.unit])).toEqual([
      ['t', 's'],
      ['y', 'm'],
      ['u(y)', 'm'],
    ])
    const u = byName(d, 'u(y)')
    expect(u.role).toBe('uncertainty')
    expect(u.uncertaintyOf).toBe(byName(d, 'y').id)
    expect(byName(d, 'y').role).toBe('measurement')
    expect(values(d, 'u(y)')).toEqual([
      0.002, 0.002, 0.003, 0.003, 0.003, 0.003, 0.004, 0.004, 0.004, 0.005, 0.005, 0.005, 0.005, 0.006, 0.006,
    ])
  })

  it('cooling.csv: "T (°C)" and "ΔT (K)" (a difference, not an uncertainty)', () => {
    const d = draftOf(importText(example('cooling.csv'), { kind: 'example', fileName: 'cooling.csv' }))
    expect(d.columns.map((c) => [c.name, c.unit, c.role])).toEqual([
      ['t', 'min', 'measurement'],
      ['T', '°C', 'measurement'],
      ['ΔT', 'K', 'measurement'],
    ])
  })

  it('beerLambert.csv and pendulum.csv: identifier and group roles', () => {
    const b = draftOf(
      importText(example('beerLambert.csv'), { kind: 'example', fileName: 'beerLambert.csv' }),
    )
    expect(b.columns.map((c) => [c.name, c.unit, c.role])).toEqual([
      ['c', 'mg/L', 'measurement'],
      ['A', 'AU', 'measurement'],
      ['replicate', null, 'identifier'],
    ])
    const p = draftOf(importText(example('pendulum.csv'), { kind: 'example', fileName: 'pendulum.csv' }))
    expect(p.columns.map((c) => [c.name, c.unit, c.role, c.detected.kind])).toEqual([
      ['trial', null, 'identifier', 'numeric'],
      ['observer', null, 'group', 'categorical'],
      ['T', 's', 'measurement', 'numeric'],
    ])
    expect(values(p, 'T').length).toBe(24)
  })

  it('reads the same through importBytes (UTF-8 decode)', () => {
    const bytes = new Uint8Array(readFileSync(resolve('src/examples/cooling.csv')))
    const d = draftOf(importBytes(bytes, 'cooling.csv'))
    expect(d.detection.encoding).toBe('utf-8')
    expect(d.columns[1]!.unit).toBe('°C')
    expect(d.fastPath).toBe(true)
  })
})

describe('fast path is refused when the reading is uncertain', () => {
  it('single column of decimal-comma numbers: "none" vs "," must be confirmed', () => {
    const d = draftOf(importBytes(fixtureBytes('single-col-comma.csv'), 'single-col-comma.csv'))
    expect(d.detection.delimiter).toBe('none')
    expect(d.detection.delimiterConfidence).toBe('low')
    expect(d.detection.alternatives).toEqual([','])
    expect(codes(d)).toContain('W_SINGLE_COLUMN')
    expect(d.fastPath).toBe(false)
    expect(d.columns.map((c) => [c.name, c.unit, c.detected.decimal])).toEqual([['T', 's', 'comma']])
    expect(values(d, 'T')).toEqual([1.7, 1.75, 1.76, 1.7, 1.72, 1.698])
    // Choosing "," gives two integer columns, and the user's choice is not doubted again.
    const two = draftOf(
      importBytes(fixtureBytes('single-col-comma.csv'), 'single-col-comma.csv', { delimiter: ',' }),
    )
    expect(two.columns.length).toBe(2)
    expect(two.detection.delimiterConfidence).toBe('high')
    expect(two.detection.alternatives).toEqual(['none'])
    expect(codes(two)).not.toContain('W_SINGLE_COLUMN')
  })

  it('mixed "." and "," decimals → W_DECIMAL_MIXED, ambiguous cell not read', () => {
    const d = draftOf(importBytes(fixtureBytes('mixed-decimal.csv'), 'mixed-decimal.csv'))
    const col = byName(d, 'length')
    expect(col.unit).toBe('cm')
    expect(col.detected.decimal).toBe('mixed')
    expect(codes(d)).toEqual(expect.arrayContaining(['W_DECIMAL_MIXED', 'W_DECIMAL_AMBIGUOUS']))
    expect(d.fastPath).toBe(false)
    expect(values(d, 'length')).toEqual([12.5, 12.7, 12.4, 12.6, 12.55, NaN])
  })

  it('only ambiguous tokens ("1.234") → W_DECIMAL_AMBIGUOUS, low confidence', () => {
    const d = draftOf(importText('x,y\n1.234,2\n2.345,3\n3.456,4\n', { kind: 'csv', fileName: 'a.csv' }))
    expect(codes(d)).toContain('W_DECIMAL_AMBIGUOUS')
    expect(byName(d, 'x').detected.confidence).toBe('low')
    expect(d.fastPath).toBe(false)
  })

  it('an ambiguous column follows the decimal convention of the other columns (still to confirm)', () => {
    const d = draftOf(
      importText('a;b\n1,5;1.234\n2,5;2.345\n3,5;3.456\n', { kind: 'csv', fileName: 'a.csv' }),
    )
    const b = byName(d, 'b')
    expect(b.detected.decimal).toBe('comma')
    const amb = d.issues.find((i) => i.code === 'W_DECIMAL_AMBIGUOUS' && i.columnId === b.id)!
    expect(amb.params!.because).toBe('otherColumns')
    expect(values(d, 'b')).toEqual([1234, 2345, 3456])
    expect(d.fastPath).toBe(false)
  })

  it('all-text table → W_HEADER_UNCERTAIN', () => {
    const d = draftOf(importText('apple,red\npear,green\nplum,purple\n', { kind: 'csv', fileName: 'f.csv' }))
    expect(codes(d)).toContain('W_HEADER_UNCERTAIN')
    expect(d.detection.headerConfidence).toBe('low')
    expect(d.fastPath).toBe(false)
  })

  it('ambiguous delimiter → W_DELIMITER_AMBIGUOUS', () => {
    const text = 'Rossi, Mario;12;3\nBianchi, Anna;14;5\nVerdi, Luca;11;2\nNeri, Ugo;15;4\n'
    const d = draftOf(importText(text, { kind: 'csv', fileName: 'f.csv' }))
    expect(codes(d)).toContain('W_DELIMITER_AMBIGUOUS')
    expect(d.fastPath).toBe(false)
  })

  it('ragged rows: padded, extra field kept as a column, dialog required', () => {
    const d = draftOf(importBytes(fixtureBytes('ragged.csv'), 'ragged.csv'))
    expect(d.detection.delimiterConfidence).toBe('low')
    expect(d.fastPath).toBe(false)
    expect(d.issues.find((i) => i.code === 'W_RAGGED_ROWS')!.params).toEqual({ count: 1, row: 3 })
    expect(d.issues.find((i) => i.code === 'W_EXTRA_FIELDS')!.params).toEqual({ count: 1, row: 5 })
    expect(d.columns.map((c) => c.name)).toEqual(['x', 'y', 'z', 'Column 4'])
    expect(values(d, 'z')).toEqual([3, NaN, 9, 12, 16])
    expect(values(d, 'Column 4')).toEqual([NaN, NaN, NaN, 13, NaN])
  })

  it('unclosed quote blocks the import until "ignore quotes" is chosen', () => {
    const r = importBytes(fixtureBytes('unclosed-quote.csv'), 'unclosed-quote.csv')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.code).toBe('E_QUOTES_UNCLOSED')
      expect(r.error.params).toEqual({ row: 3, kind: 'unclosed' })
    }
    const d = draftOf(
      importBytes(fixtureBytes('unclosed-quote.csv'), 'unclosed-quote.csv', { ignoreQuotes: true }),
    )
    expect(d.rawTable.columns[0]!.text).toEqual(['label', 'alpha', '"beta', 'gamma', 'delta'])
    expect(values(d, 'value')).toEqual([1, 2, 3, 4])
  })
})

describe('layout cases end to end', () => {
  it('12-line preamble → notes, header after it, fast path still possible', () => {
    const d = draftOf(importBytes(fixtureBytes('preamble-12.csv'), 'preamble-12.csv'))
    expect(d.notes.length).toBe(12)
    expect(d.notes[0]).toBe('Instrument: Vernier LabQuest 2')
    expect(codes(d)).toEqual(['I_PREAMBLE_KEPT'])
    expect(d.layout).toEqual({ headerRow: 12, unitsRow: null, dataStartRow: 13, dataEndRow: 27 })
    expect(d.columns.map((c) => [c.name, c.unit])).toEqual([
      ['t', 's'],
      ['x', 'm'],
      ['v', 'm/s'],
    ])
    expect(values(d, 't').length).toBe(15)
    expect(d.fastPath).toBe(true)
  })

  it('units row', () => {
    const d = draftOf(importBytes(fixtureBytes('units-row.csv'), 'units-row.csv'))
    expect(d.layout.unitsRow).toBe(1)
    expect(d.columns.map((c) => [c.name, c.unit, c.unitSource])).toEqual([
      ['time', 's', 'unitsRow'],
      ['position', 'm', 'unitsRow'],
      ['velocity', 'm/s', 'unitsRow'],
    ])
    expect(codes(d)).toEqual(['I_UNITS_ROW'])
    expect(values(d, 'velocity')).toEqual([0, 0.98, 1.96, 2.94, 3.92])
  })

  it('"sep=;" line: delimiter forced, line kept in the raw table, not part of the table', () => {
    const d = draftOf(importBytes(fixtureBytes('sep-line.csv'), 'sep-line.csv'))
    expect(d.detection.delimiter).toBe(';')
    expect(codes(d)).toEqual(['I_SEP_LINE'])
    expect(d.rawTable.columns[0]!.text[0]).toBe('sep=')
    expect(d.layout.headerRow).toBe(1)
    expect(values(d, 'y')).toEqual([1.25, 2.5, 3.75, 5])
    expect(d.notes).toEqual([])
    expect(d.fastPath).toBe(true)
  })

  it('blank lines → I_BLANK_ROWS, kept in the raw table, not counted as data', () => {
    const d = draftOf(importBytes(fixtureBytes('blank-lines.csv'), 'blank-lines.csv'))
    const blank = d.issues.find((i) => i.code === 'I_BLANK_ROWS')!
    expect(blank.params).toEqual({ count: 2 })
    expect(blank.rows).toEqual([3, 6])
    expect(d.rawTable.rowCount).toBe(9)
    expect(values(d, 'y')).toEqual([1, 2.1, 2.9, 4.2, 5.1, 6])
    expect(codes(d)).not.toContain('I_MISSING_VALUES')
    expect(d.fastPath).toBe(true)
  })

  it('embedded newlines: sourceRow points at the physical line of each record', () => {
    const d = draftOf(importBytes(fixtureBytes('embedded-newline.csv'), 'embedded-newline.csv'))
    expect(Array.from(d.rawTable.sourceRow)).toEqual([1, 2, 4, 5, 8])
    expect(byName(d, 'comment').detected.kind).not.toBe('numeric')
    expect(d.rawTable.columns[1]!.text[3]).toBe('multi\nline\ntext')
    expect(values(d, 'value')).toEqual([3.5, 4, 5.5, 6])
  })

  it('UTF-16LE Excel Unicode text', () => {
    const d = draftOf(importBytes(fixtureBytes('utf16le-excel.txt'), 'utf16le-excel.txt'))
    expect(d.detection.encoding).toBe('utf-16le')
    expect(d.detection.delimiter).toBe('\t')
    expect(d.rawTable.source.kind).toBe('text')
    expect(d.columns.map((c) => [c.name, c.unit, c.detected.kind])).toEqual([
      ['Campione', null, 'categorical'],
      ['m', 'µg', 'numeric'],
      ['T', '°C', 'numeric'],
    ])
    expect(values(d, 'm')).toEqual([12.5, 13.1, 12.8, 14.2, 13.9, 14.6])
    expect(d.fastPath).toBe(true)
  })

  it('header override: treat the first row as data', () => {
    const d = draftOf(importText('x,y\n1,2\n3,4\n', { kind: 'csv', fileName: 'a.csv' }, { headerRow: null }))
    expect(d.layout).toEqual({ headerRow: null, unitsRow: null, dataStartRow: 0, dataEndRow: 2 })
    expect(d.columns.map((c) => c.name)).toEqual(['Column 1', 'Column 2'])
    // "x" and "y" are now invalid cells of numeric columns, reported as such.
    expect(codes(d)).toContain('W_COLUMN_PARTLY_NUMERIC')
  })

  it('an empty trailing column (trailing delimiter) is not offered but stays in the raw table', () => {
    const d = draftOf(importText('a;b;\n1;2;\n3;4;\n', { kind: 'csv', fileName: 'a.csv' }))
    expect(d.columns.map((c) => c.name)).toEqual(['a', 'b'])
    expect(d.rawTable.columns.length).toBe(3)
    expect(codes(d)).toEqual(['I_TRIMMED_EMPTY'])
  })
})

describe('no data silently discarded', () => {
  const cases: [string, string][] = [
    ['it-cp1252-semicolon.csv', ';'],
    ['preamble-12.csv', ','],
    ['ragged.csv', ','],
    ['blank-lines.csv', ','],
    ['units-row.csv', ','],
    ['embedded-newline.csv', ','],
    ['sep-line.csv', ';'],
    ['mixed-decimal.csv', ';'],
    ['crlf.csv', ','],
  ]
  it.each(cases)('%s: every non-empty field of the file is in the raw table', (name, delimiter) => {
    const bytes = fixtureBytes(name)
    const d = draftOf(importBytes(bytes, name))
    const text = new TextDecoder(d.detection.encoding!).decode(bytes)
    expect(nonEmptyRaw(d)).toBe(nonEmptyIndependent(text, delimiter))
    for (const c of d.rawTable.columns) expect(c.text.length).toBe(d.rawTable.rowCount)
  })

  it('every data cell is either read or reported (missing values are NaN + status, never 0)', () => {
    const d = draftOf(importText('x,y\n1,2\n2,NA\n3,\n4,8\n', { kind: 'csv', fileName: 'a.csv' }))
    expect(values(d, 'y')).toEqual([2, NaN, NaN, 8])
    const missing = d.issues.find((i) => i.code === 'I_MISSING_VALUES')!
    expect(missing.params!.count).toBe(2)
    expect(missing.rows).toEqual([2, 3])
    expect(missing.columnId).toBe(byName(d, 'y').id)
  })
})

describe('errors', () => {
  it('empty input', () => {
    for (const t of ['', '   \n\n']) {
      const r = importText(t, { kind: 'clipboard', fileName: null })
      expect(!r.ok && r.error.code).toBe('E_EMPTY_INPUT')
    }
    const r = importBytes(new Uint8Array(0), 'a.csv')
    expect(!r.ok && r.error.code).toBe('E_EMPTY_INPUT')
  })

  it('header without data rows', () => {
    const r = importText('x,y\n', { kind: 'csv', fileName: 'a.csv' })
    expect(!r.ok && r.error.code).toBe('E_NO_DATA_ROWS')
  })

  it('unsupported formats', () => {
    // Without SheetJS a workbook cannot be read, whatever its container.
    const xls = importBytes(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), 'old.xls')
    expect(!xls.ok && xls.error).toMatchObject({ code: 'E_UNSUPPORTED_FORMAT', params: { format: 'xls' } })
    const proj = importBytes(new TextEncoder().encode('{"format":"sciplot"}'), 'p.sciplot')
    expect(!proj.ok && proj.error.code).toBe('E_UNSUPPORTED_FORMAT')
    const bin = importBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]), 'img.png')
    expect(!bin.ok && bin.error).toMatchObject({ code: 'E_UNSUPPORTED_FORMAT', params: { format: 'png' } })
    const zip = importBytes(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]), 'book.xlsx')
    expect(!zip.ok && zip.error).toMatchObject({ code: 'E_UNSUPPORTED_FORMAT', params: { format: 'xlsx' } })
  })

  it('file too large is refused, never truncated', () => {
    const big = new Uint8Array(25 * 2 ** 20 + 1).fill(0x61)
    const r = importBytes(big, 'big.csv')
    expect(!r.ok && r.error).toMatchObject({ code: 'E_FILE_TOO_LARGE', params: { limit: 25 } })
  })

  it('large file → W_FILE_LARGE but imported', () => {
    const line = '1234567890.123456,9876543210.654321\n'
    const text = 'a,b\n' + line.repeat(Math.ceil((5.2 * 2 ** 20) / line.length))
    const d = draftOf(importBytes(new TextEncoder().encode(text), 'big.csv'))
    expect(codes(d)).toContain('W_FILE_LARGE')
    expect(d.columns.length).toBe(2)
  }, 30_000)

  it('too many cells → E_TOO_MANY_CELLS', () => {
    const text = '1,2,3,4\n'.repeat(500_001)
    const r = importText(text, { kind: 'csv', fileName: 'many.csv' })
    expect(!r.ok && r.error.code).toBe('E_TOO_MANY_CELLS')
    expect(!r.ok && r.error.params!.limit).toBe(2_000_000)
  }, 30_000)
})

describe('spreadsheets (SheetJS injected)', () => {
  function workbookBytes(aoa: unknown[][], bookType: 'xlsx' | 'ods'): Uint8Array {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Misure')
    return new Uint8Array(XLSX.write(wb, { type: 'array', bookType }) as ArrayBuffer)
  }

  it('OLE containers: a damaged .xls is unreadable; a password-protected .xlsx is reported as such', () => {
    const ole = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
    const legacy = importBytes(new Uint8Array([...ole, 0, 0, 0, 0]), 'old.xls', {}, { xlsx: XLSX })
    expect(!legacy.ok && legacy.error).toMatchObject({
      code: 'E_SPREADSHEET_UNREADABLE',
      params: { reason: 'corrupt' },
    })
    const stub = importBytes(fixtureBytes('legacy.xls'), 'legacy.xls', {}, { xlsx: XLSX })
    expect(!stub.ok && stub.error).toMatchObject({
      code: 'E_SPREADSHEET_UNREADABLE',
      params: { reason: 'corrupt' },
    })
    // OOXML encryption stores an "EncryptionInfo" stream (UTF-16LE name) in an OLE file.
    const name = [...'EncryptionInfo'].flatMap((ch) => [ch.charCodeAt(0), 0])
    const locked = importBytes(new Uint8Array([...ole, ...name]), 'locked.xlsx', {}, { xlsx: XLSX })
    expect(!locked.ok && locked.error).toMatchObject({
      code: 'E_SPREADSHEET_UNREADABLE',
      params: { reason: 'password' },
    })
  })

  it.each(['xlsx', 'ods'] as const)('%s: numbers come from the native values', (bookType) => {
    const bytes = workbookBytes(
      [
        ['I (A)', 'V (V)'],
        [0.01, 0.464],
        [0.02, 0.941],
        [0.03, 1.402],
      ],
      bookType,
    )
    const d = draftOf(importBytes(bytes, `book.${bookType}`, {}, { xlsx: XLSX }))
    expect(d.rawTable.source.kind).toBe(bookType)
    expect(d.detection.sheetName).toBe('Misure')
    expect(d.detection.sheets?.[0]?.name).toBe('Misure')
    expect(d.detection.delimiter).toBeNull()
    expect(d.columns.map((c) => [c.name, c.unit, c.detected.kind])).toEqual([
      ['I', 'A', 'numeric'],
      ['V', 'V', 'numeric'],
    ])
    const v = d.rawTable.columns[1]!.native!
    expect(v.kind[1]).toBe(NATIVE.number)
    expect(Array.from(v.num.slice(1, 4))).toEqual([0.464, 0.941, 1.402])
    expect(d.fastPath).toBe(true)
  })
})

/**
 * Regressions from the adversarial import review: every case goes through importText/importBytes and the
 * dataset view, i.e. exactly what the app plots, and must never lose data or invent values silently.
 */
describe('import review regressions (end to end)', () => {
  const csv = (text: string, overrides = {}) =>
    draftOf(importText(text, { kind: 'csv', fileName: 'f.csv' }, overrides))

  it('a malformed quote ("abc"def) blocks the import instead of merging rows into one cell', () => {
    for (const text of [
      'sample,v\n"abc"def,1\nx,2\ny,3\n"z",4\nw,5\n',
      'Item;Length (cm)\n"Rod A" long;12,5\nRod B;13,1\nRod C;12,9\n"Rod D";13,4\n',
    ]) {
      const r = importText(text, { kind: 'csv', fileName: 'f.csv' })
      expect(r.ok).toBe(false)
      expect(!r.ok && r.error).toMatchObject({
        code: 'E_QUOTES_UNCLOSED',
        params: { row: 2, kind: 'malformed' },
      })
    }
    // The dialog's remedy reads every row, quotes as text.
    const d = csv('sample,v\n"abc"def,1\nx,2\ny,3\n"z",4\nw,5\n', { ignoreQuotes: true })
    expect(values(d, 'v')).toEqual([1, 2, 3, 4, 5])
    expect(labels(d, 'sample')).toEqual(['"abc"def', 'x', 'y', '"z"', 'w'])
  })

  it('"Ignore quotes" re-runs delimiter detection: an opening quote on line 1 no longer hides ","', () => {
    const blocked = importText('"t,n\n0,12\n1,15\n2,19\n', { kind: 'csv', fileName: 'f.csv' })
    expect(!blocked.ok && blocked.error.code).toBe('E_QUOTES_UNCLOSED')
    const d = csv('"t,n\n0,12\n1,15\n2,19\n', { ignoreQuotes: true })
    expect(d.detection.delimiter).toBe(',')
    expect(d.columns.map((c) => c.name)).toEqual(['"t', 'n'])
    expect(values(d, 'n')).toEqual([12, 15, 19]) // never the decimal-comma reading 0.12, 1.15, 2.19
  })

  it('whitespace-separated .dat text: no fused numbers ("10 100.9" ≠ 10100.9), confirmation required', () => {
    for (const text of [
      't P\n0 101.3\n5 101.1\n10 100.9\n15 100.7\n20 100.5\n',
      't counts\n1 120\n2 135\n3 160\n4 171\n',
    ]) {
      const d = csv(text)
      expect(d.detection.delimiter).toBe('none')
      expect(d.detection.delimiterConfidence).toBe('low')
      expect(d.fastPath).toBe(false)
      const col = d.columns[0]!
      const p = viewOf(d).columns.get(col.id)!
      for (let i = 0; i < p.values.length; i++) expect(Number.isNaN(p.values[i])).toBe(true)
    }
    // Typographic group separators (NBSP) still read, without a delimiter and with one; and with a
    // delimiter an ordinary space between digits is still a thousands separator.
    const nbsp = csv('m (g)\n1\u00a0234\n2\u00a0345\n12\u00a0345\n')
    expect([nbsp.detection.delimiter, nbsp.detection.delimiterConfidence]).toEqual(['none', 'high'])
    expect(values(nbsp, 'm')).toEqual([1234, 2345, 12345])
    expect(values(csv('t;m (g)\n1;1\u00a0234,5\n2;2 345,25\n'), 'm')).toEqual([1234.5, 2345.25])
  })

  it('header and measurements are never pushed into the notes by the preamble rule', () => {
    // A remarks column filled only in later rows.
    const a = csv(
      't (s),V (V)\n0,1.0\n1,1.9\n2,3.1\n3,4.0,check\n4,5.1,check\n5,6.0,recal\n6,7.1,ok\n7,8.0,ok\n',
    )
    expect(a.layout.headerRow).toBe(0)
    expect(a.notes).toEqual([])
    expect(values(a, 't')).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(a.columns.map((c) => [c.name, c.unit])).toEqual([
      ['t', 's'],
      ['V', 'V'],
      ['Column 3', null],
    ])
    // A header with two unnamed columns.
    const b = csv('Time,V,,\n0,1,0.1,a\n1,2,0.1,b\n2,3,0.2,c\n')
    expect(b.layout.headerRow).toBe(0)
    expect(b.columns.map((c) => c.name)).toEqual(['Time', 'V', 'Column 3', 'Column 4'])
    expect(b.notes).toEqual([])
    // A headerless first data row with an empty cell.
    const c = csv('0,1.2,\n1,1.5,0.1\n2,1.8,0.1\n3,2.1,0.1\n')
    expect(c.layout).toMatchObject({ headerRow: null, dataStartRow: 0 })
    expect(values(c, 'Column 2')).toEqual([1.2, 1.5, 1.8, 2.1])
    expect(c.notes).toEqual([])
  })

  it('a title or key/value lines above the real header stay notes; the real header (with units) is used', () => {
    const title = csv('Pendulum experiment, group 3\nTime (s),Angle (deg)\n0,10.1\n1,9.8\n2,9.5\n3,9.1\n')
    expect(title.columns.map((c) => [c.name, c.unit])).toEqual([
      ['Time', 's'],
      ['Angle', 'deg'],
    ])
    expect(title.notes).toEqual(['Pendulum experiment | group 3'])
    expect(values(title, 'Angle')).toEqual([10.1, 9.8, 9.5, 9.1])
    const kv = csv('Operator,Mario Rossi\nDate,2024-03-15\nTime (s),Voltage (V)\n0,1.21\n1,1.35\n2,1.52\n')
    expect(kv.layout.headerRow).toBe(2)
    expect(kv.notes).toEqual(['Operator | Mario Rossi', 'Date | 2024-03-15'])
    expect(values(kv, 'Voltage')).toEqual([1.21, 1.35, 1.52])
    const it_ = csv(
      'Strumento;Termometro XYZ\nData;15/03/2024\n\nTempo (s);Temperatura (°C)\n0;20,5\n30;21,7\n60;22,9\n',
    )
    expect(it_.layout.headerRow).toBe(3)
    expect(it_.detection.headerConfidence).toBe('high')
    expect(values(it_, 'Temperatura')).toEqual([20.5, 21.7, 22.9])
  })

  it('a first data row holding a flag ("A,BDL") is data, not a units row', () => {
    const d = csv('Sample,Conc (mg/L)\nA,BDL\nB,0.52\nC,0.71\nD,0.93\n')
    expect(d.layout).toMatchObject({ headerRow: 0, unitsRow: null, dataStartRow: 1 })
    expect(labels(d, 'Sample')).toEqual(['A', 'B', 'C', 'D'])
    expect(byName(d, 'Sample').unit).toBeNull()
    expect(values(d, 'Conc')).toEqual([NaN, 0.52, 0.71, 0.93])
    expect(codes(d)).not.toContain('I_UNITS_ROW')
    expect(d.fastPath).toBe(false) // one cell in four is not a number: review it
  })

  it('"Name, unit" header over decimal commas → one column read 1.5, 2.3, 3.1 (to confirm)', () => {
    const d = csv('Lunghezza, cm\n1,5\n2,3\n3,1\n')
    expect(d.detection.delimiter).toBe('none')
    expect(d.detection.delimiterConfidence).toBe('low')
    expect(d.detection.alternatives).toEqual([','])
    expect(values(d, 'Lunghezza, cm')).toEqual([1.5, 2.3, 3.1])
    expect(d.fastPath).toBe(false)
  })

  it('a single column of "1,425" values follows the detector: decimal comma (1.425, not 1425)', () => {
    const d = csv('Period (s)\n1,425\n1,438\n1,402\n1,419\n')
    expect(byName(d, 'Period').detected.decimal).toBe('comma')
    expect(values(d, 'Period')).toEqual([1.425, 1.438, 1.402, 1.419])
    const amb = d.issues.find((i) => i.code === 'W_DECIMAL_AMBIGUOUS')!
    expect(amb.params).toMatchObject({ because: 'singleColumnComma', chosen: 1.425 })
    expect(d.fastPath).toBe(false)
  })

  it('"1.000" in a comma-decimal column (and "1,000" in a dot column) is a conflict, never 1000', () => {
    const it_ = csv('Tempo (s);Lunghezza (m)\n0;0,995\n1;1.000\n2;1,005\n3;1,010\n')
    expect(values(it_, 'Lunghezza')).toEqual([0.995, NaN, 1.005, 1.01])
    const conflict = it_.issues.find((i) => i.code === 'W_SEPARATOR_CONFLICT')!
    expect(conflict.params).toMatchObject({ count: 1 })
    expect(conflict.rows).toEqual([2])
    expect(byName(it_, 'Lunghezza').detected.confidence).toBe('low')
    expect(it_.fastPath).toBe(false)
    const en = csv('Time (s)\tLength (m)\n0\t0.995\n1\t1,000\n2\t1.005\n3\t1.010\n')
    expect(values(en, 'Length')).toEqual([0.995, NaN, 1.005, 1.01])
    expect(en.fastPath).toBe(false)
  })

  it('category labels that look like missing-value words are kept ("none" control, sodium "Na")', () => {
    const t = csv('Treatment,Yield (g)\nnone,1.2\nnone,1.3\nnone,1.1\nfertilizer,2.1\nfertilizer,2.3\n')
    expect(labels(t, 'Treatment')).toEqual(['none', 'fertilizer'])
    expect(codes(t)).not.toContain('I_MISSING_VALUES')
    expect(byName(t, 'Treatment').role).toBe('group')
    const e = csv('Element,Radius (pm)\nLi,76\nNa,102\nK,138\nRb,152\nCs,167\n')
    expect(labels(e, 'Element')).toEqual(['Li', 'Na', 'K', 'Rb', 'Cs'])
  })

  it('physical symbols are not suggested as uncertainties: the default plot stays a scatter', () => {
    for (const text of [
      'ε (%),σ (MPa)\n0.0,0\n0.1,20.5\n0.2,41.0\n0.3,61.2\n',
      't (s),U_C (V)\n0,5.00\n1,3.03\n2,1.84\n3,1.12\n',
      'Fe (mg/L),Se (mg/L)\n0.1,0.01\n0.2,0.02\n0.3,0.025\n0.4,0.04\n',
      'T (K),sigma (S/m)\n300,1.2\n310,1.4\n320,1.7\n330,2.1\n',
    ]) {
      const d = csv(text)
      expect([text, d.columns.map((c) => c.role)]).toEqual([text, ['measurement', 'measurement']])
      expect(recommend(datasetOf(d), viewOf(d)).plotType).toBe('scatter')
    }
    // A real uncertainty column still is one.
    const u = csv('t (s),y (m),σ (m)\n0,0.1,0.01\n1,0.4,0.01\n2,0.9,0.02\n')
    expect(byName(u, 'σ').role).toBe('uncertainty')
    expect(byName(u, 'σ').uncertaintyOf).toBe(byName(u, 'y').id)
  })

  it('header names with a letter tail ("1st", "2Theta") are names, not numbers', () => {
    const a = csv('Trial,1st,2nd,3rd\n1,1.42,1.45,1.43\n2,1.40,1.44,1.41\n3,1.43,1.42,1.44\n')
    expect(a.layout.headerRow).toBe(0)
    expect(a.columns.map((c) => c.name)).toEqual(['Trial', '1st', '2nd', '3rd'])
    expect(values(a, '1st')).toEqual([1.42, 1.4, 1.43])
    const b = csv('2Theta,Intensity\n10.0,123\n10.5,130\n11.0,180\n')
    expect(b.columns.map((c) => c.name)).toEqual(['2Theta', 'Intensity'])
    expect(b.fastPath).toBe(true)
  })

  it('a key/value line between header and data is kept as data and flagged, never dropped', () => {
    const d = csv('x,y\nSample rate,1000\n0,1\n1,2\n2,3\n')
    expect(d.layout).toMatchObject({ headerRow: 0, dataStartRow: 1 })
    expect(values(d, 'y')).toEqual([1000, 1, 2, 3])
    expect(codes(d)).toContain('W_HEADER_UNCERTAIN')
    expect(d.fastPath).toBe(false)
    // A numeric line above the header (data or a date?) is a note, flagged too.
    const p = csv('14,10,2024\nTime,V,I\n0,1,2\n1,2,3\n2,3,4\n')
    expect(p.notes).toEqual(['14 | 10 | 2024'])
    expect(codes(p)).toEqual(['W_HEADER_UNCERTAIN', 'I_PREAMBLE_KEPT'])
    expect(p.fastPath).toBe(false)
    // A stray word inside the data is just an invalid cell (no header doubt).
    const s = csv('x,y\n1,2\n2,n/r\n3,4\n4,5\n5,6\n')
    expect(codes(s)).toEqual(['W_COLUMN_PARTLY_NUMERIC'])
    expect(values(s, 'y')).toEqual([2, NaN, 4, 5, 6])
  })

  it('a title merged across an Excel table stays a note; the header row below names the columns', () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Experiment 3: cooling', '', '', ''],
      ['t (s)', 'T1 (°C)', 'T2 (°C)', 'T3 (°C)'],
      [0, 80, 81, 79],
      [60, 71, 72, 70],
      [120, 64, 65, 63],
    ])
    ws['!merges'] = [XLSX.utils.decode_range('A1:D1')]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'S')
    const bytes = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)
    const d = draftOf(importBytes(bytes, 'cooling.xlsx', {}, { xlsx: XLSX }))
    expect(d.columns.map((c) => [c.name, c.unit])).toEqual([
      ['t', 's'],
      ['T1', '°C'],
      ['T2', '°C'],
      ['T3', '°C'],
    ])
    expect(d.notes).toEqual(['Experiment 3: cooling'])
    expect(values(d, 'T2')).toEqual([81, 72, 65])
    expect(codes(d)).not.toContain('W_MERGED_CELLS')
    expect(d.fastPath).toBe(true)
  })

  it('merged-header fixture: the group row is a note, the row with units is the header', () => {
    const d = draftOf(
      importBytes(fixtureBytes('merged-header.xlsx'), 'merged-header.xlsx', {}, { xlsx: XLSX }),
    )
    expect(d.columns.map((c) => [c.name, c.unit])).toEqual([
      ['T1', '°C'],
      ['T2', '°C'],
      ['p', 'kPa'],
    ])
    expect(d.notes).toEqual(['Temperature | Temperature | Pressure'])
  })

  it('Excel time-of-day cells read like the CSV "10:30:00" (ms since midnight), never 31 Dec 1899', () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['clock', 'T (°C)'],
      [0.4375, 20.1],
      [0.5, 20.6],
      [0.5625, 21.3],
    ])
    for (const a of ['A2', 'A3', 'A4']) ws[a].z = 'hh:mm:ss'
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'S')
    const bytes = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)
    const d = draftOf(importBytes(bytes, 'clock.xlsx', {}, { xlsx: XLSX }))
    expect(byName(d, 'clock').detected.kind).toBe('datetime')
    expect(values(d, 'clock')).toEqual([37_800_000, 43_200_000, 48_600_000])
    const fromCsv = draftOf(
      importText('clock\n10:30:00\n12:00:00\n13:30:00\n', { kind: 'csv', fileName: 'c.csv' }),
    )
    const c = byName(fromCsv, 'clock')
    const asDate = viewOf(fromCsv, [{ ...c, override: { kind: 'datetime' } }]).columns.get(c.id)!
    expect(Array.from(asDate.values)).toEqual([37_800_000, 43_200_000, 48_600_000])
  })

  it('relabelling or clearing a unit never changes which cells are valid', () => {
    const d = csv('I (A),U\n0.1,12 mV\n0.2,15 mV\n0.3,18 mV\n')
    const u = byName(d, 'U')
    expect(u.unit).toBe('mV')
    expect(values(d, 'U')).toEqual([12, 15, 18])
    for (const unit of ['millivolt', null, 'V']) {
      const cols = d.columns.map((c) => (c.id === u.id ? { ...c, unit, unitSource: 'user' as const } : c))
      const p = viewOf(d, cols).columns.get(u.id)!
      expect([unit, Array.from(p.values)]).toEqual([unit, [12, 15, 18]])
      expect(Array.from(p.status)).toEqual([CELL.ok, CELL.ok, CELL.ok])
    }
  })
})

describe('property: the importer and the dataset view agree, and no row disappears', () => {
  it('random small tables (seeded): never throw; flagged rows = view statuses; every row accounted for', () => {
    let s = 20261014
    const rnd = () => {
      s = (s + 0x6d2b79f5) >>> 0
      let t = s
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    const pick = <T>(a: readonly T[]) => a[Math.floor(rnd() * a.length)]!
    const cells = [
      '',
      '0',
      '12',
      '-3',
      '0.5',
      '0,5',
      '1,234',
      '1.000',
      '1,234.5',
      '101.298,5',
      '10 100.9',
      '1\u00a0234,5',
      '12 mV',
      '13 V',
      '12%',
      'NA',
      'none',
      '-',
      '#DIV/0!',
      'abc',
      'A',
      'Na',
      'BDL',
      '<0.5',
      'Time (s)',
      'σ (MPa)',
      '1st',
      '"q"',
      '"x"y',
      '2024-03-15',
      'Sample rate',
      'Lunghezza, cm',
      's',
      'mg/L',
    ]
    const checks = [
      ['W_SEPARATOR_CONFLICT', CELL.separatorConflict],
      ['W_UNEXPECTED_UNIT', CELL.unexpectedUnit],
      ['I_MISSING_VALUES', CELL.missing],
    ] as const
    const failures: unknown[] = []
    for (let k = 0; k < 3000; k++) {
      const sep = pick([',', ';', '\t', ' '])
      const nRows = 1 + Math.floor(rnd() * 10)
      const nCols = 1 + Math.floor(rnd() * 4)
      const lines = Array.from({ length: nRows }, () =>
        Array.from({ length: rnd() < 0.15 ? Math.max(1, nCols - 1) : nCols }, () => pick(cells)).join(sep),
      )
      const text = lines.join('\n') + '\n'
      const r = importText(text, { kind: 'csv', fileName: 'f.csv' })
      if (!r.ok) continue
      const d = r.value
      const v = viewOf(d)
      for (const c of d.columns) {
        const p = v.columns.get(c.id)!
        for (const [code, status] of checks) {
          const listed = d.issues.find((i) => i.code === code && i.columnId === c.id)?.rows ?? []
          const actual: number[] = []
          for (let i = 0; i < p.status.length; i++) if (p.status[i] === status) actual.push(v.rowIds[i]!)
          if (listed.join() !== actual.join()) failures.push({ text, column: c.name, code, listed, actual })
        }
      }
      const L = d.layout
      const accounted = new Set<number>(v.rowIds)
      for (const i of [L.headerRow, L.unitsRow]) if (i !== null) accounted.add(i)
      const start = L.headerRow ?? L.dataStartRow
      for (let i = 0; i < d.rawTable.rowCount; i++) {
        const filled = d.rawTable.columns.some((col) => col.text[i]!.trim() !== '')
        if (filled && i >= start && !accounted.has(i)) failures.push({ text, lostRow: i, layout: L })
      }
    }
    expect(failures.slice(0, 5)).toEqual([])
  })
})

describe('a column named N', () => {
  const roles = (text: string) =>
    draftOf(importText(text, { kind: 'clipboard', fileName: null })).columns.map((c) => c.role)

  it('of counts stays a measurement, so dated counts still get a plot', () => {
    expect(roles('date\tN\n2019-01-01\t5\n2020-01-01\t7\n2021-01-01\t6\n2022-01-01\t9\n')).toEqual([
      'measurement',
      'measurement',
    ])
  })

  it('counting 1, 2, 3 in row order is a row counter', () => {
    expect(roles('n\tV (V)\n1\t0.5\n2\t0.7\n3\t0.6\n')).toEqual(['identifier', 'measurement'])
  })
})
