import type { ReactNode } from 'react'
import { BookOpen, ExternalLink, PlayCircle, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SwitchRow } from '@/components/app/SwitchRow'
import { Section } from '@/components/app/Section'
import { Kbd } from '@/components/ui/kbd'
import { useT } from '@/i18n/I18nProvider'
import { ui, useUiStore } from '@/state/uiStore'
import { APP_VERSION, loadExample } from '@/state/actions/project'
import { isMac, modKeyLabel } from '@/platform/shortcuts'

/** Written next to index.html by the production build (build.license in vite.config.ts). */
const LICENSES_URL = `${import.meta.env.BASE_URL}THIRD_PARTY_LICENSES.md`

const TOPICS = ['scatter', 'fit', 'residuals', 'errorBars', 'log', 'groups', 'exclusions', 'privacy'] as const
const METHODS = [
  'sd',
  'quartiles',
  'whiskers',
  'bins',
  'ci',
  'bands',
  'rounding',
  'ols',
  'loglinear',
  'tests',
] as const

/** Short, optional explanations; the app stays fully usable with hints turned off. */
export function HelpPanel() {
  const t = useT()
  const hints = useUiStore((s) => s.hints)
  const mod = modKeyLabel()
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-3">
        <h2 className="text-sm font-semibold">{t('help.title')}</h2>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={t('common.close')}
          onClick={() => ui.set({ helpOpen: false })}
        >
          <X aria-hidden />
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <Section title={t('help.title')}>
          <p className="text-xs text-muted-foreground">{t('help.lead')}</p>
          <SwitchRow label={t('help.hintsToggle')} checked={hints} onChange={(v) => ui.set({ hints: v })} />
        </Section>
        <Section title={t('help.walkthroughs')}>
          {(['ohm', 'freeFall'] as const).map((id) => (
            <Button
              key={id}
              size="sm"
              variant="outline"
              className="justify-start bg-background"
              onClick={() => {
                const exampleId = id === 'ohm' ? 'ohm' : 'free-fall'
                if (loadExample(exampleId, t(`examples.${exampleId}.name`)))
                  ui.set({ walkthrough: { id, step: 0 } })
              }}
            >
              <PlayCircle aria-hidden />
              {t(`walkthrough.${id}.title`)}
            </Button>
          ))}
        </Section>
        {TOPICS.map((k) => (
          <Section key={k} title={t(`help.topics.${k}.title`)} collapsible defaultOpen={false}>
            <p className="text-sm leading-relaxed">{t(`help.topics.${k}.body`)}</p>
          </Section>
        ))}
        <Section title={t('help.methods')} collapsible defaultOpen={false}>
          <ul className="flex flex-col gap-2 text-sm leading-relaxed">
            {METHODS.map((m) => (
              <li key={m} className="flex gap-2">
                <BookOpen className="mt-1 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span>{t(`help.methodsBody.${m}`)}</span>
              </li>
            ))}
          </ul>
        </Section>
        <Section title={t('help.keyboard')} collapsible defaultOpen={false}>
          <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-sm">
            <dt>
              <Kbd>{mod}</Kbd> <Kbd>Z</Kbd>
            </dt>
            <dd>{t('help.keys.undo')}</dd>
            <dt>
              {/* ⌘Y does nothing on Apple systems: redo is ⌘⇧Z there, as the top bar shows. */}
              {isMac() ? (
                <>
                  <Kbd>{mod}</Kbd> <Kbd>⇧</Kbd> <Kbd>Z</Kbd>
                </>
              ) : (
                <>
                  <Kbd>{mod}</Kbd> <Kbd>Y</Kbd>
                </>
              )}
            </dt>
            <dd>{t('help.keys.redo')}</dd>
            <dt>
              <Kbd>{mod}</Kbd> <Kbd>V</Kbd>
            </dt>
            <dd>{t('help.keys.paste')}</dd>
          </dl>
          <p className="text-xs text-muted-foreground">{t('help.keys.zoom')}</p>
        </Section>
        <Section title={t('help.about.title')} collapsible defaultOpen={false}>
          <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="font-medium tracking-wide" translate="no">
              {t('app.name')}
            </span>
            <span className="num text-xs whitespace-nowrap text-muted-foreground">
              {t('help.about.version', { version: APP_VERSION })}
            </span>
          </p>
          <p className="text-sm leading-relaxed">{t('help.about.licence')}</p>
          <ul className="flex flex-col gap-1 text-sm">
            <li>
              <NewTabLink href={__APP_REPOSITORY__}>{t('help.about.source')}</NewTabLink>
            </li>
            <li>
              <NewTabLink href={LICENSES_URL}>{t('help.about.thirdParty')}</NewTabLink>
            </li>
          </ul>
          <Credits />
        </Section>
      </ScrollArea>
    </div>
  )
}

const AUTHOR = 'Luca Bresciani'
const WEBSITE = 'https://luca-bresciani.com'
/** Profiles are named after their service, the same in every language. */
const PROFILES = [
  ['GitHub', 'https://github.com/lucabresciani'],
  ['LinkedIn', 'https://linkedin.com/in/luca-bresciani-62a1313a3'],
  ['X', 'https://x.com/bresciani_aero'],
  ['Instagram', 'https://www.instagram.com/_luca_bresciani/'],
] as const

/** The author, with the links of luca-bresciani.com. No e-mail address: the contact page offers one. */
function Credits() {
  const t = useT()
  return (
    <div className="flex flex-col gap-1">
      <h4 className="text-sm font-medium">{t('help.about.credits.createdBy', { name: AUTHOR })}</h4>
      <p className="text-xs leading-relaxed text-muted-foreground">{t('help.about.credits.bio')}</p>
      <ul className="flex flex-wrap gap-x-3 text-sm">
        <li>
          <NewTabLink href={WEBSITE} name={t('help.about.credits.websiteName', { name: AUTHOR })}>
            {t('help.about.credits.website')}
          </NewTabLink>
        </li>
        {PROFILES.map(([service, href]) => (
          <li key={service}>
            <NewTabLink href={href} name={t('help.about.credits.profileName', { name: AUTHOR, service })}>
              {service}
            </NewTabLink>
          </li>
        ))}
        <li>
          <NewTabLink
            href={`${WEBSITE}/contact`}
            name={t('help.about.credits.contactName', { name: AUTHOR })}
          >
            {t('help.about.credits.contact')}
          </NewTabLink>
        </li>
      </ul>
    </div>
  )
}

/**
 * Opens in a new tab, so the analysis on screen stays where it is; screen readers are told so.
 * `name` gives a link more context than its visible text ("GitHub" alone is ambiguous in a list of
 * links), and contains that text, so voice control can still call it by what it shows.
 */
function NewTabLink({ href, name, children }: { href: string; name?: string; children: ReactNode }) {
  const t = useT()
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={name ? `${name} ${t('help.about.newTab')}` : undefined}
      className="inline-flex min-h-6 items-center gap-1 rounded-sm text-primary underline-offset-2 hover:underline"
    >
      {children}
      <ExternalLink className="size-3.5 shrink-0" aria-hidden />
      {/* Keeps the name from reading "GitHub(opens…"; white space alone is no flex item, so no room. */}{' '}
      <span className="sr-only">{t('help.about.newTab')}</span>
    </a>
  )
}
