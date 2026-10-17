import { beforeEach, describe, expect, it } from 'vitest'
import type { OperationLogEntry } from '@/domain/model'
import { commit, emptyProject, loadProject, operationLog, redo, undo, useProjectStore } from './projectStore'

const LOADED: OperationLogEntry = {
  id: 'op_loaded',
  at: '2026-01-01T00:00:00.000Z',
  op: 'project.rename',
  label: { key: 'history.ops.project.rename' },
  datasetId: null,
  plotId: null,
}

/** One undoable step per call, never merged with the previous one. */
const rename = (i: number) =>
  commit('project.rename', (d) => {
    d.name = `name ${i}`
  })

beforeEach(() => loadProject(emptyProject(''), [LOADED]))

describe('the operation log of a long session', () => {
  it('keeps every operation, also the ones beyond the 200 undo steps', () => {
    for (let i = 0; i < 205; i++) rename(i)
    const s = useProjectStore.getState()
    expect(s.past).toHaveLength(200)
    const log = operationLog()
    expect(log).toHaveLength(1 + 205)
    expect(log[0]).toEqual(LOADED)
    expect(new Set(log.map((e) => e.id)).size).toBe(206)
  })

  it('undo and redo still take operations out of the log and put them back', () => {
    for (let i = 0; i < 203; i++) rename(i)
    const before = operationLog()
    undo()
    undo()
    expect(operationLog()).toEqual(before.slice(0, -2))
    redo()
    expect(operationLog()).toEqual(before.slice(0, -1))
    // A new operation drops the undone one for good.
    rename(999)
    expect(operationLog()).toHaveLength(before.length)
    expect(operationLog().at(-2)).toEqual(before.at(-2))
  })

  it('opening another project starts its own log', () => {
    for (let i = 0; i < 202; i++) rename(i)
    loadProject(emptyProject('next'))
    expect(operationLog()).toEqual([])
  })
})
