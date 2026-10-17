import { useState } from 'react'
import { asRowId, type ExclusionReason } from '@/domain/model'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Choice } from '@/components/app/Choice'
import { useT } from '@/i18n/I18nProvider'
import { useDerived } from '@/state/derived'
import { useProjectStore } from '@/state/projectStore'
import { ui, useUiStore } from '@/state/uiStore'
import { excludeRows } from '@/state/actions/analysis'
import { recordsText } from '@/lib/rowLabel'

const REASONS: ExclusionReason[] = ['measurement-problem', 'outlier-candidate', 'out-of-scope', 'other']

/** States the scope (all series of the dataset) and asks why; an outlier candidate needs a note. */
export function ExclusionDialog() {
  const t = useT()
  const open = useUiStore((s) => s.dialog === 'exclusion')
  const selection = useUiStore((s) => s.selection)
  const derived = useDerived()
  const datasets = useProjectStore((s) => s.doc.datasets)
  const exclusions = useProjectStore((s) => s.doc.exclusions)
  const plots = useProjectStore((s) => s.doc.plots)
  const [reason, setReason] = useState<ExclusionReason>('measurement-problem')
  const [note, setNote] = useState('')
  const [triedSubmit, setTriedSubmit] = useState(false)
  const dataset = datasets.find((d) => d.id === selection?.datasetId)
  const view = dataset ? derived.views.get(dataset.id) : undefined
  const already = new Set<number>(
    exclusions.filter((e) => e.datasetId === dataset?.id).flatMap((e) => e.rowIds),
  )
  const rows = selection ? [...selection.rowIds].filter((r) => !already.has(r)).sort((a, b) => a - b) : []
  // As the table shows them: rows of the file, sheet columns of a transposed table, and in a stacked
  // dataset the table each row came from (the same row number occurs in each).
  const records = view ? recordsText(t, view, rows) : rows.map((r) => r + 1).join(', ')
  // Every plot of the dataset is concerned: exclusions belong to the dataset.
  const seriesCount = plots.flatMap((p) => p.series).filter((s) => s.datasetId === dataset?.id).length
  const noteMissing = reason === 'outlier-candidate' && !note.trim()

  const close = () => {
    ui.closeDialog()
    setNote('')
    setTriedSubmit(false)
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('exclusion.title')}</DialogTitle>
          <DialogDescription>
            {t('exclusion.scope', {
              records,
              series: Math.max(1, seriesCount),
              dataset: dataset?.name ?? '',
            })}
          </DialogDescription>
        </DialogHeader>
        <Choice<ExclusionReason>
          label={t('exclusion.reason')}
          value={reason}
          onChange={setReason}
          items={REASONS.map((r) => ({ value: r, label: t(`exclusion.reasons.${r}`) }))}
        />
        {reason === 'outlier-candidate' ? (
          <p className="text-xs text-warning">{t('exclusion.outlierWarning')}</p>
        ) : null}
        <div className="flex flex-col gap-1">
          <label htmlFor="exclusion-note" className="text-xs text-muted-foreground">
            {t('exclusion.note')}
          </label>
          <Textarea
            id="exclusion-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('exclusion.notePlaceholder')}
            aria-invalid={triedSubmit && noteMissing ? true : undefined}
            aria-describedby={triedSubmit && noteMissing ? 'exclusion-note-err' : undefined}
            className="min-h-20 bg-background"
          />
          {triedSubmit && noteMissing ? (
            <p id="exclusion-note-err" className="text-xs text-destructive" role="alert">
              {t('issues.E_EXCLUSION_NOTE_REQUIRED.title')}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button
            size="sm"
            disabled={!rows.length || !dataset}
            onClick={() => {
              setTriedSubmit(true)
              if (noteMissing || !dataset) return
              excludeRows(dataset.id, rows.map(asRowId), reason, note)
              ui.clearSelection()
              close()
            }}
            data-testid="confirm-exclusion"
          >
            {t('exclusion.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
