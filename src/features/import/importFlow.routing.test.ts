import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as XLSX from 'xlsx'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { importBytes, importText, type ImportDraft } from '@/domain/import/importPipeline'
import { importRegions, type RegionImportSpec } from '@/domain/import/regionImport'
import { makeTranslator } from '@/i18n/translate'
import { emptyProject, loadProject, undo, useProjectStore } from '@/state/projectStore'
import { excludeRows } from '@/state/actions/analysis'
import { rawTableFor } from '@/state/actions/dataset'
import { asRowId } from '@/domain/model'
import { ui } from '@/state/uiStore'
import {
  backToPicker,
  canReview,
  cancelImport,
  confirmImport,
  importFromFile,
  importFromText,
  needsPicker,
  reinterpret,
  reviewImport,
  useImportStore,
} from './importFlow'
import { importFromPicker, importWholeSheet, pickSheet } from './sheetPicker/pickerActions'

// The worker client answers with the real domain functions (no worker in the test runner).
const client = vi.hoisted(() => ({
  parseText: vi.fn(),
  reparseBytes: vi.fn(),
  importRegions: vi.fn(),
  cancelImports: vi.fn(),
  unsure: { next: false },
}))
vi.mock('@/workers/importClient', async (orig) => ({ ...(await orig<object>()), ...client }))
vi.mock('@/components/ui/toast', () => ({ toast: { add: () => undefined } }))

const t = makeTranslator('en')
const MICRO = 'micro-tables.xlsx'
const micro = readFileSync(resolve('tests/fixtures/import', MICRO))

beforeEach(() => {
  loadProject(emptyProject('Picker'))
  useImportStore.setState({ draft: null, sheetDraft: null, source: null, regionSpec: null })
  ui.closeDialog()
  client.unsure.next = false
  client.parseText
    .mockReset()
    .mockImplementation(async (text: string, source, overrides) => importText(text, source, overrides))
  client.reparseBytes
    .mockReset()
    .mockImplementation(async (bytes: ArrayBuffer, name: string, overrides) =>
      importBytes(new Uint8Array(bytes), name, overrides, { xlsx: XLSX }),
    )
  client.importRegions
    .mockReset()
    .mockImplementation(async (bytes: ArrayBuffer, name: string, spec: RegionImportSpec, overrides) => {
      const r = importRegions(new Uint8Array(bytes), name, spec, overrides, { xlsx: XLSX })
      // Lets a test make the importer unsure about the next draft (fast path off).
      if (r.ok && client.unsure.next) r.value.forEach((d) => (d.fastPath = false))
      return r
    })
})

const file = (name: string, data: Buffer) =>
  ({
    name,
    arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
  }) as File
const doc = () => useProjectStore.getState().doc
const GRID = ['B2:E9', 'G2:J9', 'L2:O9', 'B11:E18', 'G11:J18', 'L11:O18']
const spec = (mode: 'separate' | 'stack', ranges: string[], extra: Partial<RegionImportSpec> = {}) =>
  ({
    sheetName: 'Grid',
    mode,
    regions: ranges.map((range) => ({ range, orientation: 'columns' })),
    ...extra,
  }) as RegionImportSpec

describe('routing of a new import', () => {
  it('a sheet with two or more tables opens the picker, never the fast path or the whole-sheet preview', async () => {
    await importFromFile(t, file(MICRO, micro))
    expect(ui.get().dialog).toBe('sheetPicker')
    const { sheetDraft, draft } = useImportStore.getState()
    expect(sheetDraft?.detection.sheet?.tables).toBe(6)
    expect(draft).toBeNull()
    expect(doc().datasets).toHaveLength(0)
  })

  it('the picker wins over a clean fast path; one table or none does not need it', () => {
    const draft = (tables: number, fastPath: boolean) =>
      ({ fastPath, detection: { sheet: tables < 0 ? null : { tables } } }) as unknown as ImportDraft
    expect(needsPicker(draft(2, true))).toBe(true)
    expect(needsPicker(draft(1, true))).toBe(false)
    expect(needsPicker(draft(-1, true))).toBe(false)
  })

  it('a clean single table still imports at once; an uncertain one opens the preview', async () => {
    await importFromText(t, 'x,y\n1,2\n2,4\n3,6\n')
    expect(doc().datasets).toHaveLength(1)
    expect(ui.get().dialog).toBeNull()
    await importFromText(t, 'a;b\n1,234;2\n2,345;4\n3,456;6')
    expect(ui.get().dialog).toBe('import')
  })
})

describe('importing from the picker', () => {
  beforeEach(async () => {
    await importFromFile(t, file(MICRO, micro))
  })

  it('separately: one dataset per table in ONE undo step and one tab; same columns are overlaid', async () => {
    // Rows chosen for the whole sheet in its preview are rows of another grid: they must not travel.
    useImportStore.setState({ overrides: { headerRow: 5, dataStartRow: 7 } })
    await importFromPicker(t, spec('separate', GRID.slice(0, 2)))
    expect(client.importRegions).toHaveBeenCalledTimes(1)
    expect(client.importRegions.mock.calls[0]![2]).toEqual(spec('separate', GRID.slice(0, 2)))
    expect(client.importRegions.mock.calls[0]![3]).toBeUndefined()
    expect(doc().datasets.map((d) => d.name)).toEqual([
      'micro-tables · oak plank 1',
      'micro-tables · pine plank 1',
    ])
    expect(doc().plots).toHaveLength(1)
    expect(doc().plots[0]!.series.map((s) => s.datasetId)).toEqual(doc().datasets.map((d) => d.id))
    expect(ui.get().dialog).toBeNull()
    expect(useImportStore.getState().sheetDraft).toBeNull()
    undo()
    expect(doc().datasets).toHaveLength(0)
  })

  it('merged: one dataset with label columns (role group) and a scatter split by the first one', async () => {
    await importFromPicker(t, spec('stack', GRID))
    const [ds] = doc().datasets
    expect(ds!.columns.filter((c) => c.role === 'group').map((c) => c.name)).toEqual(['Title 1', 'plank'])
    const [series] = doc().plots[0]!.series
    expect(series!.split).toEqual({ column: ds!.columns[0]!.id, overrides: [] })
  })

  it('merged without label columns: no split (nothing to split by)', async () => {
    await importFromPicker(t, spec('stack', GRID, { labels: [] }))
    expect(doc().plots[0]!.series[0]!.split).toBeNull()
  })

  it('a table the importer is unsure about opens the preview; its header row re-cuts only that block', async () => {
    client.unsure.next = true
    await importFromPicker(t, spec('separate', ['B2:E9']))
    expect(ui.get().dialog).toBe('import')
    expect(useImportStore.getState().regionSpec).toEqual(spec('separate', ['B2:E9']))
    expect(doc().datasets).toHaveLength(0)
    await reinterpret({ headerRow: 1, dataStartRow: undefined })
    const call = client.importRegions.mock.calls.at(-1)!
    expect(call[2]).toEqual({
      sheetName: 'Grid',
      mode: 'separate',
      regions: [{ range: 'B2:E9', orientation: 'columns', headerRow: 1, dataStartRow: undefined }],
    })
    expect(call[3]).toBeUndefined()
    expect(client.reparseBytes).toHaveBeenCalledTimes(1) // the whole sheet was read once, at the start
    confirmImport(t)
    const [ds] = doc().datasets
    expect(ds!.name).toBe('micro-tables · oak plank 1')
    expect(canReview(ds!.id)).toBe(true)
  })

  it('"Review" of a table cut out of a sheet reopens the picker with that selection, to replace it', async () => {
    await importFromPicker(t, spec('separate', GRID.slice(0, 1)))
    const [ds] = doc().datasets
    await reviewImport(t, ds!.id)
    expect(ui.get().dialog).toBe('sheetPicker')
    const s = useImportStore.getState()
    expect(s.replacing).toBe(ds!.id)
    expect(s.pickerInit).toEqual(spec('separate', GRID.slice(0, 1)))
    expect(s.sheetDraft?.detection.sheetName).toBe('Grid')
    // Choosing again replaces the dataset (no second dataset).
    await importFromPicker(t, spec('separate', ['G2:J9']))
    expect(doc().datasets).toHaveLength(1)
    expect(doc().datasets[0]!.id).toBe(ds!.id)
    expect(ui.get().dialog).toBeNull()
  })

  it('"Review" of a merge with another set of label columns keeps the plot, roles and exclusions on their own columns and records', async () => {
    await importFromPicker(t, spec('stack', GRID))
    const before = doc().datasets[0]!
    const name = (id: string | undefined) => doc().datasets[0]!.columns.find((c) => c.id === id)?.name
    const series = () => doc().plots[0]!.series[0]!
    expect([name(series().x), name(series().y)]).toEqual(['position', 'Width mm'])
    const raw = rawTableFor(before.id)!
    // Exclude the second record of the second table (pine, plank 1).
    const block = raw.source.region!.blocks[1]!
    const excluded = asRowId(block.firstRow + 1)
    const sheetRow = raw.sourceRow[excluded]
    excludeRows(before.id, [excluded], 'outlier-candidate', '')
    await reviewImport(t, before.id)
    // Without the first label column ("Title 1"): every column after it moves one place to the left.
    await importFromPicker(
      t,
      spec('stack', GRID.slice(1), {
        labels: [{ source: { type: 'titleCell', index: 1 }, name: 'plank', kind: 'auto' }],
      }),
    )
    const after = doc().datasets[0]!
    expect(after.id).toBe(before.id)
    expect(after.columns.map((c) => [c.name, c.role])).toEqual([
      ['plank', 'group'],
      ['position', 'measurement'],
      ['Width mm', 'measurement'],
      ['Depth mm', 'measurement'],
      ['area', 'measurement'],
    ])
    expect([name(series().x), name(series().y)]).toEqual(['position', 'Width mm'])
    // The split named the dropped column: reset, never moved to another column.
    expect(series().split).toBeNull()
    // The excluded record is the same table and sheet row in the new table (the first table is gone).
    const now = rawTableFor(after.id)!
    const [exc] = doc().exclusions
    expect(exc!.rowIds).toHaveLength(1)
    const r = exc!.rowIds[0]!
    expect(now.sourceRow[r]).toBe(sheetRow)
    const b = now.source.region!.blocks.find((x) => r >= x.firstRow && r < x.firstRow + x.rowCount)
    expect(b?.range).toBe(block.range)
  })

  it('the whole sheet as one table goes to the preview, and back to the picker', () => {
    importWholeSheet()
    expect(ui.get().dialog).toBe('import')
    const sheet = useImportStore.getState().sheetDraft
    expect(useImportStore.getState().draft).toBe(sheet)
    backToPicker()
    expect(ui.get().dialog).toBe('sheetPicker')
    expect(useImportStore.getState().sheetDraft).toBe(sheet)
  })

  it('another sheet tab reads that sheet; cancelling closes everything', async () => {
    await pickSheet('Transposed')
    expect(useImportStore.getState().sheetDraft?.detection.sheetName).toBe('Transposed')
    expect(useImportStore.getState().overrides).toEqual({ sheetName: 'Transposed' })
    cancelImport()
    expect(ui.get().dialog).toBeNull()
    expect(useImportStore.getState().sheetDraft).toBeNull()
    expect(client.cancelImports).toHaveBeenCalled()
  })

  it('a failed region import is reported in the picker, which stays open', async () => {
    const err = await importFromPicker(t, spec('separate', ['AA100:AB120']))
    expect(err).toMatchObject({ code: 'E_NO_DATA_ROWS' })
    expect(useImportStore.getState().error).toMatchObject({ code: 'E_NO_DATA_ROWS' })
    expect(ui.get().dialog).toBe('sheetPicker')
  })
})
