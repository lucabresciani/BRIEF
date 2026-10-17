import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { NATIVE, type ColumnId, type Issue, type ReasonCode, type Result } from '@/domain/model'
import { inferColumn } from './columnInfer'
import {
  percentFormat,
  readWorkbook,
  serialToEpochMs,
  timeFormatKind,
  type WorkbookGrid,
} from './spreadsheet'

const fixture = (name: string) => new Uint8Array(readFileSync(resolve('tests/fixtures/import', name)))
const read = (bytes: Uint8Array, opts: { sheetName?: string; maxCells?: number } = {}) =>
  readWorkbook(XLSX, bytes, { maxCells: 2_000_000, ...opts })
function value(r: Result<WorkbookGrid>): WorkbookGrid {
  if (!r.ok) throw new Error(`expected ok, got ${r.error.code} ${JSON.stringify(r.error.params)}`)
  return r.value
}
function errorOf(r: Result<WorkbookGrid>) {
  if (r.ok) throw new Error('expected an error result')
  return r.error
}
const find = (issues: readonly Issue[], code: ReasonCode) => issues.find((i) => i.code === code)
const column = (g: WorkbookGrid, j: number) => ({
  text: g.grid.map((row) => row[j]),
  kind: Array.from(g.native[j].kind),
  num: Array.from(g.native[j].num),
})
const toBytes = (wb: XLSX.WorkBook, bookType: XLSX.BookType = 'xlsx') =>
  new Uint8Array(XLSX.write(wb, { type: 'array', bookType }) as ArrayBuffer)
function book(sheets: Record<string, XLSX.WorkSheet>): XLSX.WorkBook {
  const wb = XLSX.utils.book_new()
  for (const [name, ws] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, ws, name)
  return wb
}
const N = NATIVE

describe('readWorkbook — files saved by LibreOffice (xlsx and ods from the same CSV)', () => {
  for (const file of ['libreoffice-saved.xlsx', 'libreoffice-saved.ods']) {
    describe(file, () => {
      const g = value(read(fixture(file)))

      it('lists the sheet and keeps the header row', () => {
        expect(g.sheetName).toBe('libreoffice-saved')
        expect(g.sheets).toEqual([{ name: 'libreoffice-saved', rows: 5, cols: 6, hidden: false }])
        expect(g.grid[0]).toEqual(['Time (s)', 'Voltage (V)', 'Efficiency', 'Date', 'Note', 'Ratio'])
        expect(Array.from(g.sourceRow)).toEqual([1, 2, 3, 4, 5])
        expect(g.issues).toEqual([])
      })

      it('numbers come from v, not from the formatted text', () => {
        const v = column(g, 1)
        expect(v.kind.slice(1)).toEqual([N.number, N.number, N.number, N.number])
        expect(v.num.slice(1)).toEqual([1.23456789012345, -0.003, 0.000015, 0.1])
        expect(v.text[3]).toBe('1.50E-05') // display text kept for the table only
      })

      it('percent cells keep the stored fraction and the shown text', () => {
        const e = column(g, 2)
        expect(e.kind.slice(1)).toEqual([N.number, N.number, N.number, N.number])
        expect(e.num.slice(1)).toEqual([0.12, 0.075, 1, 0.005])
        expect(e.text.slice(1)).toEqual(['12.00%', '7.50%', '100.00%', '0.50%'])
      })

      it('dates → epoch ms UTC', () => {
        const d = column(g, 3)
        expect(d.kind.slice(1)).toEqual([N.date, N.date, N.date, N.date])
        expect(d.num.slice(1)).toEqual([15, 16, 17, 18].map((day) => Date.UTC(2024, 2, day)))
      })

      it('text, empty cells and error cells are told apart; nothing becomes 0', () => {
        const note = column(g, 4)
        expect(note.text.slice(1)).toEqual(['ok', 'NA', '', 'repeat'])
        expect(note.kind.slice(1)).toEqual([N.text, N.text, N.empty, N.text])
        expect(Number.isNaN(note.num[3])).toBe(true)
        const ratio = column(g, 5)
        expect(ratio.kind[1]).toBe(N.error)
        expect(ratio.text[1]).toBe('#DIV/0!')
        expect(Number.isNaN(ratio.num[1])).toBe(true)
        expect(ratio.num.slice(2)).toEqual([0.5, 0.00003, 2.5]) // cached formula results
      })
    })
  }

  it('xlsx and ods give identical native values', () => {
    const a = value(read(fixture('libreoffice-saved.xlsx')))
    const b = value(read(fixture('libreoffice-saved.ods')))
    for (let j = 0; j < 6; j++) {
      expect(Array.from(b.native[j].kind), `col ${j}`).toEqual(Array.from(a.native[j].kind))
      expect(Array.from(b.native[j].num), `col ${j}`).toEqual(Array.from(a.native[j].num))
    }
  })
})

describe('readWorkbook — file saved by Excel', () => {
  const bytes = fixture('excel-saved.xlsx')

  it('lists every sheet and picks the first visible one with ≥ 2 numeric columns', () => {
    const g = value(read(bytes))
    expect(g.sheets.map((s) => s.name)).toEqual(['Notes', 'Measurements'])
    expect(g.sheetName).toBe('Measurements')
  })

  it('reads v even when the format rounds the display ("0.00" shows -0.003 as 0.00)', () => {
    const v = column(value(read(bytes)), 1)
    expect(v.text.slice(1)).toEqual(['1.23', '0.00', '0.00', '0.10'])
    expect(v.num.slice(1)).toEqual([1.23456789012345, -0.003, 0.000015, 0.1])
  })

  it('Excel percent format, dates from formulas, and error values', () => {
    const g = value(read(bytes))
    expect(column(g, 2).num.slice(1)).toEqual([0.12, 0.075, 1, 0.005])
    expect(column(g, 2).text.slice(1)).toEqual(['12%', '8%', '100%', '1%'])
    expect(column(g, 3).num.slice(1)).toEqual([15, 16, 17, 18].map((d) => Date.UTC(2024, 2, d)))
    const dbl = column(g, 5)
    expect(dbl.kind.slice(1)).toEqual([N.error, N.number, N.number, N.error])
    expect([dbl.text[1], dbl.text[4]]).toEqual(['#DIV/0!', '#N/A'])
    expect(dbl.num.slice(2, 4)).toEqual([1, 0.00003])
  })

  it('an explicit sheet name is honoured; an unknown one is reported, not guessed', () => {
    expect(value(read(bytes, { sheetName: 'Notes' })).grid).toEqual([
      ['Lab notebook'],
      ['Measured on bench 3'],
    ])
    expect(errorOf(read(bytes, { sheetName: 'Nope' }))).toMatchObject({
      code: 'E_SHEET_EMPTY',
      params: { sheet: 'Nope' },
    })
  })

  it('feeds columnInfer: native kinds decide numeric / percent / datetime / sheet errors', () => {
    const g = value(read(bytes))
    const infer = (j: number) => {
      const c = column(g, j)
      const rows = g.grid.length - 1
      return inferColumn(
        c.text.slice(1),
        Array.from({ length: rows }, (_, i) => i + 1),
        {
          columnId: `c${j}` as ColumnId,
          delimiter: null,
          native: { kind: g.native[j].kind.slice(1), num: g.native[j].num.slice(1) },
        },
      )
    }
    expect(infer(1).detection).toMatchObject({ kind: 'numeric', confidence: 'high' })
    expect(find(infer(2).issues, 'I_PERCENT')?.params).toMatchObject({ count: 4 })
    expect(infer(3).detection.kind).toBe('datetime')
    expect(find(infer(5).issues, 'I_SHEET_ERRORS')?.params).toMatchObject({ count: 2, example: '#DIV/0!' })
    // The Note column is categorical: only its empty cell is missing, 'NA' is one of its labels.
    expect(infer(4).detection.kind).toBe('categorical')
    expect(find(infer(4).issues, 'I_MISSING_VALUES')?.params).toMatchObject({ count: 1 })
  })
})

describe('readWorkbook — Excel 97–2003 workbook (.xls, BIFF8) saved by Excel', () => {
  const g = value(read(fixture('biff8-tables.xls')))

  it('lists the sheet and reads accented, Greek and micro signs', () => {
    expect(g.sheets).toEqual([{ name: 'Misure', rows: 6, cols: 9, hidden: false }])
    expect(g.grid[0]!.slice(0, 6)).toEqual([
      'Tempo (s)',
      'Tensione (µV)',
      'Resistenza (Ω)',
      'Data',
      'Efficienza',
      'Nota',
    ])
    expect(column(g, 5).text.slice(1, 5)).toEqual(['è ok', 'µ-test', '', 'Ω alto'])
    expect(g.grid[0]![7]).toBe('Pressione è')
  })

  it('numbers from v, dates → epoch ms UTC, percent cells keep the fraction', () => {
    expect(column(g, 1).num.slice(1, 5)).toEqual([1.25, 2.5, 3.75, 5])
    expect(column(g, 3).kind.slice(1, 5)).toEqual([N.date, N.date, N.date, N.date])
    expect(column(g, 3).num.slice(1, 5)).toEqual([15, 16, 17, 18].map((d) => Date.UTC(2024, 2, d)))
    expect(column(g, 4).num.slice(1, 5)).toEqual([0.12, 0.075, 1, 0.005])
    expect(column(g, 4).text.slice(1, 5)).toEqual(['12.0%', '7.5%', '100.0%', '0.5%'])
  })

  it('merged cells are read from the BIFF records', () => {
    expect(g.merges).toEqual([
      { r0: 0, c0: 7, r1: 0, c1: 8 },
      { r0: 4, c0: 8, r1: 5, c1: 8 },
    ])
    expect(g.origin).toEqual({ row: 0, col: 0 })
  })
})

describe('readWorkbook — where the grid sits in the sheet, and its merged areas', () => {
  it('origin: the sheet row and column of grid[0][0]', () => {
    expect(value(read(fixture('data-from-A3.xlsx'))).origin).toEqual({ row: 2, col: 0 })
    const ws = XLSX.utils.aoa_to_sheet([
      [null, null, null],
      [null, 'x', 'y'],
      [null, 1, 2],
    ])
    ws['!ref'] = 'A1:E10'
    expect(value(read(toBytes(book({ S: ws })))).origin).toEqual({ row: 1, col: 1 })
  })

  it('merges relative to the grid, clipped to it, with or without propagation', () => {
    const shown = value(read(fixture('merged-header.xlsx')))
    expect(shown.merges).toEqual([
      { r0: 0, c0: 0, r1: 0, c1: 1 },
      { r0: 4, c0: 2, r1: 5, c1: 2 },
    ])
    expect(shown.grid[0]).toEqual(['Temperature', 'Temperature', 'Pressure'])
    const raw = value(
      readWorkbook(XLSX, fixture('merged-header.xlsx'), { maxCells: 1000, propagateMerges: false }),
    )
    expect(raw.merges).toEqual(shown.merges)
    expect(raw.grid[0]).toEqual(['Temperature', '', 'Pressure'])
    expect(raw.native[1].kind[0]).toBe(N.empty)
    expect(find(raw.issues, 'W_MERGED_CELLS')).toBeUndefined()
    const ws = XLSX.utils.aoa_to_sheet([
      [null, null],
      [null, 'x', 'y'],
      [null, 1, 2],
    ])
    ws['!merges'] = [XLSX.utils.decode_range('A1:C1'), XLSX.utils.decode_range('B2:D2')]
    expect(value(read(toBytes(book({ S: ws })))).merges).toEqual([{ r0: 0, c0: 0, r1: 0, c1: 1 }])
  })

  it('a header merged over a column that is empty below is not copied into it', () => {
    // "Group" spans A:B in the header and in every row: column B is part of one merged quantity.
    const ws = XLSX.utils.aoa_to_sheet([
      ['Group', null, 'x'],
      ['a (m)', null, 'b (s)'],
      [1, null, 2],
      [3, null, 4],
    ])
    ws['!merges'] = ['A1:B1', 'A2:B2', 'A3:B3', 'A4:B4'].map((r) => XLSX.utils.decode_range(r))
    const g = value(read(toBytes(book({ S: ws }))))
    expect(g.grid[0]).toEqual(['Group', '', 'x'])
    expect(g.grid[1]).toEqual(['a (m)', '', 'b (s)'])
    expect(find(g.issues, 'W_MERGED_CELLS')?.params).toEqual({ count: 2, header: 0, data: 2 })
  })

  it('formula cells without a saved result are listed', () => {
    expect(value(read(fixture('formula-no-cache.xlsx'))).formulaCells).toEqual([
      { row: 1, col: 2 },
      { row: 2, col: 2 },
    ])
  })
})

describe('readWorkbook — dates', () => {
  it('honours the 1904 date system (file saved by Excel with Date1904 = true)', () => {
    const g = value(read(fixture('date1904.xlsx')))
    const d = column(g, 0)
    expect(d.kind.slice(1)).toEqual([N.date, N.date, N.date])
    expect(d.num.slice(1)).toEqual([15, 16, 17].map((day) => Date.UTC(2024, 2, day, 12, 30)))
    expect(d.text[1]).toBe('2024-03-15 12:30')
    expect(column(g, 1).num.slice(1)).toEqual([10, 20, 30])
  })

  it('time-only and elapsed formats → ms since midnight / elapsed ms (as the CSV "10:30:00"), not 1899', () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['clock', 'elapsed', 'stamp'],
      [0.4375, 1.0625, 45366.4375],
      [0.5, 0.25, 45366.5],
    ])
    for (const a of ['A2', 'A3']) ws[a].z = 'hh:mm:ss'
    for (const a of ['B2', 'B3']) ws[a].z = '[h]:mm:ss'
    for (const a of ['C2', 'C3']) ws[a].z = 'hh:mm' // a date-time shown as a time keeps its date
    const g = value(read(toBytes(book({ S: ws }))))
    expect(column(g, 0).kind.slice(1)).toEqual([N.date, N.date])
    expect(column(g, 0).num.slice(1)).toEqual([37_800_000, 43_200_000])
    expect(column(g, 1).num.slice(1)).toEqual([91_800_000, 21_600_000]) // 25:30:00 and 6:00:00
    expect(column(g, 2).num.slice(1)).toEqual([Date.UTC(2024, 2, 15, 10, 30), Date.UTC(2024, 2, 15, 12)])
  })

  it('timeFormatKind', () => {
    expect(timeFormatKind('hh:mm:ss')).toBe('time')
    expect(timeFormatKind('h:mm AM/PM')).toBe('time')
    expect(timeFormatKind('mm:ss.0')).toBe('time')
    expect(timeFormatKind('[h]:mm:ss')).toBe('elapsed')
    expect(timeFormatKind('[mm]:ss')).toBe('elapsed')
    expect(timeFormatKind('yyyy-mm-dd hh:mm')).toBe('date')
    expect(timeFormatKind('d/m/yy')).toBe('date')
    expect(timeFormatKind('mmm')).toBe('date')
    expect(timeFormatKind('[$-409]h:mm:ss')).toBe('time')
  })

  it('serialToEpochMs: 1900 system with the Lotus leap-year bug, and the 1904 system', () => {
    expect(serialToEpochMs(1, false)).toBe(Date.UTC(1900, 0, 1))
    expect(serialToEpochMs(59, false)).toBe(Date.UTC(1900, 1, 28))
    expect(serialToEpochMs(61, false)).toBe(Date.UTC(1900, 2, 1))
    expect(serialToEpochMs(25569, false)).toBe(0)
    expect(serialToEpochMs(45366.5, false)).toBe(Date.UTC(2024, 2, 15, 12))
    expect(serialToEpochMs(0, true)).toBe(Date.UTC(1904, 0, 1))
    expect(serialToEpochMs(43904.520833333336, true)).toBe(Date.UTC(2024, 2, 15, 12, 30))
  })
})

describe('readWorkbook — layout of the sheet', () => {
  it('merged header propagated to the right; data-area merge left empty (no fill-down)', () => {
    const g = value(read(fixture('merged-header.xlsx')))
    expect(g.grid[0]).toEqual(['Temperature', 'Temperature', 'Pressure'])
    expect(g.native[1].kind[0]).toBe(N.text)
    expect(g.grid[1]).toEqual(['T1 (°C)', 'T2 (°C)', 'p (kPa)'])
    expect(g.grid[4][2]).toBe('100.9')
    expect(g.grid[5][2]).toBe('')
    expect(g.native[2].kind[5]).toBe(N.empty)
    expect(Number.isNaN(g.native[2].num[5])).toBe(true)
    const w = find(g.issues, 'W_MERGED_CELLS')
    expect(w?.params).toEqual({ count: 2, header: 1, data: 1 })
    expect(w?.rows).toEqual([0, 4, 5])
  })

  it('data starting at A3 → sourceRow is the sheet row (3, 4, …)', () => {
    const g = value(read(fixture('data-from-A3.xlsx')))
    expect(Array.from(g.sourceRow)).toEqual([3, 4, 5, 6])
    expect(g.grid[0]).toEqual(['I (A)', 'V (V)'])
    expect(column(g, 1).num.slice(1)).toEqual([0.464, 0.941, 1.402])
    expect(find(g.issues, 'I_TRIMMED_EMPTY')).toBeUndefined()
  })

  it('empty edge rows and columns inside the declared range are trimmed and reported', () => {
    const ws = XLSX.utils.aoa_to_sheet([
      [null, null, null],
      [null, 'x', 'y'],
      [null, 1, 2],
      [null, 3, 4],
    ])
    ws['!ref'] = 'A1:E10'
    const g = value(read(toBytes(book({ S: ws }))))
    expect(g.grid).toEqual([
      ['x', 'y'],
      ['1', '2'],
      ['3', '4'],
    ])
    expect(Array.from(g.sourceRow)).toEqual([2, 3, 4])
    expect(find(g.issues, 'I_TRIMMED_EMPTY')?.params).toMatchObject({ rows: 7, cols: 3 })
  })

  it('a title merged across the table is not copied into every column (and not reported)', () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Experiment 3: cooling', null, null, null],
      ['t (s)', 'T1 (°C)', 'T2 (°C)', 'T3 (°C)'],
      [0, 80, 81, 79],
      [60, 71, 72, 70],
    ])
    ws['!merges'] = [XLSX.utils.decode_range('A1:D1')]
    const g = value(read(toBytes(book({ S: ws }))))
    expect(g.grid[0]).toEqual(['Experiment 3: cooling', '', '', ''])
    expect(find(g.issues, 'W_MERGED_CELLS')).toBeUndefined()
    // A group header over part of the columns, in the row above the header, is still propagated.
    const grouped = XLSX.utils.aoa_to_sheet([
      ['Run 1', null, 'Run 2', null],
      ['t (s)', 'V (V)', 't (s)', 'V (V)'],
      [0, 1.1, 0, 1.2],
    ])
    grouped['!merges'] = [XLSX.utils.decode_range('A1:B1'), XLSX.utils.decode_range('C1:D1')]
    const h = value(read(toBytes(book({ S: grouped }))))
    expect(h.grid[0]).toEqual(['Run 1', 'Run 1', 'Run 2', 'Run 2'])
    expect(find(h.issues, 'W_MERGED_CELLS')?.params).toEqual({ count: 2, header: 2, data: 0 })
    // A merge in a preamble line far above the header is left alone.
    const far = XLSX.utils.aoa_to_sheet([
      ['Lab', null, 'Bench 3'],
      ['Operator', null, 'MR'],
      ['x', 'y', 'z'],
      [1, 2, 3],
    ])
    far['!merges'] = [XLSX.utils.decode_range('A1:B1')]
    expect(value(read(toBytes(book({ S: far })))).grid[0]).toEqual(['Lab', '', 'Bench 3'])
  })

  it('in a sheet without numbers only first-row merges are propagated', () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Group', null, 'Note'],
      ['A', null, 'x'],
      ['B', 'C', 'y'],
    ])
    ws['!merges'] = [XLSX.utils.decode_range('A1:B1'), XLSX.utils.decode_range('A2:B2')]
    const g = value(read(toBytes(book({ S: ws }))))
    expect(g.grid[0]).toEqual(['Group', 'Group', 'Note'])
    expect(g.grid[1]).toEqual(['A', '', 'x'])
    expect(find(g.issues, 'W_MERGED_CELLS')?.params).toEqual({ count: 2, header: 1, data: 1 })
  })
})

describe('readWorkbook — formulas and special cells', () => {
  it('a formula without a cached value is missing (never 0) and reported', () => {
    const g = value(read(fixture('formula-no-cache.xlsx')))
    const c = column(g, 2)
    expect(c.text.slice(1)).toEqual(['', '', '4'])
    expect(c.kind.slice(1)).toEqual([N.empty, N.empty, N.number])
    expect(Number.isNaN(c.num[1]) && Number.isNaN(c.num[2])).toBe(true)
    const w = find(g.issues, 'W_FORMULA_NO_VALUE')
    expect(w?.params).toEqual({ count: 2 })
    expect(w?.rows).toEqual([1, 2])
    expect(w?.severity).toBe('warning')
  })

  it('percent formats: real \'%\' scales (v = fraction kept), a quoted "%" is literal text', () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['scaled', 'literal'],
      [0.125, 12.5],
    ])
    ws['A2'].z = '0.0%'
    ws['B2'].z = '0.0"%"'
    const g = value(read(toBytes(book({ S: ws }))))
    expect(g.grid[1]).toEqual(['12.5%', '12.5%'])
    expect([g.native[0].kind[1], g.native[0].num[1]]).toEqual([N.number, 0.125])
    expect(g.native[1].kind[1]).toBe(N.text) // read from its text like a CSV "12.5%", never scaled again
    expect(percentFormat('0%')).toBe('scaled')
    expect(percentFormat('[Red]0.00%;-0.00%')).toBe('scaled')
    expect(percentFormat('0.0\\%')).toBe('literal')
    expect(percentFormat('General')).toBe('none')
  })

  it('booleans are their own kind', () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['flag', 'n'],
      [true, 1],
      [false, 2],
    ])
    const g = value(read(toBytes(book({ S: ws }))))
    expect(column(g, 0).text.slice(1)).toEqual(['TRUE', 'FALSE'])
    expect(column(g, 0).kind.slice(1)).toEqual([N.boolean, N.boolean])
    expect(column(g, 0).num.slice(1).every(Number.isNaN)).toBe(true)
  })

  it('the default sheet skips hidden sheets; hidden sheets stay listed', () => {
    const data = [
      ['a', 'b'],
      [1, 2],
      [3, 4],
    ]
    const wb = book({ Hidden: XLSX.utils.aoa_to_sheet(data), Visible: XLSX.utils.aoa_to_sheet(data) })
    wb.Workbook = {
      Sheets: [
        { name: 'Hidden', Hidden: 1 },
        { name: 'Visible', Hidden: 0 },
      ],
    }
    const g = value(read(toBytes(wb)))
    expect(g.sheetName).toBe('Visible')
    expect(g.sheets.map((s) => [s.name, s.hidden])).toEqual([
      ['Hidden', true],
      ['Visible', false],
    ])
  })

  it('a workbook with nothing in it → E_SHEET_EMPTY', () => {
    const r = read(toBytes(book({ Empty: XLSX.utils.aoa_to_sheet([]) })))
    expect(errorOf(r)).toMatchObject({ code: 'E_SHEET_EMPTY', severity: 'error' })
  })
})

describe('readWorkbook — limits and rejected inputs', () => {
  const big = () => {
    const rows = Array.from({ length: 30 }, (_, r) => Array.from({ length: 10 }, (_, c) => r * 10 + c))
    return book({ Data: XLSX.utils.aoa_to_sheet(rows) })
  }

  const spyOn = () => {
    const calls: XLSX.ParsingOptions[] = []
    const spy = {
      ...XLSX,
      read: (data: unknown, o?: XLSX.ParsingOptions) => {
        calls.push(o ?? {})
        return XLSX.read(data, o)
      },
    } as typeof XLSX
    return { spy, calls }
  }

  for (const bookType of ['xlsx', 'ods'] as const) {
    it(`a declared size far above the limit is refused before the full parse (memory guard, ${bookType})`, () => {
      const { spy, calls } = spyOn()
      // 300 declared cells > 10 × 20: refused from the probe alone.
      const r = readWorkbook(spy, toBytes(big(), bookType), { maxCells: 20 })
      expect(errorOf(r)).toMatchObject({ code: 'E_TOO_MANY_CELLS', params: { cells: 300, limit: 20 } })
      expect(calls.length).toBe(1)
      expect(calls[0].sheetRows).toBeGreaterThan(0)
    })

    it(`the limit applies to the cells actually used (${bookType})`, () => {
      const { spy, calls } = spyOn()
      const r = readWorkbook(spy, toBytes(big(), bookType), { maxCells: 100 })
      expect(errorOf(r)).toMatchObject({ code: 'E_TOO_MANY_CELLS', params: { cells: 300, limit: 100 } })
      expect(calls.length).toBe(2)
    })
  }

  it('a declared range inflated by formatted empty cells is trimmed, not refused', () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['x (s)', 'y (m)'],
      [1, 2],
      [3, 4],
      [5, 6],
    ])
    ws['!ref'] = 'A1:C1000000'
    const g = value(read(toBytes(book({ S: ws }))))
    expect(g.sheets[0]).toMatchObject({ rows: 1_000_000, cols: 3 })
    expect(g.grid).toEqual([
      ['x (s)', 'y (m)'],
      ['1', '2'],
      ['3', '4'],
      ['5', '6'],
    ])
    expect(find(g.issues, 'I_TRIMMED_EMPTY')?.params).toMatchObject({ rows: 999_996, cols: 1 })
  })

  it('exactly at the limit is accepted', () => {
    const g = value(readWorkbook(XLSX, toBytes(big()), { maxCells: 300 }))
    expect(g.grid.length).toBe(30)
    expect(g.sheets[0]).toMatchObject({ rows: 30, cols: 10 })
  })

  it('a damaged OLE file (a bare 512-byte header) is unreadable, not "protected"', () => {
    // SheetJS falls through to its zip reader and reports "Unsupported ZIP encryption".
    expect(errorOf(read(fixture('legacy.xls')))).toMatchObject({
      code: 'E_SPREADSHEET_UNREADABLE',
      params: { reason: 'corrupt' },
    })
  })

  it('a password-protected workbook (OLE container with EncryptionInfo) is not called a .xls', () => {
    const bytes = new Uint8Array(1024)
    bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
    const name = 'EncryptionInfo'
    for (let i = 0; i < name.length; i++) bytes[600 + 2 * i] = name.charCodeAt(i)
    expect(errorOf(read(bytes))).toMatchObject({
      code: 'E_SPREADSHEET_UNREADABLE',
      params: { reason: 'password' },
    })
  })

  it('non-zip bytes → E_UNSUPPORTED_FORMAT; a damaged zip → E_SPREADSHEET_UNREADABLE (no throw)', () => {
    expect(errorOf(read(new TextEncoder().encode('a,b\n1,2\n'))).code).toBe('E_UNSUPPORTED_FORMAT')
    const broken = fixture('libreoffice-saved.xlsx').slice(0, 300)
    expect(errorOf(read(broken)).code).toBe('E_SPREADSHEET_UNREADABLE')
  })

  it('a non-positive maxCells is a programmer error', () => {
    expect(() => readWorkbook(XLSX, fixture('data-from-A3.xlsx'), { maxCells: 0 })).toThrow()
  })
})
