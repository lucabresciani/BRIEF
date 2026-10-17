import { afterEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nProvider, useI18n } from './I18nProvider'

function LanguageProbe() {
  const { t, setLang } = useI18n()
  return (
    <button type="button" onClick={() => setLang('en')}>
      {t('common.close')}
    </button>
  )
}

afterEach(() => localStorage.clear())

describe('the interface language chosen in the former version (key "sde.lang")', () => {
  it('is kept, and saved under the current key from then on', async () => {
    localStorage.setItem('sde.lang', 'it')
    render(
      <I18nProvider>
        <LanguageProbe />
      </I18nProvider>,
    )
    expect(document.documentElement.lang).toBe('it')
    expect(localStorage.getItem('brief.lang')).toBe('it')
    expect(localStorage.getItem('sde.lang')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Chiudi' }))
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
    expect(localStorage.getItem('brief.lang')).toBe('en')
  })
})
