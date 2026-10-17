import { Activity, Thermometer, Timer, Zap, FlaskConical } from 'lucide-react'
import type { ExampleId } from '@/domain/model'
import { EXAMPLES } from '@/examples'
import { useT } from '@/i18n/I18nProvider'
import { loadExample } from '@/state/actions/project'
import { ui } from '@/state/uiStore'

const ICONS: Record<ExampleId, typeof Activity> = {
  'free-fall': Activity,
  ohm: Zap,
  cooling: Thermometer,
  'beer-lambert': FlaskConical,
  pendulum: Timer,
}

/** The five bundled examples; loading one is a single click and an undoable import. */
export function ExampleList({ onLoaded }: { onLoaded?: () => void }) {
  const t = useT()
  return (
    <ul className="flex flex-col gap-1" aria-label={t('examples.title')}>
      {EXAMPLES.map((ex) => {
        const Icon = ICONS[ex.id]
        return (
          <li key={ex.id}>
            <button
              type="button"
              data-example={ex.id}
              className="flex w-full items-start gap-3 rounded-md px-2.5 py-2 text-left transition-colors duration-(--dur-press) hover:bg-accent"
              onClick={() => {
                if (loadExample(ex.id, t(`examples.${ex.id}.name`))) {
                  if (ex.walkthrough) ui.set({ walkthrough: null })
                  onLoaded?.()
                }
              }}
            >
              <Icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{t(`examples.${ex.id}.name`)}</span>
                <span className="block text-xs text-muted-foreground">{t(`examples.${ex.id}.desc`)}</span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
