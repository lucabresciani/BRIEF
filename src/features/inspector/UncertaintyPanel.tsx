import { useMemo, useState } from 'react'
import type {
  ColumnId,
  MeasurementMeaning,
  MeasurementSource,
  ReplicateGrouping,
  SeriesId,
  UncertaintySpec,
} from '@/domain/model'
import type { DerivedSeries } from '@/domain/derive/pipeline'
import { seriesLabels } from '@/domain/figure/labels'
import { Choice } from '@/components/app/Choice'
import { Section } from '@/components/app/Section'
import { SwitchRow } from '@/components/app/SwitchRow'
import { NumberField } from '@/components/app/NumberField'
import { Hint, IssueList } from '@/components/app/Feedback'
import { useT } from '@/i18n/I18nProvider'
import type { Translator } from '@/i18n/translate'
import { useActivePlot, useDerived, useNumberLocale } from '@/state/derived'
import { useProjectStore } from '@/state/projectStore'
import { setErrorBars, setErrorBarsVisible } from '@/state/actions/analysis'
import { categoryColumnItems, numericColumnItems } from './columnOptions'

type Kind = UncertaintySpec['kind']
type SourceType = MeasurementSource['type']

export function UncertaintyPanel() {
  const t = useT()
  const derived = useDerived()
  const plot = useActivePlot()
  const datasets = useProjectStore((s) => s.doc.datasets)
  const specs = plot?.series
  // The legend's names, as in the Plot, Fit and Style tabs.
  const labels = useMemo(() => seriesLabels(specs ?? [], datasets, t), [specs, datasets, t])
  const [choice, setChoice] = useState<SeriesId | null>(null)
  if (!plot) return <p className="p-3 text-sm text-muted-foreground">{t('plot.noPlot')}</p>
  if (plot.type !== 'scatter' && plot.type !== 'line')
    return <p className="p-3 text-sm text-muted-foreground">{t('uncertainty.notForType')}</p>
  if (!derived.series.length)
    return <p className="p-3 text-sm text-muted-foreground">{t('uncertainty.noSeries')}</p>
  const series = derived.series.find((s) => s.spec.id === choice) ?? derived.series[0]
  const issues = [
    ...(series.yBars?.issues ?? []),
    ...(series.xBars?.issues ?? []),
    ...(series.replicate?.bars.issues ?? []),
  ]
  return (
    <div>
      <Section title={t('uncertainty.title')}>
        {derived.series.length > 1 ? (
          <Choice<SeriesId>
            label={t('fit.series')}
            value={series.spec.id}
            onChange={setChoice}
            items={derived.series.map((s) => ({
              value: s.spec.id,
              label: labels.get(s.spec.id) ?? s.yColumn.name,
            }))}
          />
        ) : null}
        <SwitchRow
          label={t('uncertainty.show')}
          checked={series.spec.errorBars.visible}
          onChange={(v) => setErrorBarsVisible(series.spec.id, v)}
          disabled={series.spec.errorBars.x.kind === 'none' && series.spec.errorBars.y.kind === 'none'}
        />
        <Hint>{t('uncertainty.notWeights')}</Hint>
      </Section>
      <AxisBars series={series} axis="y" />
      <AxisBars series={series} axis="x" />
      {issues.length ? (
        <Section title={t('import.issues')}>
          <IssueList issues={issues} compact />
        </Section>
      ) : null}
    </div>
  )
}

function AxisBars({ series, axis }: { series: DerivedSeries; axis: 'x' | 'y' }) {
  const t = useT()
  const loc = useNumberLocale()
  const derived = useDerived()
  const spec = axis === 'x' ? series.spec.errorBars.x : series.spec.errorBars.y
  const dataset = derived.doc.datasets.find((d) => d.id === series.spec.datasetId)
  const column = axis === 'x' ? series.xColumn : series.yColumn
  if (!dataset) return null
  const set = (next: UncertaintySpec, coalesce?: string) => setErrorBars(series.spec.id, axis, next, coalesce)
  const kinds: Kind[] = axis === 'y' ? ['none', 'measurement', 'sd', 'sem', 'ci'] : ['none', 'measurement']
  // A column source on a derived axis column, or read from a derived column, is refused by the pipeline
  // (E_DERIVED_UNCERTAINTY): never preselected.
  const suggested =
    column.source.type === 'derived'
      ? undefined
      : dataset.columns.find(
          (c) => c.role === 'uncertainty' && c.uncertaintyOf === column.id && c.source.type !== 'derived',
        )

  const defaultFor = (k: Kind): UncertaintySpec => {
    switch (k) {
      case 'none':
        return { kind: 'none' }
      case 'measurement':
        return {
          kind: 'measurement',
          origin: suggested ? 'user' : 'instrument',
          source: suggested ? { type: 'column', column: suggested.id } : { type: 'absolute', value: 0 },
          meaning: { type: 'unspecified' },
        }
      case 'sd':
      case 'sem':
        return { kind: k, grouping: { by: 'sameX' } }
      case 'ci':
        return { kind: 'ci', grouping: { by: 'sameX' }, level: 0.95, method: 't' }
    }
  }

  return (
    <Section
      title={axis === 'y' ? t('uncertainty.axisY') : t('uncertainty.axisX')}
      collapsible
      defaultOpen={axis === 'y' || spec.kind !== 'none'}
    >
      <Choice<Kind>
        label={t('uncertainty.kind')}
        value={spec.kind}
        onChange={(k) => set(defaultFor(k))}
        items={kinds.map((k) => ({ value: k, label: t(`uncertainty.kinds.${k}`) }))}
      />
      {axis === 'x' ? (
        <p className="text-xs text-muted-foreground">{t('uncertainty.xOnlyMeasurement')}</p>
      ) : null}
      {spec.kind === 'measurement' ? (
        <MeasurementEditor spec={spec} set={set} series={series} axis={axis} t={t} decimal={loc.decimal} />
      ) : null}
      {spec.kind === 'sd' || spec.kind === 'sem' || spec.kind === 'ci' ? (
        <>
          <Choice<'sameX' | ColumnId>
            label={t('uncertainty.grouping')}
            value={spec.grouping.by === 'sameX' ? 'sameX' : spec.grouping.column}
            onChange={(v) => {
              const grouping: ReplicateGrouping =
                v === 'sameX' ? { by: 'sameX' } : { by: 'column', column: v as ColumnId }
              set({ ...spec, grouping } as UncertaintySpec)
            }}
            items={[
              { value: 'sameX' as const, label: t('uncertainty.groupSameX') },
              ...categoryColumnItems(dataset),
            ]}
          />
          {spec.kind === 'ci' ? (
            <Choice<'0.9' | '0.95' | '0.99'>
              label={t('uncertainty.level')}
              value={String(spec.level) as '0.9' | '0.95' | '0.99'}
              onChange={(v) => set({ ...spec, level: Number(v) as 0.9 | 0.95 | 0.99 })}
              items={[
                { value: '0.9', label: '90\u00a0%' },
                { value: '0.95', label: '95\u00a0%' },
                { value: '0.99', label: '99\u00a0%' },
              ]}
            />
          ) : null}
          <Hint>
            {spec.kind === 'ci'
              ? t('uncertainty.ciHint', { level: Math.round(spec.level * 100) })
              : t('uncertainty.sdVsSem')}
          </Hint>
          {series.replicate ? (
            <p className="text-xs text-muted-foreground">
              {t('uncertainty.groupMeansNote', { n: series.data.sample.nActive })}
            </p>
          ) : null}
        </>
      ) : null}
    </Section>
  )
}

function MeasurementEditor({
  spec,
  set,
  series,
  axis,
  t,
  decimal,
}: {
  spec: Extract<UncertaintySpec, { kind: 'measurement' }>
  set: (s: UncertaintySpec, coalesce?: string) => void
  series: DerivedSeries
  axis: 'x' | 'y'
  t: Translator
  decimal: '.' | ','
}) {
  const derived = useDerived()
  const dataset = derived.doc.datasets.find((d) => d.id === series.spec.datasetId)!
  const view = derived.views.get(dataset.id)
  // Uncertainty columns must be raw or notebook columns (no propagation through derived columns).
  const colItems = numericColumnItems(dataset, view, t).map((i) => {
    const c = dataset.columns.find((x) => x.id === i.value)
    return c?.source.type === 'derived' ? { ...i, disabled: true, hint: t('derived.noUncertainty') } : i
  })
  const firstCol = colItems.find((i) => !i.disabled)?.value ?? null
  const sourceType = spec.source.type
  const setSource = (type: SourceType) => {
    const source: MeasurementSource =
      type === 'absolute'
        ? { type, value: 0 }
        : type === 'percent'
          ? { type, percent: 1 }
          : type === 'column'
            ? { type, column: (firstCol ?? '') as ColumnId }
            : { type, plus: (firstCol ?? '') as ColumnId, minus: (firstCol ?? '') as ColumnId }
    set({ ...spec, source })
  }
  const meaningValue = spec.meaning.type
  const valueColumn = axis === 'x' ? series.xColumn : series.yColumn
  const unit = valueColumn.unit
  // Uncertainty is not propagated through a transformation: on a derived column (ln V, 1/T, …) the
  // pipeline refuses column sources (E_DERIVED_UNCERTAINTY). A typed value or percentage is the user's
  // own statement about the plotted quantity and stays available.
  const derivedValue = valueColumn.source.type === 'derived'
  return (
    <div className="flex flex-col gap-3">
      <Choice<SourceType>
        label={t('uncertainty.source')}
        value={sourceType}
        onChange={setSource}
        items={(['absolute', 'percent', 'column', 'columnAsymmetric'] as const).map((v) => {
          const fromColumn = v === 'column' || v === 'columnAsymmetric'
          return {
            value: v,
            label: t(`uncertainty.sources.${v}`),
            disabled: fromColumn && derivedValue,
            hint: fromColumn && derivedValue ? t('derived.noUncertainty') : undefined,
          }
        })}
      />
      {spec.source.type === 'absolute' ? (
        <div className="flex items-end gap-2">
          <NumberField
            className="flex-1"
            label={t('uncertainty.value')}
            value={spec.source.value}
            decimal={decimal}
            min={0}
            onCommit={(v) => v !== null && set({ ...spec, source: { type: 'absolute', value: v } })}
          />
          {unit ? <span className="pb-1.5 text-xs text-muted-foreground">{unit}</span> : null}
        </div>
      ) : null}
      {spec.source.type === 'percent' ? (
        <NumberField
          label={`${t('uncertainty.percent')} (%)`}
          value={spec.source.percent}
          decimal={decimal}
          min={0}
          onCommit={(v) => v !== null && set({ ...spec, source: { type: 'percent', percent: v } })}
        />
      ) : null}
      {spec.source.type === 'column' ? (
        <Choice<ColumnId>
          label={t('uncertainty.column')}
          value={spec.source.column || null}
          items={colItems}
          onChange={(column) => set({ ...spec, source: { type: 'column', column } })}
        />
      ) : null}
      {spec.source.type === 'columnAsymmetric' ? (
        <div className="grid grid-cols-2 gap-2">
          <Choice<ColumnId>
            label={t('uncertainty.plus')}
            value={spec.source.plus || null}
            items={colItems}
            onChange={(plus) =>
              spec.source.type === 'columnAsymmetric' && set({ ...spec, source: { ...spec.source, plus } })
            }
          />
          <Choice<ColumnId>
            label={t('uncertainty.minus')}
            value={spec.source.minus || null}
            items={colItems}
            onChange={(minus) =>
              spec.source.type === 'columnAsymmetric' && set({ ...spec, source: { ...spec.source, minus } })
            }
          />
        </div>
      ) : null}
      <Choice<'instrument' | 'user'>
        label={t('uncertainty.origin')}
        value={spec.origin}
        onChange={(origin) => set({ ...spec, origin })}
        items={[
          { value: 'instrument', label: t('uncertainty.origins.instrument') },
          { value: 'user', label: t('uncertainty.origins.user') },
        ]}
      />
      {/* items-end keeps both controls on one line when the k label wraps. */}
      <div className="grid grid-cols-[1fr_5rem] items-end gap-2">
        <Choice<MeasurementMeaning['type']>
          label={t('uncertainty.meaning')}
          value={meaningValue}
          onChange={(type) =>
            set({ ...spec, meaning: type === 'expanded' ? { type, k: 2 } : ({ type } as MeasurementMeaning) })
          }
          items={(['standard', 'expanded', 'unspecified'] as const).map((v) => ({
            value: v,
            label: t(`uncertainty.meanings.${v}`),
          }))}
        />
        {spec.meaning.type === 'expanded' ? (
          <NumberField
            label={t('uncertainty.k')}
            value={spec.meaning.k}
            decimal={decimal}
            validate={(v) => (v > 0 ? null : t('common.numberPositive'))}
            onCommit={(k) => k !== null && set({ ...spec, meaning: { type: 'expanded', k } })}
          />
        ) : null}
      </div>
      <Hint>{t('uncertainty.measurementHint')}</Hint>
    </div>
  )
}
