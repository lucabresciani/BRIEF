import {
  SCHEMA_VERSION,
  newId,
  type OperationLogEntry,
  type ProjectDoc,
  type ProjectId,
  type RawTable,
  type WorkspaceState,
} from '@/domain/model'
import { repairRefs } from '@/domain/model/integrity'
import { migrateDoc, migrateLog } from '@/domain/project/migrate'
import { acquireProjectLock, waitForProjectLock } from '@/platform/locks'
import {
  collectGarbage,
  listProjects,
  loadProject as loadRecord,
  probeStorage,
  saveProject,
  type StoredProjectRecord,
} from '@/platform/storage'
import { replaceRawTables, useDataStore } from './dataStore'
import { loadProject, operationLog, setReadOnly, useProjectStore } from './projectStore'
import { ui } from './uiStore'
import { initWorkspace, projectForSave, startWorkspaceSync } from './workspace'

type StoredProject = {
  doc: ProjectDoc
  log: OperationLogEntry[]
  workspace: WorkspaceState | null
  rawTables: Record<string, RawTable>
}

/**
 * A stored record in the current schema. Records are written by this app and never validated, so a
 * record of an older schema is migrated (only missing fields are added) and its references repaired,
 * as an opened file would be. null when even that fails: a damaged record is not restored.
 */
function upgradeRecord(rec: StoredProjectRecord): StoredProject | null {
  const { version, workspace, rawTables } = rec
  if (version >= SCHEMA_VERSION)
    return { doc: rec.doc as ProjectDoc, log: rec.log as OperationLogEntry[], workspace, rawTables }
  try {
    const doc = migrateDoc(rec.doc, version) as ProjectDoc
    const log = migrateLog(rec.log, version) as OperationLogEntry[]
    if (!Array.isArray(log)) return null
    repairRefs(doc)
    return { doc, log, workspace, rawTables }
  } catch {
    return null
  }
}

async function loadStored(id: string): Promise<StoredProject | null> {
  const r = await loadRecord(id)
  return r.ok && r.value ? upgradeRecord(r.value) : null
}

const DEBOUNCE_MS = 1000
const MAX_WAIT_MS = 5000

let timer: ReturnType<typeof setTimeout> | null = null
let firstPending = 0
/** The save being written, with the saves asked for meanwhile: they run right after it. */
let inflight: Promise<void> | null = null
let pendingAgain = false
/** The flush asked for during a save was a content save (it shows in the indicator). */
let pendingLoud = false
let disabled = false
/**
 * The workspace written by the last save (or loaded with the project). Tab, pane and layout changes
 * are not edits: they wait for the next content save, or are written quietly when the page hides.
 */
let savedWorkspace: WorkspaceState | null = null

const workspaceChanged = () => ui.get().workspace !== savedWorkspace

/** Nothing to write: autosave is off, the project is read-only or empty, or a quiet save has nothing new. */
function nothingToSave(quiet: boolean): boolean {
  if (disabled) return true
  // Checked when the save runs: a quiet save queued behind a save that already wrote the workspace (the
  // browser fires visibilitychange and pagehide together) has nothing left to write.
  if (quiet && !workspaceChanged()) return true
  const s = useProjectStore.getState()
  return s.readOnly || s.doc.datasets.length === 0
}

async function saveOnce(quiet: boolean): Promise<void> {
  const s = useProjectStore.getState()
  if (!quiet) ui.set({ storage: 'saving' })
  const shown = ui.get().workspace
  const { doc, workspace } = projectForSave(s.doc)
  const r = await saveProject(doc, operationLog(s), useDataStore.getState().rawTables, { workspace })
  if (r.ok) savedWorkspace = shown
  if (!quiet) {
    // An edit made while this save was written is waiting for its own save (timer): not saved yet.
    if (r.ok) ui.set({ storage: pendingLoud || timer ? 'pending' : 'saved' })
    else if (r.error === 'quota') ui.set({ storage: 'quota' })
    else if (r.error === 'unavailable') ui.set({ storage: 'unavailable' })
    else ui.set({ storage: 'retry' })
  }
}

/** Writes saves back to back until none was asked for during the last one. */
async function saveChain(quiet: boolean): Promise<void> {
  for (let q = quiet; ;) {
    await saveOnce(q)
    if (!pendingAgain) return
    q = !pendingLoud
    pendingAgain = pendingLoud = false
    if (nothingToSave(q)) return
  }
}

/**
 * Saves now. During a save the request is queued behind it, and the promise resolves only once that
 * queued save is written too: a caller that is about to replace the project never loses its last edit.
 * A quiet save (only the workspace changed) never shows in the storage indicator.
 */
function flush(opts: { quiet?: boolean } = {}): Promise<void> {
  const quiet = opts.quiet === true
  if (!quiet) {
    if (timer) clearTimeout(timer)
    timer = null
    firstPending = 0
  }
  if (nothingToSave(quiet)) return inflight ?? Promise.resolve()
  if (inflight) {
    pendingAgain = true
    if (!quiet) pendingLoud = true
    return inflight
  }
  const chain = saveChain(quiet).finally(() => {
    inflight = null
  })
  inflight = chain
  return chain
}

/** The page is hiding: write a pending change now, else a workspace change on its own (quietly). */
function flushOnHide(): void {
  if (timer) void flush()
  else if (workspaceChanged()) void flush({ quiet: true })
}

function schedule(): void {
  const st = ui.get().storage
  if (st === 'ok' || st === 'saved' || st === 'retry') ui.set({ storage: 'pending' })
  const now = Date.now()
  if (!firstPending) firstPending = now
  if (timer) clearTimeout(timer)
  const wait = Math.max(0, Math.min(DEBOUNCE_MS, MAX_WAIT_MS - (now - firstPending)))
  timer = setTimeout(() => void flush(), wait)
}

/**
 * Loads a project, read-only when another tab is writing it. A read-only tab then waits for that tab
 * to let go and reloads the latest saved version as writable (it could not have changed anything).
 */
function showProject(stored: StoredProject, locked: boolean): void {
  loadProject(stored.doc, stored.log, !locked, stored.workspace)
  initWorkspace(stored.doc, stored.workspace)
  savedWorkspace = ui.get().workspace
  if (!locked) void becomeWritableWhenFree(stored.doc.id)
}

async function becomeWritableWhenFree(id: string): Promise<void> {
  if (!(await waitForProjectLock(id))) return
  const s = useProjectStore.getState()
  if (s.doc.id !== id || !s.readOnly) return
  const loaded = await loadStored(id)
  if (loaded) {
    // The tabs and panes the user arranged while read-only stay as they are.
    const shown = ui.get().workspace
    replaceRawTables({ ...useDataStore.getState().rawTables, ...loaded.rawTables })
    loadProject(loaded.doc, loaded.log, false, loaded.workspace)
    initWorkspace(loaded.doc, shown)
  } else {
    setReadOnly(false)
  }
}

/** "Open as a copy" from a read-only tab: a new project id, with its own lock, saved like any project. */
export async function openAsCopy(name: string): Promise<void> {
  const s = useProjectStore.getState()
  const now = new Date().toISOString()
  const copy = { ...s.doc, id: newId<'ProjectId'>('prj') as ProjectId, name, createdAt: now, updatedAt: now }
  const locked = await acquireProjectLock(copy.id)
  // The copy opens with the plots laid out as they are on screen, and the log of what led to them.
  const shown = ui.get().workspace
  loadProject(copy, operationLog(s), !locked, shown)
  initWorkspace(copy, shown)
}

/** "Continue without autosave" after a quota error. */
export function disableAutosave(): void {
  disabled = true
}

/** Takes the lock of the project shown; read-only (until the other tab lets go) when another tab holds it. */
async function lockProject(id: string): Promise<void> {
  const locked = await acquireProjectLock(id)
  if (useProjectStore.getState().doc.id !== id) return
  setReadOnly(!locked)
  if (!locked) void becomeWritableWhenFree(id)
}

let started: Promise<void> | null = null

/**
 * Starts local persistence once per page (React's development mode runs effects twice; a second
 * start would race the first for the tab lock and leave this tab read-only).
 */
export function startPersistence(): Promise<void> {
  started ??= start()
  return started
}

/**
 * Probes storage, restores the most recent project (read-only if another tab holds it), then
 * autosaves every change (debounce 1 s, at most 5 s, flushed when the tab hides). The workspace sync
 * starts first, whether or not storage is available.
 */
async function start(): Promise<void> {
  startWorkspaceSync()
  const ok = await probeStorage()
  if (!ok) {
    ui.set({ storage: 'unavailable' })
    return
  }
  ui.set({ storage: 'ok' })
  const before = useProjectStore.getState().doc
  // Work started while the stored project is read (a paste, a dropped file, an example) is newer than
  // anything stored: it is never replaced by the restore.
  const untouched = () => useProjectStore.getState().doc === before
  let restored = false
  const list = await listProjects()
  if (list.ok && list.value.length && before.datasets.length === 0) {
    const latest = list.value[0]
    const loaded = await loadStored(latest.id)
    const locked = loaded && untouched() ? await acquireProjectLock(latest.id) : false
    if (loaded && untouched()) {
      replaceRawTables({ ...useDataStore.getState().rawTables, ...loaded.rawTables })
      showProject(loaded, locked)
      if (locked) void collectGarbage(loaded.doc)
      restored = true
    }
  }
  // The project this tab holds (or waits for) the lock of.
  let lastId = useProjectStore.getState().doc.id
  if (!restored) await lockProject(lastId)

  let lastDoc = useProjectStore.getState().doc
  useProjectStore.subscribe((s) => {
    if (s.doc === lastDoc) return
    lastDoc = s.doc
    if (s.doc.id !== lastId) {
      lastId = s.doc.id
      void lockProject(lastId)
    }
    schedule()
  })
  // A project opened while the lock above was requested (a dropped .sciplot) needs a lock of its own.
  if (lastDoc.id !== lastId) {
    lastId = lastDoc.id
    void lockProject(lastId)
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushOnHide()
  })
  window.addEventListener('pagehide', flushOnHide)
  // Changes made before the autosave listened (during the restore) are saved like any other.
  if (!restored && lastDoc.datasets.length > 0) schedule()
}

/** Open a stored project in this tab, once the current one is completely saved. */
export async function openStoredProject(id: string): Promise<boolean> {
  await flush()
  const loaded = await loadStored(id)
  if (!loaded) return false
  replaceRawTables({ ...useDataStore.getState().rawTables, ...loaded.rawTables })
  const locked = await acquireProjectLock(id)
  showProject(loaded, locked)
  ui.set({ selection: null, importNotice: null })
  ui.resetView()
  return true
}

export const flushAutosave = flush
