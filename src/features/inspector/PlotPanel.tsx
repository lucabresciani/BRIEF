import { useMemo, useRef } from 'react'
import { ArrowLeftRight, Eye, EyeOff, Plus, Trash2 } from 'lucide-react'
import type {
  AxisSpec,
  BarOptions,
  BoxOptions,
  ColumnId,
  DatasetId,
  HistogramOptions,
  PlotSpec,
  XYSeriesSpec,
} from '@/domain/model'
import { effectiveSettings } from '@/domain/model'
import type { DerivedProject, DerivedSeries } from '@/domain/derive/pipeline'
import { groupLabel } from '@/domain/figure/groups'
import { seriesLabels } from '@/domain/figure/labels'
import { Button } from '@/components/ui/button'
import { Choice } from '@/components/app/Choice'
import { Section } from '@/components/app/Section'
import { IconButton } from '@/components/app/IconButton'
import { NumberField } from '@/components/app/NumberField'
import { TextField } from '@/components/app/TextField'
import { SwitchRow } from '@/components/app/SwitchRow'
import { Hint, IssueNote } from '@/components/app/Feedback'
import { useT } from '@/i18n/I18nProvider'
import { issueTitle, type Translator } from '@/i18n/translate'
import { useActivePlot, useDerived, useNumberLocale } from '@/state/derived'
import {
  addSeries,
  removeSeries,
  setBarOptions,
  setPlotOptions,
  setSeriesMapping,
  setSeriesSplit,
  setSeriesVisibility,
  swapAxes,
  updateAxis,
} from '@/state/actions/plot'
import {
  categoryColumnItems,
  groupColumnItems,
  isNumeric,
  NO_COLUMN,
  numericColumnItems,
} from './columnOptions'
import { xyAppearance, type XYAppearance } from './appearance'
import { MarkerSwatch, SeriesKey } from './Swatch'

export function PlotPanel() {
  const t = useT()
  const plot = useActivePlot()
  if (!plot) return <p className="p-3 text-sm text-muted-foreground">{t('plot.noPlot')}</p>
  return (
    <div>
      {plot.type === 'scatter' || plot.type === 'line' ? <SeriesSection plot={plot} /> : null}
      {plot.type === 'bar' ? <BarSection plot={plot} /> : null}
      {plot.type === 'histogram' ? <HistogramSection plot={plot} /> : null}
      {plot.type === 'box' ? <BoxSection plot={plot} /> : null}
      <AxisSection axis="x" spec={plot.xAxis} plot={plot} />
      <AxisSection axis="y" spec={plot.yAxis} plot={plot} />
    </div>
  )
}

function SeriesSection({ plot }: { plot: PlotSpec }) {
  const t = useT()
  const derived = useDerived()
  const datasets = derived.doc.datasets
  const addRef = useRef<HTMLButtonElement>(null)
  const ds = datasets[datasets.length - 1]
  const view = ds ? derived.views.get(ds.id) : undefined
  const nums = ds
    ? ds.columns.filter((c) => (view?.columns.get(c.id)?.report.nValid ?? 0) > 0 && c.role === 'measurement')
    : []
  // The legend's names and the figure's colours and markers, so a row here reads like its legend entry.
  const labels = useMemo(() => seriesLabels(plot.series, datasets, t), [plot.series, datasets, t])
  const looks = useMemo(() => xyAppearance(derived.series), [derived.series])
  const line = plot.type === 'line' ? { markers: plot.line.markers } : null
  // The split hint is the same for every series: shown once, under the first one not split.
  const hinted = plot.series.find((s) => s.split === null)?.id
  return (
    <Section title={t('series.title')}>
      {plot.type === 'scatter' ? <Hint>{t('help.topics.scatter.body')}</Hint> : null}
      {plot.series.map((s) => (
        // Removing a series removes the focused button with it: hand focus to "Add series".
        <SeriesEditor
          key={s.id}
          series={s}
          label={labels.get(s.id) ?? ''}
          derivedSeries={derived.series.find((d) => d.spec.id === s.id)}
          looks={looks}
          line={line}
          splitHint={s.id === hinted}
          onRemoved={() => requestAnimationFrame(() => addRef.current?.focus())}
        />
      ))}
      {ds ? (
        <Button
          ref={addRef}
          size="sm"
          variant="outline"
          className="self-start bg-background"
          disabled={nums.length < 2}
          onClick={() => {
            if (nums.length >= 2) addSeries(ds.id, nums[0].id, nums[1].id, nums[1].name, plot.id)
          }}
        >
          <Plus aria-hidden />
          {t('series.add')}
        </Button>
      ) : null}
    </Section>
  )
}

/** At most this many groups are listed under "Split by"; the Style tab lists them all. */
const LISTED_GROUPS = 12

function SeriesEditor({
  series,
  label,
  derivedSeries,
  looks,
  line,
  splitHint,
  onRemoved,
}: {
  series: XYSeriesSpec
  /** seriesLabels: the name the legend shows. */
  label: string
  derivedSeries: DerivedSeries | undefined
  looks: XYAppearance
  /** Line plots: whether markers are drawn on the line. */
  line: { markers: boolean } | null
  /** Whether this card shows the "Split by" hint (the first series not split). */
  splitHint: boolean
  onRemoved: () => void
}) {
  const t = useT()
  const derived = useDerived()
  const dataset = derived.doc.datasets.find((d) => d.id === series.datasetId)
  const view = derived.views.get(series.datasetId)
  if (!dataset) return null
  const items = numericColumnItems(dataset, view, t)
  const nameOf = (id: ColumnId) => dataset.columns.find((c) => c.id === id)?.name ?? ''
  const groups = derivedSeries?.split?.groups ?? []
  const lineOf = line ? { width: series.style.lineWidth, markers: line.markers } : null
  // A stored split the pipeline does not draw (too many values): said next to the select showing it.
  const notSplit =
    series.split && derivedSeries && !derivedSeries.split
      ? derivedSeries.issues.find((i) => i.code === 'W_SPLIT_TOO_MANY_GROUPS')
      : undefined
  return (
    <div
      className="flex flex-col gap-2 rounded-md border border-border bg-background p-2.5"
      data-series={series.id}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          {derivedSeries && !derivedSeries.split ? (
            <SeriesKey look={looks.series(derivedSeries)} line={lineOf} />
          ) : null}
          {derivedSeries && groups.length ? (
            <span className="flex shrink-0 items-center gap-0.5" data-testid="series-group-keys">
              {groups.slice(0, 3).map((g) => {
                const look = looks.group(derivedSeries, g.key)
                return <MarkerSwatch key={g.key} color={look.color} symbol={look.symbol} open={look.open} />
              })}
            </span>
          ) : null}
          <span className="min-w-0 truncate text-xs font-medium" title={label}>
            {label}
          </span>
        </span>
        <div className="flex shrink-0 items-center">
          <IconButton
            label={t('axes.swap')}
            size="icon-xs"
            onClick={() => swapAxes(series.id, { x: nameOf(series.x), y: nameOf(series.y) })}
          >
            <ArrowLeftRight aria-hidden />
          </IconButton>
          <IconButton
            label={t('series.hide', { name: label })}
            size="icon-xs"
            pressed={!series.visible}
            onClick={() => setSeriesVisibility(series.id, !series.visible, label)}
          >
            {series.visible ? <Eye aria-hidden /> : <EyeOff aria-hidden />}
          </IconButton>
          <IconButton
            label={t('series.remove')}
            size="icon-xs"
            onClick={() => {
              removeSeries(series.id, label)
              onRemoved()
            }}
          >
            <Trash2 aria-hidden />
          </IconButton>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Choice<ColumnId>
          label={t('axes.x')}
          value={series.x}
          items={items}
          onChange={(x) => setSeriesMapping(series.id, { x }, { x: nameOf(x), y: nameOf(series.y) })}
        />
        <Choice<ColumnId>
          label={t('axes.y')}
          value={series.y}
          items={items}
          onChange={(y) => setSeriesMapping(series.id, { y }, { x: nameOf(series.x), y: nameOf(y) })}
        />
      </div>
      <Choice<ColumnId>
        label={t('series.split')}
        value={series.split?.column ?? NO_COLUMN}
        items={groupColumnItems(dataset, view, t, {
          none: t('series.splitNone'),
          axes: { x: series.x, y: series.y },
        })}
        onChange={(c) =>
          setSeriesSplit(series.id, c === NO_COLUMN ? null : c, {
            name: label,
            column: c === NO_COLUMN ? '' : nameOf(c),
          })
        }
      />
      {derivedSeries && groups.length ? (
        <ul
          aria-label={t('series.groupsOf', { name: label })}
          className="flex flex-wrap gap-x-3 gap-y-1 text-xs"
          data-testid="series-groups"
        >
          {groups.slice(0, LISTED_GROUPS).map((g) => {
            const look = looks.group(derivedSeries, g.key)
            return (
              <li key={g.key} className="flex min-w-0 items-center gap-1">
                <MarkerSwatch color={look.color} symbol={look.symbol} open={look.open} />
                <span className="max-w-40 truncate">{groupLabel(g, t)}</span>
              </li>
            )
          })}
          {groups.length > LISTED_GROUPS ? (
            <li className="text-muted-foreground">
              {t('series.moreGroups', { n: groups.length - LISTED_GROUPS })}
            </li>
          ) : null}
        </ul>
      ) : notSplit ? (
        <IssueNote issue={notSplit} />
      ) : series.split === null && splitHint ? (
        <Hint>{t('series.splitHint')}</Hint>
      ) : null}
    </div>
  )
}

/**
 * Why this axis cannot be logarithmic, or null. Each case is one the figure draws linear whatever the
 * stored scale: bars and histogram counts start at zero (I_BAR_LINEAR_ONLY), histogram bins have equal
 * linear widths, and a date axis is always linear in time (DerivedProject.axisScales).
 */
function logUnavailable(
  derived: DerivedProject,
  plot: PlotSpec,
  axis: 'x' | 'y',
  spec: AxisSpec,
  t: Translator,
): string | null {
  if ((plot.type === 'bar' || plot.type === 'histogram') && axis === 'y')
    return issueTitle(t, { code: 'I_BAR_LINEAR_ONLY' })
  if (plot.type === 'histogram') return t('axes.logBins')
  if (!derived.series.length) return null
  // The pipeline's rule: a date axis is one where every plottable series has a date/time column on it.
  const usable = derived.series.filter((s) => isNumeric(s.xColumn) && isNumeric(s.yColumn))
  const dateAxis =
    derived.axisScales[axis] !== spec.scale ||
    (usable.length > 0 &&
      usable.every((s) => effectiveSettings(axis === 'x' ? s.xColumn : s.yColumn).kind === 'datetime'))
  return dateAxis ? t('axes.logDate') : null
}

function AxisSection({ axis, spec, plot }: { axis: 'x' | 'y'; spec: AxisSpec; plot: PlotSpec }) {
  const t = useT()
  const loc = useNumberLocale()
  const derived = useDerived()
  const first = derived.series[0]
  const col = axis === 'x' ? first?.xColumn : first?.yColumn
  const categorical = (plot.type === 'bar' || plot.type === 'box') && axis === 'x'
  const logReason = logUnavailable(derived, plot, axis, spec, t)
  // The scale the axis is drawn with: a stored 'log' the figure cannot honour is drawn linear, so the
  // range is validated (and defaulted) as linear.
  const drawnScale = logReason ? 'linear' : spec.scale
  // Edits go to the plot this panel shows, even when they commit after the active plot changed.
  const update = (patch: Partial<AxisSpec>) => updateAxis(axis, patch, { plotId: plot.id })
  return (
    <Section title={t(`axes.${axis}`)} collapsible defaultOpen={axis === 'x'}>
      <div className="grid grid-cols-[1fr_6rem] gap-2">
        <TextField
          label={t('axes.label')}
          value={spec.label ?? ''}
          placeholder={col?.name ?? t('axes.labelPlaceholder')}
          onCommit={(v) => update({ label: v || null })}
        />
        <TextField
          label={t('axes.unit')}
          value={spec.unit ?? ''}
          placeholder={col?.unit ?? ''}
          onCommit={(v) => update({ unit: v || null })}
        />
      </div>
      {!categorical ? (
        <>
          <Choice<'linear' | 'log'>
            label={t('axes.scale')}
            value={spec.scale}
            onChange={(scale) => update({ scale })}
            items={[
              { value: 'linear', label: t('axes.linear') },
              {
                value: 'log',
                label: t('axes.log'),
                disabled: logReason !== null,
                hint: logReason ?? undefined,
              },
            ]}
          />
          {spec.scale === 'log' && logReason ? (
            <p className="text-xs text-muted-foreground">{`${logReason} ${t('axes.drawnLinear')}`}</p>
          ) : null}
          {drawnScale === 'log' ? <Hint>{t('axes.logHint')}</Hint> : null}
          <Choice<'auto' | 'fixed'>
            label={t('axes.range')}
            value={spec.range.mode}
            onChange={(mode) =>
              update({
                range:
                  mode === 'auto'
                    ? { mode: 'auto' }
                    : {
                        mode: 'fixed',
                        min: drawnScale === 'log' ? 1 : 0,
                        max: drawnScale === 'log' ? 10 : 1,
                      },
              })
            }
            items={[
              { value: 'auto', label: t('axes.rangeAuto') },
              { value: 'fixed', label: t('axes.rangeFixed') },
            ]}
          />
          {spec.range.mode === 'fixed' ? (
            <div className="grid grid-cols-2 gap-2">
              <NumberField
                label={t('common.minimum')}
                value={spec.range.min}
                decimal={loc.decimal}
                validate={(v) =>
                  spec.range.mode === 'fixed' && v >= spec.range.max
                    ? t('issues.E_RANGE_INVERTED.title')
                    : drawnScale === 'log' && v <= 0
                      ? t('issues.E_LOG_RANGE_NONPOSITIVE.title')
                      : null
                }
                onCommit={(v) =>
                  v !== null && spec.range.mode === 'fixed' && update({ range: { ...spec.range, min: v } })
                }
              />
              <NumberField
                label={t('common.maximum')}
                value={spec.range.max}
                decimal={loc.decimal}
                validate={(v) =>
                  spec.range.mode === 'fixed' && v <= spec.range.min
                    ? t('issues.E_RANGE_INVERTED.title')
                    : drawnScale === 'log' && v <= 0
                      ? t('issues.E_LOG_RANGE_NONPOSITIVE.title')
                      : null
                }
                onCommit={(v) =>
                  v !== null && spec.range.mode === 'fixed' && update({ range: { ...spec.range, max: v } })
                }
              />
            </div>
          ) : null}
        </>
      ) : null}
      <SwitchRow
        label={t('axes.grid')}
        checked={spec.showGrid}
        onChange={(showGrid) => update({ showGrid })}
      />
    </Section>
  )
}

function useDatasetChoice(datasetId: DatasetId | null) {
  const derived = useDerived()
  const dataset = derived.doc.datasets.find((d) => d.id === datasetId) ?? derived.doc.datasets[0]
  return {
    dataset,
    view: dataset ? derived.views.get(dataset.id) : undefined,
    datasets: derived.doc.datasets,
  }
}

function DatasetPicker({ value, onChange }: { value: DatasetId | null; onChange: (id: DatasetId) => void }) {
  const t = useT()
  const { datasets } = useDatasetChoice(value)
  if (datasets.length < 2) return null
  return (
    <Choice<DatasetId>
      label={t('common.dataset')}
      value={value ?? datasets[0]?.id ?? null}
      onChange={onChange}
      items={datasets.map((d) => ({ value: d.id, label: d.name }))}
    />
  )
}

function BarSection({ plot }: { plot: PlotSpec }) {
  const t = useT()
  const opts = plot.bar
  const setBar = (next: BarOptions) => setBarOptions(next, plot.id)
  const { dataset, view } = useDatasetChoice(opts.datasetId)
  if (!dataset) return null
  return (
    <Section title={t('plot.types.bar')}>
      <DatasetPicker
        value={opts.datasetId}
        onChange={(datasetId) => setBar({ ...opts, datasetId, category: null, value: null })}
      />
      <Choice<ColumnId>
        label={t('style.barCategory')}
        value={opts.category}
        items={categoryColumnItems(dataset)}
        onChange={(category) => setBar({ ...opts, datasetId: dataset.id, category })}
      />
      <Choice<ColumnId>
        label={t('style.barValue')}
        value={opts.value}
        items={numericColumnItems(dataset, view, t)}
        onChange={(value) => setBar({ ...opts, datasetId: dataset.id, value })}
      />
      <Choice<'mean' | 'none'>
        label={t('style.barAggregate')}
        value={opts.aggregate}
        onChange={(aggregate) =>
          setBar(
            aggregate === 'mean'
              ? {
                  datasetId: opts.datasetId,
                  category: opts.category,
                  value: opts.value,
                  showObservations: opts.showObservations,
                  colorByCategory: opts.colorByCategory,
                  aggregate,
                  spread: { kind: 'sem' },
                }
              : {
                  datasetId: opts.datasetId,
                  category: opts.category,
                  value: opts.value,
                  showObservations: opts.showObservations,
                  colorByCategory: opts.colorByCategory,
                  aggregate,
                  uncertainty: { kind: 'none' },
                },
          )
        }
        items={[
          { value: 'mean', label: t('style.aggregates.mean') },
          { value: 'none', label: t('style.aggregates.none') },
        ]}
      />
      {opts.aggregate === 'mean' ? (
        <Choice<'none' | 'sd' | 'sem' | 'ci'>
          label={t('style.spread')}
          value={opts.spread.kind}
          onChange={(k) =>
            setBar({
              ...opts,
              spread: k === 'ci' ? { kind: 'ci', level: 0.95, method: 't' } : { kind: k },
            })
          }
          items={[
            { value: 'none', label: t('uncertainty.kinds.none') },
            { value: 'sd', label: t('uncertainty.kinds.sd') },
            { value: 'sem', label: t('uncertainty.kinds.sem') },
            { value: 'ci', label: t('uncertainty.kinds.ci') },
          ]}
        />
      ) : null}
      {opts.aggregate === 'mean' && opts.spread.kind !== 'none' ? (
        <Hint>{t('uncertainty.sdVsSem')}</Hint>
      ) : null}
      <SwitchRow
        label={t('style.showObservations')}
        checked={opts.showObservations}
        onChange={(showObservations) => setBar({ ...opts, showObservations })}
        hint={t('help.topics.groups.body')}
      />
    </Section>
  )
}

function HistogramSection({ plot }: { plot: PlotSpec }) {
  const t = useT()
  const loc = useNumberLocale()
  const opts = plot.histogram
  const histogramOptions = (patch: Partial<HistogramOptions>) =>
    setPlotOptions('histogram', patch, undefined, plot.id)
  const { dataset, view } = useDatasetChoice(opts.datasetId)
  if (!dataset) return null
  return (
    <Section title={t('plot.types.histogram')}>
      <DatasetPicker
        value={opts.datasetId}
        onChange={(datasetId) => histogramOptions({ datasetId, value: null, groupBy: null })}
      />
      <Choice<ColumnId>
        label={t('style.histogramColumn')}
        value={opts.value}
        items={numericColumnItems(dataset, view, t)}
        onChange={(value) => histogramOptions({ datasetId: dataset.id, value })}
      />
      {/* Grouping changes what each bar counts (per group, on shared bins): a data choice, like the box plot's. */}
      <Choice<ColumnId>
        label={t('style.histogramGroup')}
        value={opts.groupBy ?? NO_COLUMN}
        items={groupColumnItems(dataset, view, t, {
          none: t('style.histogramNoGroup'),
          // The counted column is drawn along x.
          axes: opts.value ? { x: opts.value, y: opts.value } : undefined,
        })}
        onChange={(g) => histogramOptions({ datasetId: dataset.id, groupBy: g === NO_COLUMN ? null : g })}
      />
      {opts.groupBy ? (
        <>
          <Choice<HistogramOptions['groupMode']>
            label={t('style.histogramGroupMode')}
            value={opts.groupMode}
            onChange={(groupMode) => histogramOptions({ groupMode })}
            items={[
              { value: 'overlay', label: t('style.groupModes.overlay') },
              { value: 'stack', label: t('style.groupModes.stack') },
            ]}
          />
          <Hint>{t('style.groupModeHint')}</Hint>
        </>
      ) : null}
      <Choice<'auto' | 'count' | 'width'>
        label={t('style.bins')}
        value={opts.bins.mode}
        onChange={(mode) =>
          histogramOptions({
            bins:
              mode === 'auto'
                ? { mode }
                : mode === 'count'
                  ? { mode, count: 10 }
                  : { mode, width: 1, start: null },
          })
        }
        items={[
          { value: 'auto', label: t('style.binsAuto') },
          { value: 'count', label: t('style.binsCount') },
          { value: 'width', label: t('style.binsWidth') },
        ]}
      />
      {opts.bins.mode === 'count' ? (
        <NumberField
          label={t('style.binsCount')}
          value={opts.bins.count}
          decimal={loc.decimal}
          validate={(v) =>
            Number.isInteger(v) && v >= 1 && v <= 500
              ? null
              : t('common.wholeNumberBetween', { min: 1, max: 500 })
          }
          onCommit={(v) => v !== null && histogramOptions({ bins: { mode: 'count', count: v } })}
        />
      ) : null}
      {opts.bins.mode === 'width' ? (
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label={t('style.binsWidth')}
            value={opts.bins.width}
            decimal={loc.decimal}
            validate={(v) => (v > 0 ? null : t('common.numberPositive'))}
            onCommit={(v) =>
              v !== null &&
              opts.bins.mode === 'width' &&
              histogramOptions({ bins: { ...opts.bins, width: v } })
            }
          />
          <NumberField
            label={t('style.binStart')}
            value={opts.bins.start}
            allowEmpty
            decimal={loc.decimal}
            onCommit={(v) =>
              opts.bins.mode === 'width' && histogramOptions({ bins: { ...opts.bins, start: v } })
            }
          />
        </div>
      ) : null}
      <Hint>{t('help.methodsBody.bins')}</Hint>
    </Section>
  )
}

function BoxSection({ plot }: { plot: PlotSpec }) {
  const t = useT()
  const opts = plot.box
  const boxOptions = (patch: Partial<BoxOptions>) => setPlotOptions('box', patch, undefined, plot.id)
  const { dataset, view } = useDatasetChoice(opts.datasetId)
  if (!dataset) return null
  const groupItems = [
    { value: '__none__' as ColumnId, label: t('style.boxNoGroup') },
    ...categoryColumnItems(dataset),
  ]
  return (
    <Section title={t('plot.types.box')}>
      <DatasetPicker
        value={opts.datasetId}
        onChange={(datasetId) => boxOptions({ datasetId, value: null, groupBy: null })}
      />
      <Choice<ColumnId>
        label={t('style.boxColumn')}
        value={opts.value}
        items={numericColumnItems(dataset, view, t)}
        onChange={(value) => boxOptions({ datasetId: dataset.id, value })}
      />
      <Choice<ColumnId>
        label={t('style.boxGroup')}
        value={opts.groupBy ?? ('__none__' as ColumnId)}
        items={groupItems}
        onChange={(g) => boxOptions({ groupBy: g === '__none__' ? null : g })}
      />
      <Choice<'all' | 'outliers' | 'none'>
        label={t('style.boxPoints')}
        value={opts.points}
        onChange={(points) => boxOptions({ points })}
        items={[
          { value: 'all', label: t('style.boxPointsAll') },
          { value: 'outliers', label: t('style.boxPointsOutliers') },
          { value: 'none', label: t('style.boxPointsNone') },
        ]}
      />
      <SwitchRow
        label={t('style.boxMean')}
        checked={opts.showMean}
        onChange={(showMean) => boxOptions({ showMean })}
      />
      <Hint>{t('help.methodsBody.whiskers')}</Hint>
    </Section>
  )
}
