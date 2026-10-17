import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useConfirmStore } from '@/components/app/confirmStore'
import { I18nProvider } from '@/i18n/I18nProvider'
import { makeTranslator } from '@/i18n/translate'
import { emptyProject, loadProject } from '@/state/projectStore'
import { ui } from '@/state/uiStore'
import { ProjectsDialog } from './ProjectsDialog'

const storage = vi.hoisted(() => ({ listProjects: vi.fn(), deleteProject: vi.fn() }))
vi.mock('@/platform/storage', async (orig) => ({ ...(await orig<object>()), ...storage }))
const toasts = vi.hoisted(() => [] as { title: string; description?: string; type?: string }[])
vi.mock('@/components/ui/toast', () => ({
  toast: { add: (x: (typeof toasts)[number]) => void toasts.push(x) },
}))

/** Web Locks where other tabs hold the given lock names. */
function locksHeldElsewhere(...names: string[]) {
  const held = new Set(names)
  return {
    request: async (name: string, _opts: { ifAvailable?: boolean }, cb: (l: object | null) => unknown) =>
      cb(held.has(name) ? null : { name }),
  }
}
function stubLocks(locks: unknown) {
  Object.defineProperty(navigator, 'locks', { value: locks, configurable: true })
}

const t = makeTranslator('en')
const OTHER = { id: 'prj_other', name: 'Pendulum', updatedAt: '2026-01-01T00:00:00.000Z', datasets: 1 }

function openDialog() {
  ui.openDialog('projects')
  render(
    <I18nProvider lang="en">
      <ProjectsDialog />
    </I18nProvider>,
  )
}
/** Answers the in-app confirmation as soon as it is asked. */
function answerConfirm(ok: boolean) {
  return useConfirmStore.subscribe((s) => s.req?.resolve(ok))
}

beforeEach(() => {
  toasts.length = 0
  loadProject(emptyProject('Current'))
  storage.listProjects.mockReset().mockResolvedValue({ ok: true, value: [OTHER] })
  storage.deleteProject.mockReset().mockResolvedValue({ ok: true, value: undefined })
})
afterEach(() => {
  stubLocks(undefined)
  ui.closeDialog()
})

describe('deleting a stored project', () => {
  it('is refused while another tab has the project open, with an explanation', async () => {
    stubLocks(locksHeldElsewhere('brief:project:prj_other'))
    const stop = answerConfirm(true)
    openDialog()
    await userEvent.click(await screen.findByRole('button', { name: t('project.delete') }))
    await waitFor(() => expect(toasts).toHaveLength(1))
    stop()
    expect(storage.deleteProject).not.toHaveBeenCalled()
    expect(toasts[0]).toEqual({
      title: t('project.openElsewhere', { name: 'Pendulum' }),
      description: t('project.openElsewhereHint'),
      type: 'warning',
    })
  })

  it('goes ahead once confirmed when no other tab holds it', async () => {
    stubLocks(locksHeldElsewhere())
    const stop = answerConfirm(true)
    openDialog()
    await userEvent.click(await screen.findByRole('button', { name: t('project.delete') }))
    await waitFor(() => expect(storage.deleteProject).toHaveBeenCalledWith('prj_other'))
    stop()
    expect(toasts).toEqual([])
  })
})
