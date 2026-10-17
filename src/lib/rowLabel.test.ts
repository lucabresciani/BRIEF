import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as XLSX from 'xlsx'
import { beforeEach, describe, expect, it } from 'vitest'
import { buildDatasetView } from '@/domain/derive/datasetView'
import { importText, type ImportDraft } from '@/domain/import/importPipeline'
import { importRegions, type RegionImportSpec } from '@/domain/import/regionImport'
import type { Dataset } from '@/domain/model'
import { issue } from '@/domain/model'
import { issueTitle, makeTranslator } from '@/i18n/translate'
import { getRawTables } from '@/state/dataStore'
import { emptyProject, loadProject, useProjectStore } from '@/state/projectStore'
import { importDrafts } from '@/state/actions/dataset'
import { datasetBlocks, recordLabel, recordsText, viewRowLabel } from './rowLabel'

const en = makeTranslator('en')
const it_ = makeTranslator('it')
const MICRO = 'micro-tables.xlsx'
const bytes = new Uint8Array(readFileSync(resolve('tests/fixtures/import', MICRO)))

function regions(spec: RegionImportSpec): ImportDraft[] {
  const r = importRegions(bytes, MICRO, spec, {}, { xlsx: XLSX })
  if (!r.ok) throw new Error(r.error.code)
  return r.value
}
/** Imports the drafts into the real stores and returns the first dataset with its view. */
function load(drafts: ImportDraft[]) {
  importDrafts(drafts)
  const ds = useProjectStore.getState().doc.datasets[0] as Dataset & { rawTableId: string }
  const view = buildDatasetView(ds, getRawTables()[ds.rawTableId]!)
  return { ds, view }
}

beforeEach(() => loadProject(emptyProject('Labels')))

describe('record labels: rows of a file, columns of a transposed table, tables of a merged dataset', () => {
  it('a table transposed on import: records are sheet columns ("Column D")', () => {
    const { ds, view } = load(
      regions({
        sheetName: 'Transposed',
        mode: 'separate',
        regions: [{ range: 'B2:F6', orientation: 'rows' }],
      }),
    )
    const [c, d] = [view.rowIds[0]!, view.rowIds[1]!]
    expect(recordLabel(en, view, d)).toBe('Column D')
    expect(recordLabel(it_, view, d)).toBe('Colonna D')
    expect(recordsText(en, view, [d, c])).toBe('Columns C, D')
    expect(recordsText(it_, view, [c])).toBe('Colonna C')
    expect(datasetBlocks(ds.id)).toEqual([])
    // Issue texts that list {rows} (fit warnings) say columns, with their letters.
    const label = viewRowLabel(view)!
    expect(label.axis).toBe('column')
    const lev = { ...issue('W_HIGH_LEVERAGE', { count: 2 }), rows: [c, d] }
    expect(issueTitle(en, lev, label)).toBe('The fit depends almost entirely on columns C, D.')
  })

  it('a merged dataset: the same sheet row occurs in each table, so the table is named', () => {
    const { ds, view } = load(
      regions({
        sheetName: 'Grid',
        mode: 'stack',
        regions: ['B2:E9', 'G2:J9'].map((range) => ({ range, orientation: 'columns' as const })),
      }),
    )
    expect(datasetBlocks(ds.id).map((b) => b.label)).toEqual(['oak plank 1', 'pine plank 1'])
    const [oak4, oak5] = [view.rowIds[0]!, view.rowIds[1]!]
    const pine4 = view.rowIds[6]!
    expect(view.sourceRow[0]).toBe(view.sourceRow[6]) // both are sheet row 4
    expect(recordLabel(en, view, pine4)).toBe('pine plank 1 · row 4')
    expect(recordLabel(it_, view, oak4)).toBe('oak plank 1 · riga 4')
    expect(recordsText(en, view, [pine4, oak5, oak4])).toBe('oak plank 1 · rows 4, 5; pine plank 1 · row 4')
    expect(recordsText(it_, view, [oak4, pine4])).toBe('oak plank 1 · riga 4; pine plank 1 · riga 4')
    expect(viewRowLabel(view)!(pine4)).toBe('pine plank 1 · 4')
  })

  it('a plain file: rows as before (numbers), at most 12 listed', () => {
    const text = `x,y\n${Array.from({ length: 20 }, (_, i) => `${i},${i * 2}`).join('\n')}\n`
    const r = importText(text, { kind: 'csv', fileName: 'a.csv' })
    if (!r.ok) throw new Error(r.error.code)
    const { view } = load([r.value])
    const label = viewRowLabel(view)!
    expect(label(view.rowIds[0]!)).toBe(2)
    expect(label.axis).toBe('row')
    expect(recordLabel(en, view, view.rowIds[0]!)).toBe('Row 2')
    expect(recordsText(en, view, Array.from(view.rowIds))).toBe(
      'Rows 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, …',
    )
    expect(recordLabel(en, view, 999)).toBeNull()
  })
})
