import { create } from 'zustand'
import type { ImportDraft, ImportOverrides } from '@/domain/import/importPipeline'
import type { RegionImportSpec } from '@/domain/import/regionImport'
import { LIMITS, checkFileSize, toMB } from '@/domain/import/limits'
import { fileExtension, isSpreadsheetKind, type SniffedFormat } from '@/domain/import/sniff'
import { issue, type DatasetId, type Issue, type Result, type SourceKind } from '@/domain/model'
import { toast } from '@/components/ui/toast'
import { importDraft, replaceDatasetFromDraft } from '@/state/actions/dataset'
import { openProject } from '@/state/actions/project'
import { ui } from '@/state/uiStore'
import { useProjectStore } from '@/state/projectStore'
import { isProjectFileName } from '@/platform/files'
import {
  cancelImports,
  importRegions,
  openProjectText,
  parseText,
  reparseBytes,
} from '@/workers/importClient'
import type { Translator } from '@/i18n/translate'
import { issueHint, issueTitle } from '@/i18n/translate'
import { confirmAction } from '@/components/app/confirmStore'

export type ImportSource =
  | { kind: 'text'; text: string; sourceKind: SourceKind; fileName: string | null }
  | { kind: 'bytes'; bytes: ArrayBuffer; fileName: string }

interface ImportState {
  loading: boolean
  /** What the import dialog shows and confirms. */
  draft: ImportDraft | null
  /** The whole-sheet draft of a sheet with several tables: what the sheet picker shows. */
  sheetDraft: ImportDraft | null
  /**
   * The draft was cut out of the sheet by the picker: re-reading it (another header row) re-runs this
   * spec for that block, never the whole sheet, and confirming keeps it for "Review".
   */
  regionSpec: RegionImportSpec | null
  /** The selection the picker starts from ("Review" of a region import); consumed by the picker. */
  pickerInit: RegionImportSpec | null
  source: ImportSource | null
  overrides: ImportOverrides
  /** When reviewing an already imported dataset, confirming replaces it (undoable). */
  replacing: DatasetId | null
  error: Issue | null
}

const IDLE = {
  loading: false,
  draft: null,
  sheetDraft: null,
  regionSpec: null,
  pickerInit: null,
  source: null,
  overrides: {},
  replacing: null,
  error: null,
} satisfies ImportState

export const useImportStore = create<ImportState>(() => ({ ...IDLE }))

/** How a dataset was imported in this session, so "Review" can reopen the preview or the picker. */
export interface RecentSource {
  source: ImportSource
  overrides: ImportOverrides
  /** Tables cut out of a sheet: the picker's request for this dataset. */
  region?: RegionImportSpec
}
const recentSources = new Map<DatasetId, RecentSource>()

/** Remembers how a dataset was imported, for "Review" (the picker's own imports use it too). */
export function rememberImport(id: DatasetId, rec: RecentSource): void {
  recentSources.set(id, rec)
}

/** The sheet picker chunk (lazy: it is only needed for workbooks with several tables per sheet). */
export const loadSheetPicker = () => import('./sheetPicker/SheetPickerDialog')

function showError(t: Translator, i: Issue) {
  toast.add({ title: issueTitle(t, i), description: issueHint(t, i) || undefined, type: 'error' })
}

/** An exception where a Result was expected: reported as an internal error, never swallowed. */
const internalError = (err: unknown): Issue =>
  issue('E_INTERNAL_GUARD', { reason: err instanceof Error ? err.message : String(err) })

/** Reads a chosen file; null (reported) when the browser cannot read it any more. */
async function readFile<T>(t: Translator, read: () => Promise<T>): Promise<T | null> {
  try {
    return await read()
  } catch {
    // NotReadableError: the file was moved, deleted or changed since it was chosen.
    toast.add({ title: t('import.readFailed'), description: t('import.readFailedHint'), type: 'error' })
    return null
  }
}

/**
 * Runs one import step with the loading flag on. The flag always comes back down, and a step that
 * throws is reported (in the dialog when one is open, else as a toast): nothing spins forever.
 */
async function withLoading(step: () => Promise<void>, onError: (i: Issue) => void): Promise<void> {
  useImportStore.setState({ loading: true })
  try {
    await step()
  } catch (err) {
    onError(internalError(err))
  } finally {
    useImportStore.setState({ loading: false })
  }
}

const showInDialog = (error: Issue) => useImportStore.setState({ error })

/**
 * Refuses a data file above its size limit before it is read into memory. The kind comes from the
 * extension; the import checks again with the format sniffed from the bytes.
 */
function dataFileTooLarge(file: File): Issue | null {
  if (typeof file.size !== 'number') return null
  const kind = isSpreadsheetKind(fileExtension(file.name) as SniffedFormat) ? 'sheet' : 'text'
  return checkFileSize(file.size, kind).error
}

/** A request cancelled by the user (the worker was stopped): nothing to report. */
export const cancelled = (r: Result<unknown>) =>
  !r.ok && r.error.code === 'E_INTERNAL_GUARD' && r.error.params?.reason === 'cancelled'

/** Reads a source (text or file bytes) with the given settings, in the worker. */
export async function run(source: ImportSource, overrides: ImportOverrides) {
  return source.kind === 'text'
    ? parseText(source.text, { kind: source.sourceKind, fileName: source.fileName }, overrides)
    : reparseBytes(source.bytes, source.fileName, overrides)
}

/** A sheet holding two or more tables opens the picker instead of the fast path or the whole-sheet preview. */
export function needsPicker(draft: ImportDraft): boolean {
  return (draft.detection.sheet?.tables ?? 0) >= 2
}

function accept(
  t: Translator,
  draft: ImportDraft,
  source: ImportSource,
  overrides: ImportOverrides,
  region: RegionImportSpec | null = null,
) {
  const id = importDraft(draft)
  recentSources.set(id, { source, overrides, ...(region ? { region } : {}) })
  if (draft.issues.length === 0)
    toast.add({ title: t('import.reviewBannerNone', { name: draft.suggestedName }), type: 'success' })
}

function openPicker(sheetDraft: ImportDraft, patch: Partial<ImportState> = {}) {
  void loadSheetPicker().catch(() => undefined) // the dialog's Suspense retries; start the fetch now
  useImportStore.setState({ sheetDraft, draft: null, regionSpec: null, error: null, ...patch })
  ui.openDialog('sheetPicker')
}

/** First read of a new source: the picker, the fast path, or the blocking preview. */
function route(t: Translator, draft: ImportDraft, source: ImportSource) {
  if (needsPicker(draft)) return openPicker(draft, { source, overrides: {}, replacing: null })
  if (draft.fastPath) return accept(t, draft, source, {})
  useImportStore.setState({ draft, source, overrides: {}, replacing: null, regionSpec: null })
  ui.openDialog('import')
}

/** Text from paste / the paste dialog. Clean tables import immediately (fast path). */
export async function importFromText(t: Translator, text: string, sourceKind: SourceKind = 'clipboard') {
  const source: ImportSource = { kind: 'text', text, sourceKind, fileName: null }
  useImportStore.setState({ error: null })
  await withLoading(
    async () => {
      const r = await run(source, {})
      if (!r.ok) return cancelled(r) ? undefined : showError(t, r.error)
      route(t, r.value, source)
    },
    (i) => showError(t, i),
  )
}

/** A dropped or chosen file: data files go through the import, .sciplot files open as projects. */
export async function importFromFile(t: Translator, file: File) {
  if (isProjectFileName(file.name)) return openProjectFile(t, file)
  const tooLarge = dataFileTooLarge(file)
  if (tooLarge) return showError(t, tooLarge)
  useImportStore.setState({ error: null })
  await withLoading(
    async () => {
      const bytes = await readFile(t, () => file.arrayBuffer())
      if (!bytes) return
      const source: ImportSource = { kind: 'bytes', bytes, fileName: file.name }
      const r = await run(source, {})
      if (!r.ok) return cancelled(r) ? undefined : showError(t, r.error)
      route(t, r.value, source)
    },
    (i) => showError(t, i),
  )
}

const ROW_KEYS = ['headerRow', 'unitsRow', 'dataStartRow'] as const

/**
 * Re-read the current source with different settings (separator, header row, sheet…). A draft cut out by
 * the picker is re-cut instead: its row settings are rows of its block, sent with its region.
 */
export async function reinterpret(patch: ImportOverrides) {
  const { source, overrides, regionSpec } = useImportStore.getState()
  if (!source) return
  if (regionSpec) {
    if (source.kind !== 'bytes' || regionSpec.mode !== 'separate' || regionSpec.regions.length !== 1) return
    const region = { ...regionSpec.regions[0]! }
    for (const k of ROW_KEYS) if (k in patch) region[k] = patch[k] as never
    const spec: RegionImportSpec = { ...regionSpec, regions: [region] }
    return withLoading(async () => {
      const r = await importRegions(source.bytes, source.fileName, spec)
      if (!r.ok) return cancelled(r) ? undefined : showInDialog(r.error)
      useImportStore.setState({ draft: r.value[0] ?? null, regionSpec: spec, error: null })
    }, showInDialog)
  }
  const next = { ...overrides, ...patch }
  useImportStore.setState({ overrides: next })
  return withLoading(async () => {
    const r = await run(source, next)
    if (!r.ok) return cancelled(r) ? undefined : showInDialog(r.error)
    useImportStore.setState({ draft: r.value, error: null })
  }, showInDialog)
}

/** Back from the preview to the picker: the whole-sheet draft is kept (or is the one shown). */
export function backToPicker() {
  const { draft, sheetDraft, regionSpec } = useImportStore.getState()
  const sheet = regionSpec ? sheetDraft : (draft ?? sheetDraft)
  if (!sheet) return
  openPicker(sheet)
}

export function confirmImport(t: Translator) {
  const { draft, source, overrides, replacing, regionSpec } = useImportStore.getState()
  if (!draft || !source) return
  if (replacing) {
    replaceDatasetFromDraft(replacing, draft)
    recentSources.set(replacing, { source, overrides, ...(regionSpec ? { region: regionSpec } : {}) })
  } else {
    accept(t, draft, source, overrides, regionSpec)
  }
  closeImport()
}

export function closeImport() {
  useImportStore.setState({ ...IDLE })
  const open = ui.get().dialog
  if (open === 'import' || open === 'sheetPicker') ui.closeDialog()
}

export function cancelImport() {
  cancelImports()
  closeImport()
}

export function canReview(datasetId: DatasetId): boolean {
  return recentSources.has(datasetId)
}

/**
 * Reopen how a dataset imported in this session was read: the preview (fast path "Review"), or for tables
 * cut out of a sheet the picker, with that selection. Confirming replaces the dataset (undoable).
 */
export async function reviewImport(t: Translator, datasetId: DatasetId) {
  const rec = recentSources.get(datasetId)
  if (!rec) return
  const report = (i: Issue) => showError(t, i)
  const region = rec.region
  if (region) {
    useImportStore.setState({ ...IDLE, source: rec.source, replacing: datasetId, pickerInit: region })
    return withLoading(async () => {
      const r = await run(rec.source, { sheetName: region.sheetName })
      if (!r.ok) return cancelled(r) ? undefined : report(r.error)
      ui.set({ importNotice: null })
      openPicker(r.value, { overrides: { sheetName: region.sheetName } })
    }, report)
  }
  useImportStore.setState({ source: rec.source, overrides: rec.overrides, replacing: datasetId })
  return withLoading(async () => {
    const r = await run(rec.source, rec.overrides)
    if (!r.ok) return cancelled(r) ? undefined : report(r.error)
    useImportStore.setState({ draft: r.value })
    ui.set({ importNotice: null })
    ui.openDialog('import')
  }, report)
}

export async function openProjectFile(t: Translator, file: File) {
  // Refused before asking anything, and before the whole file is read into memory.
  if (typeof file.size === 'number' && file.size > LIMITS.maxProjectBytes) {
    const size = { size: toMB(file.size), limit: toMB(LIMITS.maxProjectBytes) }
    return showError(t, issue('E_PROJECT_TOO_LARGE', size))
  }
  const hasWork = useProjectStore.getState().doc.datasets.length > 0
  if (
    hasWork &&
    !(await confirmAction({
      title: t('project.openTitle'),
      body: t('project.replaceConfirm'),
      confirm: t('topbar.openProject'),
    }))
  )
    return
  const text = await readFile(t, () => file.text())
  if (text === null) return
  const r = await openProjectText(text)
  if (!r.ok) return showError(t, r.error)
  try {
    openProject(r.value)
  } catch (err) {
    return showError(t, internalError(err))
  }
  toast.add({ title: t('project.opened', { name: file.name }), type: 'success' })
  for (const w of r.value.repaired)
    toast.add({
      title: issueTitle(t, w),
      description: issueHint(t, w) || undefined,
      type: w.severity === 'info' ? 'info' : 'warning',
    })
}
