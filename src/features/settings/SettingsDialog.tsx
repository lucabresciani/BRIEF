import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Choice } from '@/components/app/Choice'
import { SwitchRow } from '@/components/app/SwitchRow'
import { useI18n } from '@/i18n/I18nProvider'
import { formatMegabytes } from '@/i18n/locale'
import { useProjectStore } from '@/state/projectStore'
import { ui, useUiStore, type Level } from '@/state/uiStore'
import { setNumberFormat } from '@/state/actions/project'
import { storageEstimate } from '@/platform/storage'

export function SettingsDialog() {
  const { t, lang } = useI18n()
  const open = useUiStore((s) => s.dialog === 'settings')
  const hints = useUiStore((s) => s.hints)
  const level = useUiStore((s) => s.level)
  const numberFormat = useProjectStore((s) => s.doc.numberFormat.decimal)
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null)
  useEffect(() => {
    if (open) void storageEstimate().then(setUsage)
  }, [open])
  const mb = (b: number) => formatMegabytes(b, lang)
  return (
    <Dialog open={open} onOpenChange={(o) => !o && ui.closeDialog()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('settings.title')}</DialogTitle>
        </DialogHeader>
        <Choice<Level>
          label={t('settings.level')}
          value={level}
          onChange={(v) => ui.set({ level: v })}
          items={(['beginner', 'intermediate', 'advanced'] as const).map((l) => ({
            value: l,
            label: t(`level.${l}`),
            hint: t(`level.${l}Hint`),
          }))}
        />
        <Choice<'auto' | 'dot' | 'comma'>
          label={t('settings.numberFormat')}
          value={numberFormat}
          onChange={setNumberFormat}
          items={(['auto', 'dot', 'comma'] as const).map((v) => ({
            value: v,
            label: t(`settings.numberFormats.${v}`),
          }))}
        />
        <SwitchRow label={t('settings.hints')} checked={hints} onChange={(v) => ui.set({ hints: v })} />
        <div>
          <p className="text-xs text-muted-foreground">{t('settings.storage')}</p>
          <p className="text-sm">
            {usage
              ? t('settings.storageUsage', { used: mb(usage.used), quota: mb(usage.quota) })
              : t('settings.storageUnknown')}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
