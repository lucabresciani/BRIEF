import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ImportDraft } from '@/domain/import/importPipeline'
import type { Result } from '@/domain/model'
import { handleRequest } from './handlers'

const file = (name: string) => {
  const b = readFileSync(resolve('tests/fixtures/import', name))
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}
function value<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`failed: ${r.error.code} ${JSON.stringify(r.error.params ?? {})}`)
  return r.value
}
const text = (d: ImportDraft, col: number) => d.rawTable.columns[col]!.text

describe('import worker handlers', () => {
  it('parseFile: an Excel 97–2003 .xls is read (SheetJS and its code pages loaded on demand)', async () => {
    const res = await handleRequest({
      requestId: 1,
      type: 'parseFile',
      bytes: file('biff8-tables.xls'),
      fileName: 'biff8-tables.xls',
    })
    expect(res).toMatchObject({ requestId: 1, type: 'draft' })
    const d = value((res as { result: Result<ImportDraft> }).result)
    expect(d.rawTable.source.kind).toBe('xls')
    expect(text(d, 2)[0]).toBe('Resistenza (Ω)')
  })

  it('parseFile: an Excel 95 workbook (BIFF5, 8-bit Windows-1252 text)', async () => {
    const res = await handleRequest({
      requestId: 2,
      type: 'parseFile',
      bytes: file('excel95-cp1252.xls'),
      fileName: 'excel95-cp1252.xls',
    })
    const d = value((res as { result: Result<ImportDraft> }).result)
    expect(d.detection.sheetName).toBe('Costi')
    expect(text(d, 0)).toEqual(['Prezzo (€)', '12.5', '13'])
    expect(text(d, 1)).toEqual(['Nota', 'intervallo – 5', 'ok…'])
    expect(d.columns[0]).toMatchObject({ name: 'Prezzo', unit: '€' })
  })

  it('importRegions: answers with the drafts of the blocks', async () => {
    const res = await handleRequest({
      requestId: 3,
      type: 'importRegions',
      bytes: file('micro-tables.xlsx'),
      fileName: 'micro-tables.xlsx',
      spec: {
        sheetName: 'Grid',
        mode: 'separate',
        regions: [
          { range: 'B2:E9', orientation: 'columns' },
          { range: 'G2:J9', orientation: 'columns' },
        ],
      },
    })
    expect(res).toMatchObject({ requestId: 3, type: 'drafts' })
    const drafts = value((res as { result: Result<ImportDraft[]> }).result)
    expect(drafts.map((d) => d.rawTable.source.region?.blocks[0]?.range)).toEqual(['B2:E9', 'G2:J9'])
  })

  it('a code page chunk that fails to load fails that import only: the next .xls loads it again', async () => {
    vi.resetModules()
    vi.doMock('xlsx/dist/cpexcel.full.mjs', () => {
      throw new Error('network error')
    })
    const fresh = await import('./handlers')
    const req = {
      requestId: 6,
      type: 'parseFile',
      bytes: file('excel95-cp1252.xls'),
      fileName: 'excel95-cp1252.xls',
    } as const
    expect(await fresh.handleRequest(req)).toMatchObject({ type: 'crash' })
    vi.doUnmock('xlsx/dist/cpexcel.full.mjs')
    const res = await fresh.handleRequest({ ...req, requestId: 7 })
    expect(text(value((res as { result: Result<ImportDraft> }).result), 0)[0]).toBe('Prezzo (€)')
  })

  it('text and unknown bytes never load SheetJS and are answered as before', async () => {
    const csv = new TextEncoder().encode('x,y\n1,2\n3,4\n')
    const res = await handleRequest({
      requestId: 4,
      type: 'parseFile',
      bytes: csv.buffer as ArrayBuffer,
      fileName: 'a.csv',
    })
    expect(value((res as { result: Result<ImportDraft> }).result).rawTable.source.kind).toBe('csv')
    const regions = await handleRequest({
      requestId: 5,
      type: 'importRegions',
      bytes: csv.buffer as ArrayBuffer,
      fileName: 'a.csv',
      spec: { sheetName: 'S', mode: 'separate', regions: [{ range: 'A1:B3', orientation: 'columns' }] },
    })
    expect((regions as { result: Result<ImportDraft[]> }).result).toMatchObject({
      ok: false,
      error: { code: 'E_UNSUPPORTED_FORMAT' },
    })
  })
})
