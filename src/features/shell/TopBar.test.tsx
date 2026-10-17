import { afterEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { I18nProvider } from '@/i18n/I18nProvider'
import { makeTranslator } from '@/i18n/translate'
import { TopBar } from './TopBar'

const t = makeTranslator('en')

function onPlatform(platform: string) {
  Object.defineProperty(navigator, 'platform', { value: platform, configurable: true })
}

function renderTopBar() {
  render(
    <I18nProvider lang="en">
      <TopBar />
    </I18nProvider>,
  )
}

afterEach(() => {
  // Back to jsdom's own value (an own property shadows the prototype getter).
  delete (navigator as unknown as Record<string, unknown>).platform
})

describe('undo and redo buttons', () => {
  it('on a Mac, redo advertises ⌘⇧Z, the shortcut that redoes there', () => {
    onPlatform('MacIntel')
    renderTopBar()
    expect(screen.getByRole('button', { name: t('topbar.nothingToRedo') })).toHaveAttribute(
      'aria-keyshortcuts',
      'Meta+Shift+Z',
    )
    expect(screen.getByRole('button', { name: t('topbar.nothingToUndo') })).toHaveAttribute(
      'aria-keyshortcuts',
      'Meta+Z',
    )
  })

  it('elsewhere, redo advertises Ctrl+Y', () => {
    onPlatform('Win32')
    renderTopBar()
    expect(screen.getByRole('button', { name: t('topbar.nothingToRedo') })).toHaveAttribute(
      'aria-keyshortcuts',
      'Control+Y',
    )
  })
})
