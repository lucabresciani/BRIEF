import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nProvider } from '@/i18n/I18nProvider'
import { makeTranslator } from '@/i18n/translate'
import { HelpPanel } from './HelpPanel'

const t = makeTranslator('en')

function onPlatform(platform: string) {
  Object.defineProperty(navigator, 'platform', { value: platform, configurable: true })
}

/** The keys listed for redo in the keyboard section, as one string ("⌘ ⇧ Z"). */
async function redoKeys(): Promise<string> {
  render(
    <I18nProvider lang="en">
      <HelpPanel />
    </I18nProvider>,
  )
  await userEvent.click(screen.getByRole('button', { name: t('help.keyboard') }))
  const term = screen.getByText(t('help.keys.redo')).previousElementSibling!
  return [...term.querySelectorAll('kbd')].map((k) => k.textContent).join(' ')
}

afterEach(() => {
  delete (navigator as unknown as Record<string, unknown>).platform
})

describe('the About section of the help panel', () => {
  async function openAbout(lang: 'en' | 'it') {
    render(
      <I18nProvider lang={lang}>
        <HelpPanel />
      </I18nProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: makeTranslator(lang)('help.about.title') }))
  }

  it('names the app, its version from package.json and the MIT licence', async () => {
    await openAbout('en')
    const { version } = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string }
    expect(screen.getByText('BRIEF')).toBeInTheDocument()
    expect(screen.getByText(`Version ${version}`)).toBeInTheDocument()
    expect(screen.getByText(/released under the MIT licence/)).toBeInTheDocument()
  })

  it('links the source repository of package.json and the licences of the build, in new tabs', async () => {
    await openAbout('en')
    const { repository } = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
      repository: { url: string }
    }
    const source = screen.getByRole('link', { name: 'Source code on GitHub (opens in a new tab)' })
    expect(source).toHaveAttribute('href', repository.url.replace(/^git\+/, '').replace(/\.git$/, ''))
    expect(source.getAttribute('href')).toMatch(/^https:\/\/github\.com\/[^/]+\/[^/]+$/)
    const licences = screen.getByRole('link', { name: 'Third-party licences (opens in a new tab)' })
    expect(licences).toHaveAttribute('href', '/THIRD_PARTY_LICENSES.md')
    for (const link of [source, licences]) {
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    }
  })

  it('credits the author, with his website, profiles and contact page in new tabs and no e-mail address', async () => {
    await openAbout('en')
    expect(screen.getByRole('heading', { name: 'Created by Luca Bresciani' })).toBeInTheDocument()
    expect(screen.getByText(/^Aerospace engineering student/)).toBeInTheDocument()
    const credits: [name: string, text: string, href: string][] = [
      ['Luca Bresciani’s website', 'Website', 'https://luca-bresciani.com'],
      ['Luca Bresciani on GitHub', 'GitHub', 'https://github.com/lucabresciani'],
      ['Luca Bresciani on LinkedIn', 'LinkedIn', 'https://linkedin.com/in/luca-bresciani-62a1313a3'],
      ['Luca Bresciani on X', 'X', 'https://x.com/bresciani_aero'],
      ['Luca Bresciani on Instagram', 'Instagram', 'https://www.instagram.com/_luca_bresciani/'],
      ['Contact Luca Bresciani', 'Contact', 'https://luca-bresciani.com/contact'],
    ]
    for (const [name, text, href] of credits) {
      const link = screen.getByRole('link', { name: `${name} (opens in a new tab)` })
      expect(link).toHaveAttribute('href', href)
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
      // The visible text is part of the accessible name, so voice control can use it.
      expect(link).toHaveTextContent(text)
      expect(name.toLowerCase()).toContain(text.toLowerCase())
    }
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href') ?? '')
    expect(hrefs.filter((h) => h.startsWith('mailto:'))).toEqual([])
  })

  it('is translated', async () => {
    await openAbout('it')
    expect(screen.getByText(/distribuito con licenza MIT/)).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Licenze di terze parti (si apre in una nuova scheda)' }),
    ).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Creato da Luca Bresciani' })).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Luca Bresciani su GitHub (si apre in una nuova scheda)' }),
    ).toHaveAttribute('href', 'https://github.com/lucabresciani')
    expect(
      screen.getByRole('link', {
        name: 'Pagina dei contatti di Luca Bresciani (si apre in una nuova scheda)',
      }),
    ).toHaveTextContent('Contatti')
  })
})

describe('the keyboard shortcuts in the help panel', () => {
  it('on a Mac, redo is ⌘⇧Z (⌘Y does nothing there)', async () => {
    onPlatform('MacIntel')
    expect(await redoKeys()).toBe('⌘ ⇧ Z')
  })

  it('elsewhere, redo is Ctrl+Y', async () => {
    onPlatform('Win32')
    expect(await redoKeys()).toBe('Ctrl Y')
  })
})
