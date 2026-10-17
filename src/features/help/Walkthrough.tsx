import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n/I18nProvider'
import { tList } from '@/i18n/translate'
import { ui, useUiStore, type InspectorTab } from '@/state/uiStore'

/** Which inspector tab each step refers to (opened when the step is shown). */
const STEP_TABS: Record<'ohm' | 'freeFall', (InspectorTab | null)[]> = {
  ohm: ['plot', 'fit', 'fit', 'fit', null],
  freeFall: ['plot', 'uncertainty', 'fit', 'fit', 'fit'],
}

/** A short guided example over the real app (no separate lesson engine). */
export function Walkthrough() {
  const { t, lang } = useI18n()
  const wt = useUiStore((s) => s.walkthrough)
  if (!wt) return null
  const steps = tList(lang, `walkthrough.${wt.id}.steps`)
  const go = (step: number) => {
    const tab = STEP_TABS[wt.id][step]
    ui.set({
      walkthrough: { ...wt, step },
      ...(tab ? { inspectorTab: tab } : {}),
      ...(ui.get().level === 'beginner' ? { level: 'intermediate' as const } : {}),
    })
  }
  return (
    <div
      className="fixed right-4 bottom-4 z-(--z-overlay) w-[min(24rem,calc(100vw-2rem))] rounded-lg border border-border bg-popover p-3 shadow-popover"
      role="dialog"
      aria-labelledby="walkthrough-title"
      aria-modal="false"
      onKeyDown={(e) => {
        if (e.key === 'Escape') ui.set({ walkthrough: null })
      }}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 id="walkthrough-title" className="text-sm font-semibold">
          {t(`walkthrough.${wt.id}.title`)}
        </h2>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={t('common.close')}
          onClick={() => ui.set({ walkthrough: null })}
        >
          <X aria-hidden />
        </Button>
      </div>
      {/* Step counter and text are announced together when the step changes. */}
      <div aria-live="polite">
        <p className="mb-1 text-xs text-muted-foreground">
          {t('help.walkthroughStep', { n: wt.step + 1, total: steps.length })}
        </p>
        <p className="text-sm leading-relaxed">{steps[wt.step]}</p>
      </div>
      <div className="mt-3 flex justify-between gap-2">
        <Button size="sm" variant="ghost" disabled={wt.step === 0} onClick={() => go(wt.step - 1)}>
          {t('help.walkthroughBack')}
        </Button>
        {wt.step < steps.length - 1 ? (
          <Button size="sm" onClick={() => go(wt.step + 1)}>
            {t('help.walkthroughNext')}
          </Button>
        ) : (
          <Button size="sm" onClick={() => ui.set({ walkthrough: null })}>
            {t('help.walkthroughFinish')}
          </Button>
        )}
      </div>
    </div>
  )
}
