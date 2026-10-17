import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { issue } from '@/domain/model'
import { I18nProvider } from '@/i18n/I18nProvider'
import { issueTitle, makeTranslator } from '@/i18n/translate'
import { AreaError } from './AreaError'

vi.mock('@/state/actions/project', () => ({
  currentProjectFile: () => Promise.reject(new Error('cannot serialise')),
}))
const download = vi.hoisted(() => vi.fn())
vi.mock('@/platform/download', () => ({ downloadText: download }))
const toasts = vi.hoisted(() => [] as { title: string; type?: string }[])
vi.mock('@/components/ui/toast', () => ({
  toast: { add: (x: (typeof toasts)[number]) => void toasts.push(x) },
}))

const t = makeTranslator('en')

describe('the fallback of an area that crashed', () => {
  it('a project download that fails says so', async () => {
    render(
      <I18nProvider lang="en">
        <AreaError reset={() => undefined} error={new Error('render failed')} />
      </I18nProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: t('errors.downloadProject') }))
    await waitFor(() =>
      expect(toasts).toEqual([
        { title: issueTitle(t, issue('E_EXPORT_FAILED', { reason: 'cannot serialise' })), type: 'error' },
      ]),
    )
    expect(download).not.toHaveBeenCalled()
  })
})
