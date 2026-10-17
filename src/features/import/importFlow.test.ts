import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { issue } from '@/domain/model'
import { issueTitle, makeTranslator } from '@/i18n/translate'
import { emptyProject, loadProject, useProjectStore } from '@/state/projectStore'
import { openProjectFile } from './importFlow'

const toasts = vi.hoisted(() => [] as { title: string; type?: string }[])
vi.mock('@/components/ui/toast', () => ({
  toast: { add: (t: { title: string; type?: string }) => void toasts.push(t) },
}))

const t = makeTranslator('en')

/** A chosen .sciplot file (only name and text() are read). */
function file(name: string): File {
  const text = readFileSync(resolve('tests/fixtures/projects', name), 'utf8')
  return { name, text: async () => text } as unknown as File
}

beforeEach(() => {
  toasts.length = 0
  loadProject(emptyProject('Before'))
})

describe('openProjectFile: notices of an opened project', () => {
  it('a v1 file: the migration is an info toast, a repair stays a warning', async () => {
    await openProjectFile(t, file('broken-refs.sciplot'))
    expect(toasts.map((x) => [x.type, x.title])).toEqual([
      ['success', t('project.opened', { name: 'broken-refs.sciplot' })],
      ['info', issueTitle(t, issue('I_PROJECT_MIGRATED', { from: 1, to: 2 }))],
      ['warning', issueTitle(t, issue('W_PROJECT_REPAIRED', { count: 11 }))],
    ])
  })

  it('a v2 file: no notice, and its workspace is kept next to the project', async () => {
    await openProjectFile(t, file('v2-multiplot.sciplot'))
    expect(toasts.map((x) => x.type)).toEqual(['success'])
    const s = useProjectStore.getState()
    expect(s.doc.plots).toHaveLength(2)
    expect(s.loadedWorkspace).toEqual({ layout: 'columns', panes: s.doc.plots.map((p) => p.id), focused: 1 })
  })
})
