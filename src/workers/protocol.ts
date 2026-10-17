import type { ImportDraft, ImportOverrides } from '@/domain/import/importPipeline'
import type { RegionImportSpec } from '@/domain/import/regionImport'
import type {
  Issue,
  OperationLogEntry,
  ProjectDoc,
  RawTable,
  Result,
  SourceKind,
  WorkspaceState,
} from '@/domain/model'

export type WorkerRequest =
  | {
      requestId: number
      type: 'parseText'
      text: string
      source: { kind: SourceKind; fileName: string | null }
      overrides?: ImportOverrides
    }
  | {
      requestId: number
      type: 'parseFile'
      bytes: ArrayBuffer
      fileName: string
      overrides?: ImportOverrides
    }
  | {
      requestId: number
      type: 'importRegions'
      bytes: ArrayBuffer
      fileName: string
      spec: RegionImportSpec
      overrides?: ImportOverrides
    }
  | { requestId: number; type: 'openProject'; text: string; maxBytes: number }

export interface OpenedProject {
  doc: ProjectDoc
  rawTables: Record<string, RawTable>
  log: OperationLogEntry[]
  workspace: WorkspaceState | null
  repaired: Issue[]
}

export type WorkerResponse =
  | { requestId: number; type: 'draft'; result: Result<ImportDraft> }
  | { requestId: number; type: 'drafts'; result: Result<ImportDraft[]> }
  | { requestId: number; type: 'project'; result: Result<OpenedProject> }
  | { requestId: number; type: 'crash'; message: string }
