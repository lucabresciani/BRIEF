import { useState } from 'react'
import { FileImage, FileSpreadsheet } from 'lucide-react'
import { buildFigure } from '@/domain/figure/buildFigure'
import { analysisCsv, CSV_PRESETS, originalCsv, splitForCsv } from '@/domain/export/csv'
import { figureFileBase, safeFileName } from '@/domain/export/filename'
import { predict } from '@/domain/fit/band'
import { issue, type DatasetId } from '@/domain/model'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { toast } from '@/components/ui/toast'
import { Choice } from '@/components/app/Choice'
import { NumberField } from '@/components/app/NumberField'
import { SwitchRow } from '@/components/app/SwitchRow'
import { Section } from '@/components/app/Section'
import { useI18n } from '@/i18n/I18nProvider'
import { issueTitle } from '@/i18n/translate'
import { useActivePlot, useDerived, useNumberLocale } from '@/state/derived'
import { ui, useUiStore } from '@/state/uiStore'
import { useDataStore } from '@/state/dataStore'
import { useProjectStore } from '@/state/projectStore'
import { plotDatasetIds, usePlotLabels } from '@/features/plot/plotLabels'
import { setExportSettings } from '@/state/actions/plot'
import { exportFigure } from '@/plot/exportImage'
import { downloadBlob, downloadText } from '@/platform/download'
import { PLOT_FONT_FAMILY, fontsReady } from '@/platform/fonts'

type Preset = keyof typeof CSV_PRESETS

/** Exports the active plot (the focused pane's) and the data of one dataset. */
export function ExportDialog() {
  const { t, lang } = useI18n()
  const open = useUiStore((s) => s.dialog === 'export')
  const derived = useDerived()
  const plot = useActivePlot()
  const loc = useNumberLocale()
  const rawTables = useDataStore((s) => s.rawTables)
  const [busy, setBusy] = useState<'png' | 'svg' | null>(null)
  const [preset, setPreset] = useState<Preset>(lang === 'it' ? 'excelItalian' : 'standard')
  const [datasetId, setDatasetId] = useState<DatasetId | null>(null)
  const datasets = useProjectStore((s) => s.doc.datasets)
  const projectName = useProjectStore((s) => s.doc.name)
  const labels = usePlotLabels()
  const dataset =
    datasets.find((d) => d.id === datasetId) ??
    datasets.find((d) => d.id === derived.series[0]?.spec.datasetId) ??
    datasets[0]
  // "{project or dataset} – {plot}": the figures of a project's plots get different names.
  const plotDataset = datasets.find((d) => d.id === plotDatasetIds(plot)[0])
  const baseName = figureFileBase(projectName || plotDataset?.name || '', (plot && labels.get(plot.id)) || '')

  const figureExport = async (format: 'png' | 'svg') => {
    if (!plot) return
    setBusy(format)
    try {
      await fontsReady()
      const fig = buildFigure(derived, {
        mode: 'export',
        lang,
        loc,
        t,
        selection: null,
        dragmode: 'zoom',
        viewResetCounter: 0,
        fontFamily: PLOT_FONT_FAMILY,
        advanced: false,
        size: { width: plot.export.widthPx, height: plot.export.heightPx },
      })
      const blob = await exportFigure(fig, {
        format,
        width: plot.export.widthPx,
        height: plot.export.heightPx,
        scale: plot.export.scale,
      })
      const name = safeFileName(baseName, format)
      downloadBlob(blob, name)
      toast.add({ title: t('export.done', { name }), type: 'success' })
    } catch (err) {
      toast.add({
        title: issueTitle(
          t,
          issue('E_EXPORT_FAILED', { reason: err instanceof Error ? err.message : String(err) }),
        ),
        type: 'error',
      })
    } finally {
      setBusy(null)
    }
  }

  const csvExport = (kind: 'original' | 'analysis') => {
    if (!dataset) return
    try {
      const opts = CSV_PRESETS[preset]
      let text: string
      if (kind === 'original') {
        text = originalCsv(
          dataset,
          dataset.origin === 'import' ? (rawTables[dataset.rawTableId] ?? null) : null,
          opts,
        )
      } else {
        const view = derived.views.get(dataset.id)!
        const s = derived.series.find((x) => x.spec.datasetId === dataset.id)
        const fit = s?.fit?.status === 'ok' ? s.fit : null
        const sample = derived.columnSample(
          dataset.id,
          s ? [s.spec.x, s.spec.y] : dataset.columns.map((c) => c.id),
        )!
        text = analysisCsv(
          {
            view,
            columns: dataset.columns,
            sample,
            fit,
            fitXColumn: s?.spec.x,
            predict: fit ? (x: number) => predict(fit, x) : undefined,
            // A split series: each row's group, and with fits per group its own group's fit.
            split: s ? splitForCsv(s) : undefined,
          },
          opts,
        )
      }
      const name = safeFileName(`${dataset.name}${kind === 'analysis' ? '-analysis' : ''}`, 'csv')
      downloadText(text, name, 'text/csv;charset=utf-8')
      toast.add({ title: t('export.done', { name }), type: 'success' })
    } catch (err) {
      toast.add({
        title: issueTitle(
          t,
          issue('E_EXPORT_FAILED', { reason: err instanceof Error ? err.message : String(err) }),
        ),
        type: 'error',
      })
    }
  }

  if (!plot) return null
  const e = plot.export
  return (
    <Dialog open={open} onOpenChange={(o) => !o && ui.closeDialog()}>
      <DialogContent className="max-h-[min(92dvh,56rem)] gap-0 overflow-y-auto overscroll-contain p-0 sm:max-w-xl">
        <DialogHeader className="border-b border-border p-4">
          <DialogTitle>{t('export.title')}</DialogTitle>
          <DialogDescription>{t('export.indicatorNote')}</DialogDescription>
        </DialogHeader>
        <Section title={t('export.figure')}>
          <div className="grid grid-cols-3 gap-2">
            <NumberField
              label={t('export.width')}
              value={e.widthPx}
              decimal={loc.decimal}
              validate={(v) =>
                Number.isInteger(v) && v >= 300 && v <= 4000
                  ? null
                  : t('common.wholeNumberBetween', { min: 300, max: 4000 })
              }
              onCommit={(widthPx) => widthPx !== null && setExportSettings({ widthPx }, plot.id)}
            />
            <NumberField
              label={t('export.height')}
              value={e.heightPx}
              decimal={loc.decimal}
              validate={(v) =>
                Number.isInteger(v) && v >= 200 && v <= 4000
                  ? null
                  : t('common.wholeNumberBetween', { min: 200, max: 4000 })
              }
              onCommit={(heightPx) => heightPx !== null && setExportSettings({ heightPx }, plot.id)}
            />
            <Choice<'1' | '2' | '3'>
              label={t('export.scale')}
              value={String(e.scale) as '1' | '2' | '3'}
              onChange={(v) => setExportSettings({ scale: Number(v) as 1 | 2 | 3 }, plot.id)}
              items={[
                { value: '1', label: '×1' },
                { value: '2', label: '×2' },
                { value: '3', label: '×3' },
              ]}
            />
          </div>
          <SwitchRow
            label={t('export.caption')}
            checked={e.caption}
            onChange={(caption) => setExportSettings({ caption }, plot.id)}
          />
          {plot.type === 'scatter' && derived.series.some((s) => s.fit?.status === 'ok') ? (
            <SwitchRow
              label={t('export.residuals')}
              checked={e.includeResiduals}
              onChange={(includeResiduals) => setExportSettings({ includeResiduals }, plot.id)}
            />
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => void figureExport('png')}
              disabled={!!busy}
              data-testid="export-png"
            >
              {busy === 'png' ? <Spinner aria-hidden /> : <FileImage aria-hidden />}
              {t('export.png')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="bg-background"
              onClick={() => void figureExport('svg')}
              disabled={!!busy}
              data-testid="export-svg"
            >
              {busy === 'svg' ? <Spinner aria-hidden /> : <FileImage aria-hidden />}
              {t('export.svg')}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t('export.pngHint', { w: e.widthPx, h: e.heightPx, scale: e.scale })} {t('export.svgHint')}
          </p>
          <p className="text-xs text-muted-foreground">{t('export.pdfNote')}</p>
        </Section>
        <Section title={t('export.data')}>
          {datasets.length > 1 && dataset ? (
            <Choice<DatasetId>
              label={t('common.dataset')}
              value={dataset.id}
              onChange={setDatasetId}
              items={datasets.map((d) => ({ value: d.id, label: d.name }))}
            />
          ) : null}
          <Choice<Preset>
            label={t('export.csvPreset')}
            value={preset}
            onChange={setPreset}
            items={[
              { value: 'standard', label: t('export.presets.standard') },
              { value: 'excelItalian', label: t('export.presets.excelItalian') },
            ]}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              className="bg-background"
              onClick={() => csvExport('original')}
              data-testid="export-csv-original"
            >
              <FileSpreadsheet aria-hidden />
              {t('export.csvOriginal')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="bg-background"
              onClick={() => csvExport('analysis')}
              data-testid="export-csv-analysis"
            >
              <FileSpreadsheet aria-hidden />
              {t('export.csvAnalysis')}
            </Button>
          </div>
        </Section>
      </DialogContent>
    </Dialog>
  )
}
