import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import { parseA1Range, toGridRange } from '@/domain/import/a1'
import { importBytes, type ImportDraft } from '@/domain/import/importPipeline'
import { importRegions } from '@/domain/import/regionImport'
import {
  addRange,
  blockAt,
  chipText,
  clearSelection,
  clickBlock,
  EMPTY_PICK,
  fromSpec,
  headerOptions,
  headerSummary,
  itemInfo,
  keepOnly,
  labelChoice,
  mergeCandidates,
  mergeProposal,
  parseTypedRange,
  pickerSheet,
  removeItem,
  selectAllTables,
  setLabel,
  setSettings,
  toSpec,
  type PickerSheet,
  type PickerState,
} from './pickerState'

const MICRO = 'micro-tables.xlsx'
const bytes = new Uint8Array(readFileSync(resolve('tests/fixtures/import', MICRO)))

function sheetDraft(sheetName?: string): ImportDraft {
  const r = importBytes(bytes, MICRO, sheetName ? { sheetName } : {}, { xlsx: XLSX })
  if (!r.ok) throw new Error(r.error.code)
  return r.value
}
const grid = pickerSheet(sheetDraft())
const transposed = pickerSheet(sheetDraft('Transposed'))
const keys = (s: PickerState) => s.items.map((i) => i.key)
const infos = (sheet: PickerSheet, s: PickerState) => s.items.map((i) => itemInfo(sheet, s, i))
/** A sheet A1 range in the grid frame of `sheet`. */
const range = (sheet: PickerSheet, a1: string) => toGridRange(parseA1Range(a1)!, sheet.origin)

describe('pickerSheet: the whole-sheet draft as the picker reads it', () => {
  it('cells, sheet rows and blocks come straight from the draft', () => {
    expect(grid.name).toBe('Grid')
    expect(grid.origin).toEqual({ row: 1, col: 1 })
    expect(grid.blocks.map((b) => b.a1)).toEqual(['B2:E9', 'G2:J9', 'L2:O9', 'B11:E18', 'G11:J18', 'L11:O18'])
    expect(grid.text(0, 0)).toBe('oak')
    expect(grid.sheetRow(0)).toBe(2)
    expect(chipText(grid.blocks[2]!, 3)).toBe('3 · birch · plank 1')
    // A block titled by a key/value line is named by it, not left "untitled".
    expect(chipText(transposed.blocks[0]!, 1)).toBe('1 · layers 0')
    expect(blockAt(grid, 3, 2)?.a1).toBe('B2:E9')
    expect(blockAt(grid, 3, 4)).toBeNull() // the empty column F between two tables
    // A table without a title is listed by its first variable names.
    expect(headerSummary(grid.blocks[0]!)).toBe('position, Width mm, Depth mm, …')
    expect(headerSummary({ header: ['', 'x', ' y '] })).toBe('x, y')
    expect(headerSummary({ header: [] })).toBe('')
  })
})

describe('selection semantics', () => {
  it('a click selects one block; Ctrl/Cmd toggles; Shift selects from the anchor in reading order', () => {
    let s = clickBlock(EMPTY_PICK, grid, 'b2', 'single')
    expect(keys(s)).toEqual(['b2'])
    s = clickBlock(s, grid, 'b4', 'toggle')
    expect(keys(s)).toEqual(['b2', 'b4'])
    expect(s.active).toBe('b4')
    s = clickBlock(s, grid, 'b2', 'toggle')
    expect(keys(s)).toEqual(['b4'])
    // The anchor is the last clicked block (b2, even if toggled off): b2…b5 in reading order.
    s = clickBlock(s, grid, 'b5', 'range')
    expect(keys(s)).toEqual(['b2', 'b3', 'b4', 'b5'])
    // A plain click on a block of the selection keeps only it.
    expect(keys(clickBlock(s, grid, 'b3', 'single'))).toEqual(['b3'])
  })

  it('Shift without an anchor, or on an unknown block, behaves sensibly', () => {
    expect(keys(clickBlock(EMPTY_PICK, grid, 'b3', 'range'))).toEqual(['b3'])
    expect(clickBlock(EMPTY_PICK, grid, 'nope', 'single')).toBe(EMPTY_PICK)
  })

  it('a drawn range: exactly a block selects the block; otherwise it is a range of its own', () => {
    let s = addRange(EMPTY_PICK, grid, range(grid, 'B2:E9'), false)
    expect(keys(s)).toEqual(['b1'])
    s = addRange(s, grid, range(grid, 'B3:E9'), true)
    expect(keys(s)).toEqual(['b1', 'range:B3:E9'])
    expect(s.items[1]!.blockId).toBeNull()
    // Not additive: it replaces the selection. Clipped to the used part of the sheet.
    s = addRange(s, grid, range(grid, 'L11:Z99'), false)
    expect(keys(s)).toEqual(['b6'])
    expect(addRange(s, grid, range(grid, 'AA200:AB300'), true)).toBe(s)
  })

  it('Ctrl+A selects every table; Escape clears; removing and keeping only', () => {
    let s = selectAllTables(EMPTY_PICK, grid)
    expect(keys(s)).toEqual(['b1', 'b2', 'b3', 'b4', 'b5', 'b6'])
    s = removeItem(s, 'b3')
    expect(keys(s)).toHaveLength(5)
    s = keepOnly(s, ['b1', 'b6'])
    expect(keys(s)).toEqual(['b1', 'b6'])
    expect(clearSelection(s).items).toEqual([])
  })
})

describe('reading of each table: name, orientation, header row', () => {
  it('names default to the title; the detected orientation can be flipped (and the header row with it)', () => {
    let s = clickBlock(EMPTY_PICK, transposed, 'b1', 'single')
    let [info] = infos(transposed, s)
    expect(info).toMatchObject({ name: 'layers 0', orientation: 'rows', detected: 'rows', a1: 'B2:F6' })
    expect(info!.header).toEqual(['duty', 'input', 'rise', 'loss'])
    // Header choices of a transposed table are sheet columns, its title row left out.
    expect(headerOptions(transposed, info!).map((o) => [o.axis, o.pos, o.preview])).toEqual([
      ['column', 'B', 'duty, input, rise'],
      ['column', 'C', '25%, 5, 0.3'],
      ['column', 'D', '50%, 10, 0.75'],
      ['column', 'E', '75%, 15, 1.2'],
      ['column', 'F', '100%, 20, 1.65'],
    ])
    s = setSettings(s, 'b1', { headerRow: 1, name: 'run A' })
    s = setSettings(s, 'b1', { orientation: 'columns' })
    ;[info] = infos(transposed, s)
    expect(info).toMatchObject({
      name: 'run A',
      orientation: 'columns',
      detected: 'rows',
      headerRow: undefined,
    })
    // Read as columns, its first row after the title is the header (as the importer would read it).
    expect(info!.header).toEqual(['duty', '25%', '50%', '75%', '100%'])
    expect(headerOptions(transposed, info!)[0]).toMatchObject({ axis: 'row', pos: '2', preview: 'layers, 0' })
  })

  it('a drawn range is analysed like a block (header, title, parameters)', () => {
    const s = addRange(EMPTY_PICK, grid, range(grid, 'B3:E9'), false)
    const [info] = infos(grid, s)
    expect(info).toMatchObject({ number: null, a1: 'B3:E9', name: 'B3:E9', orientation: 'columns' })
    expect(info!.header).toEqual(['position', 'Width mm', 'Depth mm', 'area'])
  })
})

describe('merge proposal and the import request', () => {
  it('tables with the same variables are proposed for a merge, with the label columns that tell them apart', () => {
    const s = selectAllTables(EMPTY_PICK, grid)
    const all = infos(grid, s)
    expect(mergeProposal(all)).toEqual({
      keys: ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'],
      columns: ['position', 'Width mm', 'Depth mm', 'area'],
      all: true,
      mixed: false,
    })
    expect(mergeCandidates(all).map((c) => [c.name, c.kind, c.suggested])).toEqual([
      ['Title 1', 'text', true],
      ['plank', 'number', true],
      ['Block', 'text', false],
    ])
    expect(mergeProposal(all.slice(0, 1))).toBeNull()
  })

  it('a table read the other way round no longer shares the structure: the proposal is partial', () => {
    let s = selectAllTables(EMPTY_PICK, grid)
    s = setSettings(s, 'b6', { orientation: 'rows' })
    const p = mergeProposal(infos(grid, s))!
    expect(p).toMatchObject({ all: false, mixed: true })
    expect(p.keys).toEqual(['b1', 'b2', 'b3', 'b4', 'b5'])
  })

  it('toSpec sends only the picker settings; stack labels as chosen (renamed, kind, left out)', () => {
    let s = selectAllTables(EMPTY_PICK, grid)
    s = keepOnly(s, ['b1', 'b2'])
    s = setSettings(s, 'b2', { headerRow: 1, name: '  pine run ' })
    const list = infos(grid, s)
    const [wood, plank] = mergeCandidates(list)
    s = setLabel(s, wood!, { name: 'Wood', kind: 'text' })
    s = setLabel(s, plank!, { on: false })
    expect(labelChoice(s, wood!)).toEqual({ on: true, name: 'Wood', kind: 'text' })
    const spec = toSpec(grid, s, infos(grid, s), 'stack')
    expect(spec).toEqual({
      sheetName: 'Grid',
      mode: 'stack',
      regions: [
        { range: 'B2:E9', orientation: 'columns' },
        { range: 'G2:J9', orientation: 'columns', headerRow: 1, name: 'pine run' },
      ],
      labels: [{ source: { type: 'titleCell', index: 0 }, name: 'Wood', kind: 'text' }],
    })
    expect(toSpec(grid, s, infos(grid, s), 'separate')).not.toHaveProperty('labels')
  })

  it('the request really imports: merged tables become one dataset with the chosen label column', () => {
    // oak 1, pine 1, oak 2: both the wood and the plank number vary.
    const s = keepOnly(selectAllTables(EMPTY_PICK, grid), ['b1', 'b2', 'b4'])
    const r = importRegions(bytes, MICRO, toSpec(grid, s, infos(grid, s), 'stack'), {}, { xlsx: XLSX })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value[0]!.columns.map((c) => [c.name, c.role])).toEqual([
      ['Title 1', 'group'],
      ['plank', 'group'],
      ['position', 'measurement'],
      ['Width mm', 'measurement'],
      ['Depth mm', 'measurement'],
      ['area', 'measurement'],
    ])
  })

  it('fromSpec restores the selection that produced a request (Review)', () => {
    let s = addRange(selectAllTables(EMPTY_PICK, grid), grid, range(grid, 'B3:E9'), true)
    s = keepOnly(s, ['b2', 'b3', 'range:B3:E9'])
    s = setSettings(s, 'b3', { name: 'birch', headerRow: 1 })
    const [first] = mergeCandidates(infos(grid, s))
    s = setLabel(s, first!, { name: 'Wood' })
    const spec = toSpec(grid, s, infos(grid, s), 'stack')
    const back = fromSpec(grid, spec)
    expect(keys(back)).toEqual(['b2', 'b3', 'range:B3:E9']) // reading order
    expect(back.settings.b3).toMatchObject({ name: 'birch', headerRow: 1, orientation: 'columns' })
    expect(toSpec(grid, back, infos(grid, back), 'stack')).toEqual(spec)
  })
})

describe('the A1 range field', () => {
  it('accepts a range with values; says why otherwise', () => {
    expect(parseTypedRange(grid, 'b2:e9')).toEqual({ ok: true, range: range(grid, 'B2:E9') })
    expect(parseTypedRange(grid, '$G$2:$J$9')).toMatchObject({ ok: true })
    expect(parseTypedRange(grid, 'B2:')).toEqual({ ok: false, reason: 'invalid' })
    expect(parseTypedRange(grid, 'Sheet1!B2:E9')).toEqual({ ok: false, reason: 'invalid' })
    expect(parseTypedRange(grid, 'AA100:AB120')).toEqual({ ok: false, reason: 'outside' })
    expect(parseTypedRange(grid, 'F2:F18')).toEqual({ ok: false, reason: 'empty' })
  })
})
