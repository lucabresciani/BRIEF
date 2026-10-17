// Shared by the worker and by the main-thread fallback: pure calls into the domain.
import type * as XLSXModule from 'xlsx'
import { importBytes, importText } from '@/domain/import/importPipeline'
import { importRegions } from '@/domain/import/regionImport'
import { spreadsheetContainer } from '@/domain/import/spreadsheet'
import { deserializeProject } from '@/domain/project/deserialize'
import type { WorkerRequest, WorkerResponse } from './protocol'

let xlsxModule: Promise<typeof XLSXModule> | null = null
let codepages: Promise<void> | null = null

/**
 * SheetJS (~1 MB) is loaded only when a spreadsheet is opened. Legacy .xls files (OLE) also get the code
 * page tables (~0.5 MB, their own chunk, no eval): Excel 95 and older store text in Windows code pages, and
 * without them SheetJS drops those characters silently, so a failed load fails the import. A failed load
 * is not kept: the next file tries again (a chunk fetched on demand can fail once on a flaky network).
 */
async function loadXlsx(bytes: Uint8Array): Promise<typeof XLSXModule | undefined> {
  const container = spreadsheetContainer(bytes)
  if (container === null) return undefined
  const XLSX = await (xlsxModule ??= import('xlsx').catch((err: unknown) => {
    xlsxModule = null
    throw err
  }))
  if (container === 'ole') {
    await (codepages ??= import('xlsx/dist/cpexcel.full.mjs').then(
      (cptable) => XLSX.set_cptable(cptable),
      (err: unknown) => {
        codepages = null
        throw err
      },
    ))
  }
  return XLSX
}

export async function handleRequest(req: WorkerRequest): Promise<WorkerResponse> {
  try {
    switch (req.type) {
      case 'parseText':
        return {
          requestId: req.requestId,
          type: 'draft',
          result: importText(req.text, req.source, req.overrides),
        }
      case 'parseFile': {
        const bytes = new Uint8Array(req.bytes)
        const xlsx = await loadXlsx(bytes)
        return {
          requestId: req.requestId,
          type: 'draft',
          result: importBytes(bytes, req.fileName, req.overrides, xlsx ? { xlsx } : undefined),
        }
      }
      case 'importRegions': {
        const bytes = new Uint8Array(req.bytes)
        const xlsx = await loadXlsx(bytes)
        return {
          requestId: req.requestId,
          type: 'drafts',
          result: importRegions(bytes, req.fileName, req.spec, req.overrides, xlsx ? { xlsx } : undefined),
        }
      }
      case 'openProject':
        return {
          requestId: req.requestId,
          type: 'project',
          result: deserializeProject(req.text, { maxBytes: req.maxBytes }),
        }
    }
  } catch (err) {
    return {
      requestId: req.requestId,
      type: 'crash',
      message: err instanceof Error ? err.message : String(err),
    }
  }
}
