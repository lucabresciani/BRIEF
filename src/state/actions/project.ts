import { importText } from '@/domain/import/importPipeline'
import type { ExampleId, ProjectDoc } from '@/domain/model'
import type { OpenedProject } from '@/workers/protocol'
import { EXAMPLES } from '@/examples'
import { getRawTables, replaceRawTables } from '../dataStore'
import { commit, emptyProject, loadProject, operationLog, useProjectStore } from '../projectStore'
import { ui } from '../uiStore'
import { initWorkspace, projectForSave } from '../workspace'
import { importDraft } from './dataset'

/** The version in package.json, written into saved projects and shown in the help panel. */
export const APP_VERSION = __APP_VERSION__

export function renameProject(name: string): void {
  commit(
    'project.rename',
    (d) => {
      d.name = name
    },
    { params: { name }, coalesceKey: 'project.rename' },
  )
}

export function setNumberFormat(decimal: ProjectDoc['numberFormat']['decimal']): void {
  commit('project.settings', (d) => {
    d.numberFormat.decimal = decimal
  })
}

export function newProject(): void {
  const doc = emptyProject()
  loadProject(doc)
  initWorkspace(doc)
  ui.set({ selection: null, importNotice: null, dismissedRecommendations: [], walkthrough: null })
  ui.resetView()
}

export function openProject(opened: OpenedProject): void {
  replaceRawTables({ ...getRawTables(), ...opened.rawTables })
  loadProject(opened.doc, opened.log, false, opened.workspace)
  initWorkspace(opened.doc, opened.workspace)
  ui.set({ selection: null, importNotice: null, walkthrough: null })
  ui.resetView()
}

/**
 * The complete, versioned project file (raw data + analysis settings + operation log), with the plots
 * laid out as they are on screen and the active plot.
 */
export async function currentProjectFile(): Promise<string> {
  // The project module (with its zod schema) is loaded only when a file is written.
  const { serializeProject } = await import('@/domain/project/serialize')
  const s = useProjectStore.getState()
  const { doc, workspace } = projectForSave(s.doc)
  return serializeProject(doc, getRawTables(), operationLog(s), APP_VERSION, undefined, { workspace })
}

/** Loads a bundled example (marked as simulated data). Examples are small: parsed on the main thread. */
export function loadExample(id: ExampleId, name: string): boolean {
  const ex = EXAMPLES.find((e) => e.id === id)
  if (!ex) return false
  const r = importText(ex.csv, { kind: 'example', fileName: ex.fileName })
  if (!r.ok) return false
  importDraft(r.value, { name, example: id })
  return true
}
