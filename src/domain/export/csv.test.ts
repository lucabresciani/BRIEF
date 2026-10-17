import { describe, it, expect } from 'vitest'
import Papa from 'papaparse'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildDatasetView } from '@/domain/derive/datasetView'
import { importText } from '@/domain/import/importPipeline'
import { parseNumber } from '@/domain/import/numberToken'
import {
  INACTIVE,
  type ColumnId,
  type ColumnMeta,
  type DatasetId,
  type ImportedDataset,
  type NotebookDataset,
  type RawTable,
  type RawTableId,
  type RowId,
} from '@/domain/model'
import {
  CELL,
  type AnalysisSample,
  type DatasetView,
  type FitOk,
  type ParsedColumn,
} from '@/domain/derive/types'
import {
  CSV_PRESETS,
  analysisCsv,
  cellInDecimal,
  analysisRows,
  csvNumber,
  guardFormula,
  originalCsv,
  toCsv,
  type CsvOptions,
} from './csv'

const BOM = String.fromCharCode(0xfeff)
const FULLWIDTH_EQUALS = String.fromCharCode(0xff1d)

/** Independent RFC 4180 reader (Papa Parse) to check what we write. */
function parse(text: string, delimiter: string): string[][] {
  const body = text.startsWith(BOM) ? text.slice(1) : text
  expect(body.endsWith('\r\n')).toBe(true)
  const res = Papa.parse<string[]>(body.slice(0, -2), { delimiter, newline: '\r\n', header: false })
  expect(res.errors).toEqual([])
  return res.data
}

function meta(id: string, name: string, unit: string | null, source: ColumnMeta['source'], kind = 'numeric') {
  return {
    id: id as ColumnId,
    source,
    name,
    unit,
    unitSource: unit ? 'header' : null,
    role: 'measurement',
    uncertaintyOf: null,
    detected: { kind, decimal: 'dot', percent: 'display', confidence: 'high', explanations: [] },
    override: {},
  } as ColumnMeta
}

describe('toCsv', () => {
  const tricky = [
    ['plain', 'with,comma', 'with;semicolon', 'tab\there'],
    ['say "hi"', 'line1\nline2', 'cr\rcr', 'crlf\r\nx'],
    ['', ' padded ', 'ünïcødé Ω µ °C', '"'],
  ]

  it('quotes fields with the delimiter, quotes, CR or LF and doubles quotes (RFC 4180)', () => {
    expect(toCsv([['a', 'b,c', 'say "hi"', 'x\ny']], CSV_PRESETS.standard)).toBe(
      'a,"b,c","say ""hi""","x\ny"\r\n',
    )
    expect(toCsv([['a;b', 'c,d']], CSV_PRESETS.excelItalian)).toBe(BOM + '"a;b";c,d\r\n')
    expect(
      toCsv(
        [
          ['a', 'b'],
          ['c', 'd'],
        ],
        { delimiter: '\t', decimal: '.', bom: false },
      ),
    ).toBe('a\tb\r\nc\td\r\n')
    expect(toCsv([], CSV_PRESETS.standard)).toBe('')
  })

  it('reads back identically with an independent parser, for every delimiter', () => {
    const delimiters: CsvOptions['delimiter'][] = [',', ';', '\t']
    for (const delimiter of delimiters) {
      const text = toCsv(tricky, { delimiter, decimal: '.', bom: false })
      expect(parse(text, delimiter)).toEqual(tricky)
    }
  })

  it('guards cells that a spreadsheet would evaluate as formulas', () => {
    const guarded = [
      '=SUM(A1)',
      '=1+1',
      '@SUM(A1)',
      "+cmd|' /C calc'!A0",
      "-cmd|' /C calc'!A0",
      "-1+cmd|' /C calc'!A0",
      '-2+3',
      '-A1',
      '- 3',
      // a number followed by an operator, a call or a reference chain is still a formula
      '-5%/A1',
      '-1 SUM(A1)',
      '-1 m+A1',
      '-2 A1|B1',
      '-1e5+A1',
      '-3 m/s!A1',
      '\t=1',
      '\r=1',
      ' =1',
      FULLWIDTH_EQUALS + '1+1',
    ]
    for (const s of guarded) expect(guardFormula(s), JSON.stringify(s)).toBe("'" + s)
    expect(toCsv([['=SUM(A1,B1)']], CSV_PRESETS.standard)).toBe('"\'=SUM(A1,B1)"\r\n')
  })

  it('leaves numbers, signed numbers with units and ordinary text intact', () => {
    const intact = [
      '-3.2',
      '-3,2',
      '-1.5e-7',
      '-1,5E-3',
      '+7',
      '+1e5',
      '-.5',
      '-0.5%',
      '-3,2 °C',
      '-12 mV',
      '-1 234,5',
      // units with spaces after an exponent, '/', superscripts, '·', '⁻', '-'
      '-9.81 m/s²',
      '-1.6e-19 C',
      '-9.81 m/s',
      '-3 kg·m⁻³',
      '-2.5 m s-1',
      '-0.5 % RH',
      '-',
      '+',
      '3-2',
      'e=mc2',
      'a+b',
      '',
      'NA',
      '#N/A',
    ]
    for (const s of intact) expect(guardFormula(s), JSON.stringify(s)).toBe(s)
    expect(toCsv([['-3.2', '-1e-7']], CSV_PRESETS.standard)).toBe('-3.2,-1e-7\r\n')
  })
})

describe('CSV_PRESETS', () => {
  it('standard = "," "." without BOM; excelItalian = ";" "," with a UTF-8 BOM', () => {
    expect(CSV_PRESETS.standard).toEqual({ delimiter: ',', decimal: '.', bom: false })
    expect(CSV_PRESETS.excelItalian).toEqual({ delimiter: ';', decimal: ',', bom: true })
    expect(toCsv([['x']], CSV_PRESETS.excelItalian).charCodeAt(0)).toBe(0xfeff)
    expect(Object.isFrozen(CSV_PRESETS.excelItalian)).toBe(true)
  })
})

describe('csvNumber', () => {
  const values = [
    0,
    -0,
    0.1 + 0.2,
    1 / 3,
    -2 / 3,
    Math.PI,
    Math.PI * 1e21,
    123456789.12345679,
    2 ** 53 + 2,
    5e-324,
    -1e-310,
    2.2250738585072014e-308,
    1.7976931348623157e308,
    -2.5e-7,
    47.14727272727273,
    9.85869828701,
  ]

  it('writes the shortest text that reads back as exactly the same double', () => {
    for (const v of values) {
      expect(Number(csvNumber(v, '.')), String(v)).toBe(v === 0 ? 0 : v)
      const comma = csvNumber(v, ',')
      expect(comma.includes('.')).toBe(false)
      expect(Number(comma.replace(',', '.'))).toBe(v === 0 ? 0 : v)
    }
    expect(csvNumber(0.1 + 0.2, '.')).toBe('0.30000000000000004')
    expect(csvNumber(-3.2, ',')).toBe('-3,2')
    expect(csvNumber(1.5e21, ',')).toBe('1,5e+21')
  })

  it('writes nothing for NaN and infinities (never 0)', () => {
    for (const v of [NaN, Infinity, -Infinity]) {
      expect(csvNumber(v, '.')).toBe('')
      expect(csvNumber(v, ',')).toBe('')
    }
  })
})

/** A CSV text through the real importer, as an imported dataset and its raw table. */
function imported(text: string, fileName: string): { dataset: ImportedDataset; raw: RawTable } {
  const r = importText(text, { kind: 'csv', fileName })
  if (!r.ok) throw new Error(`import failed: ${r.error.code}`)
  const d = r.value
  return {
    raw: d.rawTable,
    dataset: {
      id: 'ds_imp01' as DatasetId,
      name: d.suggestedName,
      createdAt: '2026-10-01T10:00:00.000Z',
      example: null,
      origin: 'import',
      rawTableId: d.rawTable.id,
      layout: d.layout,
      notes: d.notes,
      columns: d.columns,
    },
  }
}

// ── original export ──────────────────────────────────────────────────────────────────────────────

function coolingRaw(): RawTable {
  const grid = [
    ['Experiment: cooling, 2026-10-01', '', '', ''],
    ['t', 'T', 'note', 'operator'],
    ['min', '°C', '', ''],
    ['0', '85,2', 'start', 'Ann'],
    ['2', '-3.2', '=SUM(A1)', 'Bob'],
    ['', '', '', ''],
    ['4', '75,6', 'said "ok", then left', 'Cy'],
    ['6', '71,7', 'line1\nline2', 'Dee'],
  ]
  return {
    id: 'raw_cool01' as RawTableId,
    source: {
      kind: 'csv',
      fileName: 'cooling.csv',
      sheetName: null,
      encoding: 'utf-8',
      delimiter: ';',
      byteSize: 200,
      importedAt: '2026-10-01T10:00:00.000Z',
    },
    rowCount: grid.length,
    sourceRow: Int32Array.from([1, 2, 3, 4, 5, 6, 7, 8]),
    columns: [0, 1, 2, 3].map((j) => ({ text: grid.map((r) => r[j]), native: null })),
    tokenIssues: [],
  }
}

function coolingDataset(): ImportedDataset {
  return {
    id: 'ds_cool01' as DatasetId,
    name: 'cooling',
    createdAt: '2026-10-01T10:00:00.000Z',
    example: null,
    origin: 'import',
    rawTableId: 'raw_cool01' as RawTableId,
    layout: { headerRow: 1, unitsRow: 2, dataStartRow: 3, dataEndRow: 7 },
    notes: ['Experiment: cooling, 2026-10-01'],
    columns: [
      meta('col_t', 'time', 'min', { type: 'raw', index: 0 }), // renamed by the user
      meta('col_T', 'T', '°C', { type: 'raw', index: 1 }),
      meta('col_note', 'note', null, { type: 'raw', index: 2 }, 'text'),
      // raw column 3 ("operator") was removed by the user
      meta('col_TK', 'T', 'K', {
        type: 'derived',
        spec: { op: 'affine', input: 'col_T' as ColumnId, a: 1, b: 273.15 },
      }),
    ],
  }
}

describe('originalCsv', () => {
  it('writes header, units row and data rows exactly as imported', () => {
    expect(originalCsv(coolingDataset(), coolingRaw(), CSV_PRESETS.standard)).toBe(
      [
        't,T,note',
        'min,°C,',
        '0,"85,2",start',
        "2,-3.2,'=SUM(A1)",
        ',,',
        '4,"75,6","said ""ok"", then left"',
        '6,"71,7","line1\nline2"',
        '',
      ].join('\r\n'),
    )
  })

  it('writes numbers with the decimal mark of the preset; header, units, text and conflicts as recorded', () => {
    const text = originalCsv(coolingDataset(), coolingRaw(), CSV_PRESETS.excelItalian)
    expect(text.startsWith(BOM + 't;T;note\r\nmin;°C;\r\n0;85,2;start\r\n2;-3,2;')).toBe(true)
    const rows = parse(text, ';')
    // T is read with '.' as decimal: "-3.2" becomes "-3,2"; the ','-only cells conflict with the
    // column's convention (not read as numbers) and are written exactly as they were recorded.
    expect(rows.map((r) => r[1])).toEqual(['T', '°C', '85,2', '-3,2', '', '75,6', '71,7'])
    expect(rows.map((r) => r[2])).toEqual([
      'note',
      '',
      'start',
      "'=SUM(A1)",
      '',
      'said "ok", then left',
      'line1\nline2',
    ])
  })

  it("the Italian Excel preset never writes '.' decimals: every example re-imports to the same values", () => {
    for (const file of ['ohm.csv', 'freeFall.csv', 'cooling.csv', 'beerLambert.csv', 'pendulum.csv']) {
      const source = readFileSync(resolve('src/examples', file), 'utf8')
      const before = imported(source, file)
      const text = originalCsv(before.dataset, before.raw, CSV_PRESETS.excelItalian)
      const body = parse(text, ';').slice(1)
      // Italian-locale Excel reads '.' as a thousands separator ("0.464" → 464): no number keeps one.
      for (const row of body)
        for (const cell of row) expect(/\d\.\d/.test(cell), `${file}: ${cell}`).toBe(false)
      const after = imported(text.slice(1), file)
      expect(after.dataset.columns.map((c) => [c.name, c.unit])).toEqual(
        before.dataset.columns.map((c) => [c.name, c.unit]),
      )
      const v0 = buildDatasetView(before.dataset, before.raw)
      const v1 = buildDatasetView(after.dataset, after.raw)
      before.dataset.columns.forEach((c, j) => {
        const a = v0.columns.get(c.id)!
        const b = v1.columns.get(after.dataset.columns[j].id)!
        expect(Array.from(b.status), `${file}: ${c.name}`).toEqual(Array.from(a.status))
        expect(Array.from(b.values), `${file}: ${c.name}`).toEqual(Array.from(a.values))
      })
    }
  })

  it("a ','-decimal file exported as standard CSV gets '.' decimals (never quoted text)", () => {
    const { dataset, raw } = imported('t (s);x (m)\n1;0,5\n2;1,25\n3;−2,75\n4;NA\n', 'comma.csv')
    expect(originalCsv(dataset, raw, CSV_PRESETS.standard)).toBe(
      't (s),x (m)\r\n1,0.5\r\n2,1.25\r\n3,−2.75\r\n4,NA\r\n',
    )
    expect(originalCsv(dataset, raw, CSV_PRESETS.excelItalian)).toBe(
      BOM + 't (s);x (m)\r\n1;0,5\r\n2;1,25\r\n3;−2,75\r\n4;NA\r\n',
    )
  })

  it('negative values with unit tails are exported unguarded and re-import as numbers', () => {
    const { dataset, raw } = imported('t (s),a\n0,-9.81 m/s²\n1,-9.80 m/s²\n2,-9.82 m/s²\n', 'g.csv')
    expect(dataset.columns[1]).toMatchObject({ unit: 'm/s²', detected: { kind: 'numeric' } })
    const text = originalCsv(dataset, raw, CSV_PRESETS.standard)
    expect(text).toBe('t (s),a\r\n0,-9.81 m/s²\r\n1,-9.80 m/s²\r\n2,-9.82 m/s²\r\n')
    const again = imported(text, 'g.csv')
    expect(again.dataset.columns[1]).toMatchObject({ unit: 'm/s²', detected: { kind: 'numeric' } })
  })

  it('uses the generated column names when the file has no header row', () => {
    const ds = coolingDataset()
    ds.layout = { headerRow: null, unitsRow: null, dataStartRow: 3, dataEndRow: 4 }
    expect(parse(originalCsv(ds, coolingRaw(), CSV_PRESETS.standard), ',')).toEqual([
      ['time (min)', 'T (°C)', 'note'],
      ['0', '85,2', 'start'],
      ['2', '-3.2', "'=SUM(A1)"],
    ])
  })

  it('writes only the header when the raw table is not available', () => {
    expect(originalCsv(coolingDataset(), null, CSV_PRESETS.standard)).toBe('time (min),T (°C),note\r\n')
  })

  it('writes the typed text of a notebook dataset', () => {
    const nb: NotebookDataset = {
      id: 'ds_nb01' as DatasetId,
      name: 'spring',
      createdAt: '2026-10-01T10:00:00.000Z',
      example: null,
      origin: 'notebook',
      notes: [],
      columns: [
        meta('col_m', 'm', 'kg', { type: 'notebook' }),
        meta('col_x', 'x', 'cm', { type: 'notebook' }),
        meta('col_k', 'k', null, {
          type: 'derived',
          spec: { op: 'ratio', left: 'col_m' as ColumnId, right: 'col_x' as ColumnId },
        }),
      ],
      rowIds: [0, 1, 3] as RowId[],
      cells: { col_m: ['0.050', '0,100', ''], col_x: ['2.1', '-4.0', 'NA'] },
      nextRowId: 4,
    }
    expect(originalCsv(nb, null, CSV_PRESETS.standard)).toBe(
      'm (kg),x (cm)\r\n0.050,2.1\r\n"0,100",-4.0\r\n,NA\r\n',
    )
  })
})

describe('cellInDecimal', () => {
  it("exchanges only the mantissa's separators of cells the column reads as numbers", () => {
    const cases: [string, 'dot' | 'comma' | 'mixed', '.' | ',', string][] = [
      ['0.464', 'dot', ',', '0,464'],
      ['1,234.5', 'dot', ',', '1.234,5'],
      ['1,234', 'dot', ',', '1.234'], // grouping in a '.' column (1234) stays grouping (1234)
      ['12.345', 'dot', ',', '12,345'],
      ['3.0e+08 m/s', 'dot', ',', '3,0e+08 m/s'],
      ['12.5%', 'dot', ',', '12,5%'],
      ['12.5 a.u.', 'dot', ',', '12,5 a.u.'], // the unit keeps its dots
      ["1'234.5", 'dot', ',', "1'234,5"],
      ['−3,2', 'comma', '.', '−3.2'],
      [' 1 234,5 ', 'comma', '.', ' 1 234.5 '],
      ['0,5', 'mixed', '.', '0.5'],
      ['0.5', 'mixed', '.', '0.5'],
      ['0.464', 'dot', '.', '0.464'], // same convention: verbatim
      ['12', 'dot', ',', '12'],
      ['NA', 'dot', ',', 'NA'], // missing token
      ['-', 'dot', ',', '-'],
      ['0,5', 'dot', ',', '0,5'], // conflicts with the column: written as recorded
      ['1,234', 'mixed', '.', '1,234'], // ambiguous in a mixed column: not read, not changed
      ['abc 1.5', 'dot', ',', 'abc 1.5'],
      ['#DIV/0!', 'dot', ',', '#DIV/0!'],
    ]
    for (const [text, mode, decimal, out] of cases)
      expect(cellInDecimal(text, mode, decimal), `${text} ${mode} → ${decimal}`).toBe(out)
  })

  it('keeps the value: the converted text reads back identically under the other convention', () => {
    const cells = ['0.464', '-1.5e-3', '1,234.5', '1,234', '12.345', '1,234,567.25', '+7.0', '6.022e23 mol']
    for (const text of cells) {
      const v = parseNumber(text, 'dot')
      const back = parseNumber(cellInDecimal(text, 'dot', ','), 'comma')
      expect(back.status, text).toBe(CELL.ok)
      expect(back.value, text).toBe(v.value)
    }
  })
})

// ── analysis export ──────────────────────────────────────────────────────────────────────────────

function numeric(id: string, values: number[], status: number[]): ParsedColumn {
  return {
    columnId: id as ColumnId,
    settings: { kind: 'numeric', decimal: 'dot', percent: 'display' },
    values: Float64Array.from(values),
    status: Uint8Array.from(status),
    categories: null,
    text: values.map(String),
    report: {
      nRows: values.length,
      nValid: 0,
      nMissing: 0,
      nSheetError: 0,
      nInvalid: 0,
      invalidExamples: [],
      missingTokens: [],
    },
  }
}

function view(columns: ParsedColumn[], rowIds: number[], sourceRow: number[]): DatasetView {
  return {
    datasetId: 'ds_ohm' as DatasetId,
    rowIds: Int32Array.from(rowIds),
    rowIndex: new Map(rowIds.map((r, i) => [r, i])),
    blankRows: new Int32Array(0),
    sourceRow: Int32Array.from(sourceRow),
    recordAxis: 'row',
    columns: new Map(columns.map((c) => [c.columnId, c])),
    columnOrder: columns.map((c) => c.columnId),
  }
}

function sample(rowIds: number[], reasons: number[]): AnalysisSample {
  const counts = { missing: 0, invalid: 0, excluded: 0, filtered: 0 }
  return {
    rowIds: Int32Array.from(rowIds),
    reason: Uint8Array.from(reasons),
    nTotal: rowIds.length,
    nActive: reasons.filter((r) => r === INACTIVE.active).length,
    counts,
  }
}

describe('analysisCsv', () => {
  const { ok, missing, invalid } = CELL
  const N = NaN
  // Grid rows 2..7 shown as lines 3..9 (line 8 was blank). Row 4: I missing; row 5: V invalid; row 6 excluded.
  const I = numeric('col_I', [0.01, 0.02, N, 0.04, 0.05, 0.06], [ok, ok, missing, ok, ok, ok])
  const V = numeric('col_V', [0.464, 0.941, 1.402, N, 2.339, 2.808], [ok, ok, ok, invalid, ok, ok])
  const rowIds = [2, 3, 4, 5, 6, 7]
  const v = view([I, V], rowIds, [3, 4, 5, 6, 7, 9])
  const { active, excluded } = INACTIVE
  const s = sample(rowIds, [active, active, INACTIVE.missing, INACTIVE.invalid, excluded, active])
  const columns = [
    meta('col_I', 'I', 'A', { type: 'raw', index: 0 }),
    meta('col_V', 'V', 'V', { type: 'raw', index: 1 }),
  ]
  const fit = {
    status: 'ok',
    r2Of: 'y',
    residuals: Float64Array.from([0.0015272727272727, -0.0070545454545455, 0.0026909090909091]),
    provenance: { rowIdsUsed: [2, 3, 7] as RowId[] },
  } as unknown as FitOk
  const predict = (x: number) => -0.009 + 47.14727272727273 * x

  it('writes row numbers, parsed values, status and the fit columns', () => {
    const rows = analysisRows(
      { view: v, columns, sample: s, fit, fitXColumn: 'col_I' as ColumnId, predict },
      '.',
    )
    expect(rows[0]).toEqual(['row', 'I (A)', 'V (V)', 'status', 'in_fit', 'predicted', 'residual'])
    const p = (x: number) => String(predict(x))
    expect(rows.slice(1)).toEqual([
      ['3', '0.01', '0.464', 'active', '1', p(0.01), '0.0015272727272727'],
      ['4', '0.02', '0.941', 'active', '1', p(0.02), '-0.0070545454545455'],
      ['5', '', '1.402', 'missing', '0', '', ''], // no x: no prediction; missing is "", never 0
      ['6', '0.04', '', 'invalid', '0', p(0.04), ''],
      ['7', '0.05', '2.339', 'excluded', '0', p(0.05), ''], // excluded rows keep their prediction
      ['9', '0.06', '2.808', 'active', '1', p(0.06), '0.0026909090909091'],
    ])
  })

  it('round-trips every value at full precision, with "." or ","', () => {
    for (const preset of [CSV_PRESETS.standard, CSV_PRESETS.excelItalian]) {
      const text = analysisCsv(
        { view: v, columns, sample: s, fit, fitXColumn: 'col_I' as ColumnId, predict },
        preset,
      )
      const rows = parse(text, preset.delimiter).slice(1)
      const num = (cell: string) => Number(preset.decimal === ',' ? cell.replace(',', '.') : cell)
      rows.forEach((r, i) => {
        if (I.status[i] === ok) expect(num(r[1])).toBe(I.values[i])
        if (V.status[i] === ok) expect(num(r[2])).toBe(V.values[i])
        if (r[5] !== '') expect(num(r[5])).toBe(predict(I.values[i]))
      })
      expect(num(rows[5][6])).toBe(fit.residuals[2])
    }
    const italian = analysisCsv({ view: v, columns, sample: s }, CSV_PRESETS.excelItalian)
    expect(italian.startsWith(BOM + 'row;I (A);V (V);status\r\n3;0,01;0,464;active\r\n')).toBe(true)
  })

  it('a block transposed on import: a "column" field with the sheet column letters', () => {
    const transposed: DatasetView = { ...v, recordAxis: 'column' }
    const rows = analysisRows({ view: transposed, columns, sample: s }, '.')
    expect(rows[0]).toEqual(['column', 'I (A)', 'V (V)', 'status'])
    expect(rows.slice(1).map((r) => r[0])).toEqual(['C', 'D', 'E', 'F', 'G', 'I'])
    expect(rows[1]).toEqual(['C', '0.01', '0.464', 'active'])
  })

  it('omits the fit columns without a fit, and predicted without predict()', () => {
    expect(analysisRows({ view: v, columns, sample: s }, '.')[0]).toEqual(['row', 'I (A)', 'V (V)', 'status'])
    const rows = analysisRows({ view: v, columns, sample: s, fit }, '.')
    expect(rows[0]).toEqual(['row', 'I (A)', 'V (V)', 'status', 'in_fit', 'residual'])
    expect(rows[5]).toEqual(['7', '0.05', '2.339', 'excluded', '0', ''])
  })

  it('labels ln-space residuals of log-linear fits as residual_ln', () => {
    const logFit = { ...fit, r2Of: 'lnY' } as FitOk
    const rows = analysisRows({ view: v, columns, sample: s, fit: logFit }, '.')
    expect(rows[0].at(-1)).toBe('residual_ln')
  })

  it('writes categories as labels and datetimes as ISO 8601 (UTC)', () => {
    const cat: ParsedColumn = {
      ...numeric('col_obs', [N, N, N], [ok, missing, ok]),
      settings: { kind: 'categorical', decimal: 'dot', percent: 'display' },
      categories: { codes: Int32Array.from([1, -1, 0]), labels: ['A', 'B, second'] },
    }
    const when: ParsedColumn = {
      ...numeric('col_when', [Date.UTC(2026, 9, 2, 9, 14, 5, 120), N, 0], [ok, missing, ok]),
      settings: { kind: 'datetime', decimal: 'dot', percent: 'display' },
    }
    const cols = [
      meta('col_obs', 'observer', null, { type: 'raw', index: 0 }, 'categorical'),
      meta('col_when', 'when', null, { type: 'raw', index: 1 }, 'datetime'),
    ]
    const text = analysisCsv(
      { view: view([cat, when], [0, 1, 2], [2, 3, 4]), columns: cols, sample: sample([0, 1, 2], [0, 1, 0]) },
      CSV_PRESETS.standard,
    )
    expect(text).toBe(
      'row,observer,when,status\r\n' +
        '2,"B, second",2026-10-02T09:14:05.120Z,active\r\n' +
        '3,,,missing\r\n' +
        '4,A,1970-01-01T00:00:00.000Z,active\r\n',
    )
  })

  it('exports a column absent from the view as empty cells', () => {
    const extra = [...columns, meta('col_gone', 'gone', null, { type: 'raw', index: 5 })]
    const rows = analysisRows({ view: v, columns: extra, sample: s }, '.')
    expect(rows.slice(1).every((r) => r[3] === '')).toBe(true)
  })
})
