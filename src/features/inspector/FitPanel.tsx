import { useMemo, useRef, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { seriesLabels } from '@/domain/figure/labels'
import type { FitModel, SeriesId } from '@/domain/model'
import { Button } from '@/components/ui/button'
import { Choice } from '@/components/app/Choice'
import { Section } from '@/components/app/Section'
import { SwitchRow } from '@/components/app/SwitchRow'
import { NumberField } from '@/components/app/NumberField'
import { Hint } from '@/components/app/Feedback'
import { useT } from '@/i18n/I18nProvider'
import { useActivePlot, useDerived, useNumberLocale } from '@/state/derived'
import { useProjectStore } from '@/state/projectStore'
import { ui, useUiStore } from '@/state/uiStore'
import { addFit, removeFit, setResidualPanel, updateFit } from '@/state/actions/analysis'
import { FitResultView } from '@/features/fit/FitResultView'
import { GroupFitTable } from '@/features/fit/GroupFitTable'
import { xyAppearance } from './appearance'

type ModelKind = FitModel['type']

function maxDegree(level: string, distinctX: number, n: number): number {
  const cap = level === 'advanced' ? 6 : 3
  return Math.max(1, Math.min(cap, distinctX - 1, n - 2))
}

export function FitPanel() {
  const t = useT()
  const loc = useNumberLocale()
  const derived = useDerived()
  const plot = useActivePlot()
  const level = useUiStore((s) => s.level)
  const hasAnyFit = useProjectStore((s) => s.doc.fits.length > 0)
  const datasets = useProjectStore((s) => s.doc.datasets)
  const specs = plot?.series
  const labels = useMemo(() => seriesLabels(specs ?? [], datasets, t), [specs, datasets, t])
  const looks = useMemo(() => xyAppearance(derived.series), [derived.series])
  const [seriesChoice, setSeriesChoice] = useState<SeriesId | null>(null)
  const [newModel, setNewModel] = useState<ModelKind>('linear')
  const [newDegree, setNewDegree] = useState(2)
  const rootRef = useRef<HTMLDivElement>(null)
  // Add, remove and the level switch replace the button that had focus: keep keyboard focus in the panel.
  const focusAfterRender = (selector: string) =>
    requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>(selector)?.focus())

  if (!plot) return <p className="p-3 text-sm text-muted-foreground">{t('fit.noPlot')}</p>
  if (plot.type !== 'scatter' && plot.type !== 'line')
    return <p className="p-3 text-sm text-muted-foreground">{t('fit.notForType')}</p>
  if (!derived.series.length) return <p className="p-3 text-sm text-muted-foreground">{t('fit.noSeries')}</p>

  const series = derived.series.find((s) => s.spec.id === seriesChoice) ?? derived.series[0]
  const fitSpec = series.fitSpec

  if (level === 'beginner' && !hasAnyFit) {
    return (
      <div ref={rootRef} className="flex flex-col items-start gap-2 p-3">
        <p className="text-sm text-muted-foreground">{t('fit.beginnerLocked')}</p>
        <Button
          size="sm"
          variant="outline"
          className="bg-background"
          onClick={() => {
            ui.set({ level: 'intermediate' })
            focusAfterRender('[data-testid="add-fit"]')
          }}
        >
          {t('fit.showIntermediate')}
        </Button>
      </div>
    )
  }

  const nActive = series.data.sample.nActive
  const distinctX = new Set(Array.from(series.data.x).filter((_, i) => series.data.sample.reason[i] === 0))
    .size
  const degCap = maxDegree(level, distinctX, nActive)
  const modelItems = [
    { value: 'linear' as const, label: t('fit.models.linear') },
    { value: 'polynomial' as const, label: t('fit.models.polynomial') },
    ...(level === 'advanced'
      ? [
          { value: 'exponential' as const, label: t('fit.models.exponential') },
          { value: 'power' as const, label: t('fit.models.power') },
        ]
      : []),
  ]
  const maxDeg = Math.max(2, degCap)
  const degreeError = (v: number) =>
    Number.isInteger(v) && v >= 2 && v <= maxDeg
      ? null
      : t('common.wholeNumberBetween', { min: 2, max: maxDeg })
  const storedDegree = fitSpec?.model.type === 'polynomial' ? fitSpec.model.degree : null
  const capDegree = (degree: number) => Math.min(Math.max(degree, 2), maxDeg)
  const toModel = (kind: ModelKind, degree: number): FitModel =>
    kind === 'polynomial' ? { type: 'polynomial', degree: capDegree(degree) } : ({ type: kind } as FitModel)
  // The degree of a new fit follows the level and the data (e.g. 6 picked in Advanced, then the level
  // lowered): the field shows exactly the degree "Add fit" will add.
  const addDegree = capDegree(newDegree)

  return (
    <div ref={rootRef}>
      <Section title={t('fit.title')}>
        {derived.series.length > 1 ? (
          <Choice<SeriesId>
            label={t('fit.series')}
            value={series.spec.id}
            onChange={setSeriesChoice}
            items={derived.series.map((s) => ({
              value: s.spec.id,
              label: labels.get(s.spec.id) ?? s.yColumn.name,
            }))}
          />
        ) : null}
        {!fitSpec ? (
          <>
            <div className={newModel === 'polynomial' ? 'grid grid-cols-[1fr_5rem] gap-2' : 'grid gap-2'}>
              <Choice<ModelKind>
                label={t('fit.model')}
                value={newModel}
                onChange={setNewModel}
                items={modelItems}
              />
              {newModel === 'polynomial' ? (
                <NumberField
                  label={t('fit.degree')}
                  value={addDegree}
                  decimal={loc.decimal}
                  validate={degreeError}
                  onCommit={(v) => v !== null && setNewDegree(v)}
                />
              ) : null}
            </div>
            <Button
              className="self-start"
              onClick={() => {
                addFit(series.spec.id, toModel(newModel, addDegree), t(`fit.modelShort.${newModel}`))
                focusAfterRender('[data-fit-model] [role="combobox"]')
              }}
              data-testid="add-fit"
            >
              <Plus aria-hidden />
              {t('fit.add')}
            </Button>
            <Hint>{t('help.topics.fit.body')}</Hint>
          </>
        ) : (
          <>
            <div
              className={
                fitSpec.model.type === 'polynomial' ? 'grid grid-cols-[1fr_5rem] gap-2' : 'grid gap-2'
              }
              data-fit-model
            >
              <Choice<ModelKind>
                label={t('fit.model')}
                value={fitSpec.model.type}
                onChange={(kind) =>
                  updateFit(fitSpec.id, {
                    model: toModel(kind, fitSpec.model.type === 'polynomial' ? fitSpec.model.degree : 2),
                  })
                }
                items={
                  modelItems.some((m) => m.value === fitSpec.model.type)
                    ? modelItems
                    : [
                        ...modelItems,
                        { value: fitSpec.model.type, label: t(`fit.models.${fitSpec.model.type}`) },
                      ]
                }
              />
              {fitSpec.model.type === 'polynomial' ? (
                <NumberField
                  label={t('fit.degree')}
                  value={fitSpec.model.degree}
                  decimal={loc.decimal}
                  // The stored degree may exceed this level's cap (fitted in Advanced, or read from a file;
                  // the schema allows 1 to 10, which runFit accepts): leaving it unchanged is not an error.
                  validate={(v) => (v === storedDegree ? null : degreeError(v))}
                  onCommit={(v) =>
                    v !== null && updateFit(fitSpec.id, { model: { type: 'polynomial', degree: v } })
                  }
                />
              ) : null}
            </div>
            {series.split ? (
              <SwitchRow
                label={t('fit.perGroup')}
                checked={fitSpec.perGroup}
                onChange={(perGroup) => updateFit(fitSpec.id, { perGroup })}
                hint={t('fit.perGroupHint')}
              />
            ) : null}
            <SwitchRow
              label={t('fit.showResiduals')}
              checked={plot.scatter.residualPanel && fitSpec.show.residuals}
              onChange={(on) => {
                updateFit(fitSpec.id, { show: { ...fitSpec.show, residuals: on } })
                if (on && !plot.scatter.residualPanel) setResidualPanel(plot.id, true)
              }}
              hint={t('fit.residualsHint')}
            />
            <SwitchRow
              label={t('fit.confidenceBand')}
              checked={fitSpec.show.confidenceBand}
              onChange={(on) => updateFit(fitSpec.id, { show: { ...fitSpec.show, confidenceBand: on } })}
            />
            {level === 'advanced' ? (
              <>
                <SwitchRow
                  label={t('fit.predictionBand')}
                  checked={fitSpec.show.predictionBand}
                  onChange={(on) => updateFit(fitSpec.id, { show: { ...fitSpec.show, predictionBand: on } })}
                />
                <Choice<'0.9' | '0.95' | '0.99'>
                  label={t('fit.confidence')}
                  value={String(fitSpec.confidence) as '0.9' | '0.95' | '0.99'}
                  onChange={(v) => updateFit(fitSpec.id, { confidence: Number(v) as 0.9 | 0.95 | 0.99 })}
                  items={[
                    { value: '0.9', label: '90\u00a0%' },
                    { value: '0.95', label: '95\u00a0%' },
                    { value: '0.99', label: '99\u00a0%' },
                  ]}
                />
              </>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              className="self-start"
              onClick={() => {
                removeFit(fitSpec.id)
                focusAfterRender('[data-testid="add-fit"]')
              }}
            >
              <Trash2 aria-hidden />
              {t('fit.remove')}
            </Button>
          </>
        )}
      </Section>
      {fitSpec && series.fit ? (
        <Section title={t('fit.parameters')}>
          <FitResultView series={series} result={series.fit} />
        </Section>
      ) : null}
      {/* Per group, the pipeline leaves the series without a pooled fit (series.fit null). */}
      {fitSpec && !series.fit && series.split ? (
        <Section title={t('fit.groupTable')}>
          <GroupFitTable series={series} lookOf={(key) => looks.group(series, key)} />
        </Section>
      ) : null}
    </div>
  )
}
