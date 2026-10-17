import { Ban, RotateCcw, X } from 'lucide-react'
import { asRowId, type RowId } from '@/domain/model'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/I18nProvider'
import { useProjectStore } from '@/state/projectStore'
import { ui, useUiStore } from '@/state/uiStore'
import { restoreAll, restoreRows } from '@/state/actions/analysis'

/** Actions on the current selection: exclude (non-destructive, with a reason), restore, clear. */
export function ExclusionBar() {
  const t = useT()
  const selection = useUiStore((s) => s.selection)
  const exclusions = useProjectStore((s) => s.doc.exclusions)
  const readOnly = useProjectStore((s) => s.readOnly)
  const datasetId = selection?.datasetId ?? null
  const excluded = new Set<number>(
    exclusions.filter((e) => e.datasetId === datasetId).flatMap((e) => e.rowIds),
  )
  const totalExcluded = excluded.size
  if (!selection && totalExcluded === 0) return null

  const selected = selection ? [...selection.rowIds] : []
  const selectedExcluded = selected.filter((r) => excluded.has(r))
  const selectedActive = selected.filter((r) => !excluded.has(r))

  return (
    <section
      className="flex min-h-10 flex-wrap items-center gap-2 border-t border-border bg-panel px-2.5 py-1.5"
      aria-label={t('exclusion.title')}
    >
      {selection ? (
        <>
          <span className="num text-xs font-medium" aria-live="polite">
            {t('table.selected', { n: selected.length })}
          </span>
          <Button
            size="sm"
            variant="outline"
            className="bg-background"
            disabled={!selectedActive.length || readOnly}
            onClick={() => ui.openDialog('exclusion')}
          >
            <Ban aria-hidden />
            {t('table.exclude')}
          </Button>
          {selectedExcluded.length ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={readOnly}
              onClick={() =>
                datasetId && restoreRows(datasetId, selectedExcluded.map((r) => asRowId(r)) as RowId[])
              }
            >
              <RotateCcw aria-hidden />
              {t('table.restore')}
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => ui.clearSelection()}>
            <X aria-hidden />
            {t('table.clearSelection')}
          </Button>
        </>
      ) : null}
      {totalExcluded > 0 && datasetId ? (
        <span className="num ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          {t('exclusion.summary', { n: totalExcluded })}
          <Button size="xs" variant="ghost" disabled={readOnly} onClick={() => restoreAll(datasetId)}>
            {t('table.restoreAll')}
          </Button>
        </span>
      ) : null}
    </section>
  )
}
