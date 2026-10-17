import { beforeEach, describe, expect, it, vi } from 'vitest'
import { issue } from '@/domain/model'
import { LIMITS } from '@/domain/import/limits'
import { issueTitle, makeTranslator } from '@/i18n/translate'
import { saveProjectFile } from './projectFile'

const file = vi.hoisted(() => ({ text: '' }))
vi.mock('@/state/actions/project', () => ({ currentProjectFile: async () => file.text }))
// The written file is valid: only its size is under test.
vi.mock('@/domain/project/deserialize', () => ({ deserializeProject: () => ({ ok: true }) }))
vi.mock('@/platform/download', () => ({ downloadText: () => undefined }))
const toasts = vi.hoisted(() => [] as { title: string; type?: string }[])
vi.mock('@/components/ui/toast', () => ({
  toast: { add: (x: (typeof toasts)[number]) => void toasts.push(x) },
}))

const t = makeTranslator('en')

beforeEach(() => {
  toasts.length = 0
})

describe('saving the project file', () => {
  it('warns when the file is larger than a project that can be reopened (UTF-8 bytes, not characters)', async () => {
    // 35 M characters of 3 UTF-8 bytes each: 105 MB written, over the 100 MiB a project may have.
    file.text = '€'.repeat(35_000_000)
    await saveProjectFile(t)
    const limit = Math.round((LIMITS.maxProjectBytes / 2 ** 20) * 10) / 10
    expect(toasts.map((x) => x.type)).toEqual(['warning', 'success'])
    expect(toasts[0]!.title).toBe(
      issueTitle(t, issue('W_PROJECT_TOO_LARGE_TO_REOPEN', { size: 100.1, limit })),
    )
  })

  it('a file that reopens: only the success notice', async () => {
    file.text = '{"format":"sciplot"}'
    await saveProjectFile(t)
    expect(toasts.map((x) => x.type)).toEqual(['success'])
  })
})
