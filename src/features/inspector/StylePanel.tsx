import { useId, useMemo, useRef, type ReactNode } from 'react'
import { Radio } from '@base-ui/react/radio'
import { RotateCcw } from 'lucide-react'
import type { DerivedSeries } from '@/domain/derive/pipeline'
import { groupLabel } from '@/domain/figure/groups'
import { seriesLabels } from '@/domain/figure/labels'
import {
  NEUTRAL,
  SERIES_COLORS,
  SERIES_SYMBOLS,
  fitAppearance,
  type SeriesLineMode,
} from '@/domain/figure/palette'
import {
  DEFAULT_FIT_STYLE,
  type FitSpec,
  type FitStyle,
  type LegendPosition,
  type LineDash,
  type MarkerSymbol,
  type PlotSpec,
  type XYSeriesSpec,
} from '@/domain/model'
import { Button } from '@/components/ui/button'
import { Choice } from '@/components/app/Choice'
import { Hint } from '@/components/app/Feedback'
import { IconButton } from '@/components/app/IconButton'
import { NumberField } from '@/components/app/NumberField'
import { Section } from '@/components/app/Section'
import { SwitchRow } from '@/components/app/SwitchRow'
import { TextField } from '@/components/app/TextField'
import { RadioGroup } from '@/components/ui/radio-group'
import { useT } from '@/i18n/I18nProvider'
import type { Translator } from '@/i18n/translate'
import { formatPlain } from '@/lib/numberInput'
import { cn } from '@/lib/utils'
import { updateFit } from '@/state/actions/analysis'
import {
  renameSeries,
  resetGroupStyles,
  setBarOptions,
  setGroupStyle,
  setLegend,
  setPlotOptions,
  setTitle,
  updateSeriesStyle,
} from '@/state/actions/plot'
import { useActivePlot, useDerived, useNumberLocale } from '@/state/derived'
import { useProjectStore } from '@/state/projectStore'
import { COLOR_NAMES, paletteSlot, xyAppearance, type Look, type XYAppearance } from './appearance'
import { LineSwatch, MarkerSwatch } from './Swatch'

const SYMBOLS: (MarkerSymbol | 'auto')[] = ['auto', ...SERIES_SYMBOLS]
const DASHES: LineDash[] = ['solid', 'dash', 'dot', 'dashdot', 'longdash', 'longdashdot']
const POSITIONS: LegendPosition[] = [
  'auto',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
  'outside',
]
/**
 * Explicit fit widths. The stored DEFAULT_FIT_STYLE.width (2) stands for "Automatic" (fitAppearance:
 * 2.25 px where the fit is the series' only line, else 2 px), which every existing document stores, so
 * 2 itself is never offered as an explicit width: it would be drawn as the automatic one.
 */
const FIT_WIDTHS = [1, 1.5, 2.5, 3, 4]

const colorName = (t: Translator, index: number) => t(`style.colors.${COLOR_NAMES[paletteSlot(index)]}`)

export function StylePanel() {
  const t = useT()
  const plot = useActivePlot()
  const derived = useDerived()
  const fits = useProjectStore((s) => s.doc.fits)
  const datasets = useProjectStore((s) => s.doc.datasets)
  const series = plot?.series
  const labels = useMemo(() => seriesLabels(series ?? [], datasets, t), [series, datasets, t])
  const looks = useMemo(() => xyAppearance(derived.series), [derived.series])
  if (!plot) return <p className="p-3 text-sm text-muted-foreground">{t('plot.noPlot')}</p>
  const xy = plot.type === 'scatter' || plot.type === 'line'
  return (
    <div>
      <Section title={t('style.title')}>
        <TextField
          label={t('style.title')}
          hideLabel
          value={plot.title}
          placeholder={t('style.titlePlaceholder')}
          onCommit={(v) => setTitle(v, plot.id)}
        />
      </Section>
      <Section title={t('style.legend')}>
        <SwitchRow
          label={t('style.legend')}
          checked={plot.legend.visible}
          onChange={(visible) => setLegend({ visible }, plot.id)}
        />
        {plot.legend.visible ? (
          <Choice<LegendPosition>
            label={t('style.legendPosition')}
            value={plot.legend.position}
            onChange={(position) => setLegend({ position }, plot.id)}
            items={POSITIONS.map((p) => ({ value: p, label: t(`style.positions.${p}`) }))}
          />
        ) : null}
      </Section>
      {plot.type === 'scatter' ? (
        <Section title={t('plot.types.scatter')}>
          <SwitchRow
            label={t('style.showExcluded')}
            checked={plot.scatter.showExcluded}
            onChange={(showExcluded) => setPlotOptions('scatter', { showExcluded }, undefined, plot.id)}
          />
        </Section>
      ) : null}
      {plot.type === 'line' ? (
        <Section title={t('plot.types.line')}>
          <SwitchRow
            label={t('style.lineMarkers')}
            checked={plot.line.markers}
            onChange={(markers) => setPlotOptions('line', { markers }, undefined, plot.id)}
          />
          <SwitchRow
            label={t('style.sortByX')}
            checked={plot.line.sortByX}
            onChange={(sortByX) => setPlotOptions('line', { sortByX }, undefined, plot.id)}
          />
        </Section>
      ) : null}
      {plot.type === 'box' ? (
        <Section title={t('plot.types.box')}>
          <SwitchRow
            label={t('style.colorByGroup')}
            checked={plot.box.colorByGroup}
            disabled={!plot.box.groupBy}
            onChange={(colorByGroup) => setPlotOptions('box', { colorByGroup }, undefined, plot.id)}
            hint={plot.box.groupBy ? undefined : t('style.colorByGroupNeedsGroup')}
          />
        </Section>
      ) : null}
      {plot.type === 'bar' ? (
        <Section title={t('plot.types.bar')}>
          <SwitchRow
            label={t('style.colorByCategory')}
            checked={plot.bar.colorByCategory}
            onChange={(colorByCategory) => setBarOptions({ ...plot.bar, colorByCategory }, plot.id)}
          />
        </Section>
      ) : null}
      {xy
        ? plot.series.map((s, i) => (
            <SeriesStyleEditor
              key={s.id}
              series={s}
              index={i}
              plot={plot}
              label={labels.get(s.id) ?? ''}
              derivedSeries={derived.series.find((d) => d.spec.id === s.id)}
              looks={looks}
              fit={fits.find((f) => f.seriesId === s.id) ?? null}
            />
          ))
        : null}
    </div>
  )
}

function SeriesStyleEditor({
  series,
  index,
  plot,
  label,
  derivedSeries,
  looks,
  fit,
}: {
  series: XYSeriesSpec
  index: number
  plot: PlotSpec
  /** seriesLabels: the name the legend shows. */
  label: string
  derivedSeries: DerivedSeries | undefined
  looks: XYAppearance
  /** The series' fit (the first of the document, as the pipeline reads it). */
  fit: FitSpec | null
}) {
  const t = useT()
  const loc = useNumberLocale()
  const derived = useDerived()
  const isLine = plot.type === 'line'
  const yName =
    derived.doc.datasets.find((d) => d.id === series.datasetId)?.columns.find((c) => c.id === series.y)
      ?.name ?? ''
  const look: Look = derivedSeries
    ? looks.series(derivedSeries)
    : {
        color: SERIES_COLORS[paletteSlot(series.style.paletteIndex)],
        symbol: 'circle',
        dash: 'solid',
        open: false,
      }
  const colorLabelId = useId()
  const range = (min: number, max: number) =>
    t('common.numberBetween', { min: formatPlain(min, loc.decimal), max: formatPlain(max, loc.decimal) })
  const split = derivedSeries?.split ?? null
  return (
    <Section title={label} collapsible defaultOpen={index === 0}>
      <TextField
        label={t('series.name')}
        value={series.name ?? ''}
        placeholder={yName}
        onCommit={(v) => renameSeries(series.id, v || null)}
      />
      {/* A split series is drawn in its groups' colours, and in their markers when it is the plot's only
          series: its own colour (and then marker) would change nothing, so they are not offered. */}
      {split ? (
        <p className="text-xs text-muted-foreground">
          {t('style.splitColorNote', { markers: looks.several ? 'series' : 'groups' })}
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          <span id={colorLabelId} className="text-xs text-muted-foreground">
            {t('style.color')}
          </span>
          {/* Base UI radio group: one Tab stop, arrow keys move and select (WAI-ARIA radio pattern). */}
          <RadioGroup
            aria-labelledby={colorLabelId}
            // The swatch of the colour drawn: an index past the palette cycles like in the figure.
            value={paletteSlot(series.style.paletteIndex)}
            onValueChange={(ci: number) => updateSeriesStyle(series.id, { paletteIndex: ci })}
            className="flex flex-wrap gap-1"
          >
            {SERIES_COLORS.map((c, ci) => (
              <Radio.Root
                key={c}
                value={ci}
                aria-label={colorName(t, ci)}
                title={colorName(t, ci)}
                className={SWATCH}
                style={{ backgroundColor: c }}
              />
            ))}
          </RadioGroup>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        {!split || looks.several ? (
          <Choice<MarkerSymbol | 'auto'>
            label={t('style.marker')}
            value={series.style.symbol}
            onChange={(symbol) => updateSeriesStyle(series.id, { symbol })}
            items={SYMBOLS.map((s) => ({
              value: s,
              label:
                s === 'auto'
                  ? `${t('style.symbols.auto')} (${t(`style.symbols.${look.symbol}`)})`
                  : t(`style.symbols.${s}`),
            }))}
          />
        ) : null}
        <NumberField
          label={t('style.markerSize')}
          value={series.style.markerSize}
          decimal={loc.decimal}
          validate={(v) => (v >= 2 && v <= 20 ? null : range(2, 20))}
          onCommit={(markerSize) => markerSize !== null && updateSeriesStyle(series.id, { markerSize })}
        />
      </div>
      <SwitchRow
        label={t('style.markerOpen')}
        checked={series.style.open}
        onChange={(open) => updateSeriesStyle(series.id, { open })}
      />
      {isLine ? (
        <div className="grid grid-cols-2 gap-2">
          <Choice<LineDash | 'auto'>
            label={t('style.line')}
            value={series.style.lineDash}
            onChange={(lineDash) => updateSeriesStyle(series.id, { lineDash })}
            items={(['auto', ...DASHES] as const).map((d) => ({
              value: d,
              label:
                d === 'auto'
                  ? `${t('style.dashes.auto')} (${t(`style.dashes.${look.dash}`)})`
                  : t(`style.dashes.${d}`),
            }))}
          />
          <NumberField
            label={t('style.lineWidth')}
            value={series.style.lineWidth}
            decimal={loc.decimal}
            validate={(v) => (v >= 0.5 && v <= 6 ? null : range(0.5, 6))}
            onCommit={(lineWidth) => lineWidth !== null && updateSeriesStyle(series.id, { lineWidth })}
          />
        </div>
      ) : null}
      {derivedSeries && split ? (
        <GroupStyles series={series} derivedSeries={derivedSeries} looks={looks} />
      ) : null}
      {fit ? (
        <FitLineEditor
          fit={fit}
          look={look}
          plotType={plot.type}
          lineMode={series.style.lineWidth > 0 ? 'lines' : 'markers'}
          // A pooled fit over the groups is neutral; per-group fits take each group's colour.
          grouping={split ? (fit.perGroup ? 'group' : 'pooled') : 'none'}
          // A split can have no group to draw (every x or y of the series missing or unreadable).
          firstGroupColor={
            split?.groups.length && derivedSeries
              ? looks.group(derivedSeries, split.groups[0].key).color
              : null
          }
        />
      ) : null}
    </Section>
  )
}

/** A colour radio: the checked one ringed in the text colour; each has its colour's name. */
const SWATCH_FRAME =
  'h-6 shrink-0 rounded-sm border border-border-strong hover:border-foreground focus-visible:outline-offset-3 data-checked:ring-2 data-checked:ring-foreground data-checked:ring-offset-1 data-checked:ring-offset-panel'
/** 24 px square: the WCAG 2.2 minimum target size. */
const SWATCH = `${SWATCH_FRAME} w-6`

function Subsection({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  const id = useId()
  return (
    <div
      role="group"
      aria-labelledby={id}
      className="@container flex flex-col gap-2 border-t border-border pt-3"
    >
      <div className="flex min-h-6 items-center justify-between gap-2">
        <h4 id={id} className="text-xs font-semibold text-foreground">
          {title}
        </h4>
        {aside}
      </div>
      {children}
    </div>
  )
}

/** Per-group colour and marker of a split series, each overriding the automatic one until reset. */
function GroupStyles({
  series,
  derivedSeries,
  looks,
}: {
  series: XYSeriesSpec
  derivedSeries: DerivedSeries
  looks: XYAppearance
}) {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  const groups = derivedSeries.split?.groups ?? []
  const overrides = series.split?.overrides ?? []
  const overrideOf = (key: string) => overrides.find((o) => o.key === key)
  // The reset button disappears with the override: keep keyboard focus on that group's colour.
  const focusRow = (i: number) =>
    requestAnimationFrame(() =>
      rootRef.current?.querySelector<HTMLElement>(`[data-group-row="${i}"] [role="combobox"]`)?.focus(),
    )
  return (
    <Subsection
      title={t('style.groups')}
      aside={
        overrides.length ? (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              resetGroupStyles(series.id)
              focusRow(0)
            }}
          >
            {t('style.groupsResetAll')}
          </Button>
        ) : null
      }
    >
      <Hint>{t('style.groupsHint')}</Hint>
      <div ref={rootRef} className="@container flex flex-col gap-2.5">
        {groups.map((g, i) => {
          const name = groupLabel(g, t)
          const look = looks.group(derivedSeries, g.key)
          const auto = looks.auto(derivedSeries, g.key)
          const o = overrideOf(g.key)
          const colourValue = o?.paletteIndex != null ? String(paletteSlot(o.paletteIndex)) : 'auto'
          return (
            <div key={g.key} className="flex flex-col gap-1" data-group-row={i} data-group-key={g.key}>
              <div className="flex min-h-6 items-center gap-1.5">
                <MarkerSwatch color={look.color} symbol={look.symbol} open={look.open} />
                <span className="min-w-0 flex-1 truncate text-xs font-medium" title={name}>
                  {name}
                </span>
                {o ? (
                  <IconButton
                    size="icon-xs"
                    label={t('style.groupReset', { group: name })}
                    onClick={() => {
                      setGroupStyle(series.id, g.key, { paletteIndex: null, symbol: 'auto' })
                      focusRow(i)
                    }}
                  >
                    <RotateCcw aria-hidden />
                  </IconButton>
                ) : null}
              </div>
              <div className="grid grid-cols-1 gap-2 @min-[20rem]:grid-cols-2">
                <Choice<string>
                  label={t('style.groupColor', { group: name })}
                  hideLabel
                  value={colourValue}
                  onChange={(v) =>
                    setGroupStyle(series.id, g.key, { paletteIndex: v === 'auto' ? null : Number(v) })
                  }
                  items={[
                    {
                      value: 'auto',
                      label: t('style.colorAuto', { color: colorName(t, SERIES_COLORS.indexOf(auto.color)) }),
                    },
                    ...SERIES_COLORS.map((_, ci) => ({ value: String(ci), label: colorName(t, ci) })),
                  ]}
                />
                <Choice<MarkerSymbol | 'auto'>
                  label={t('style.groupMarker', { group: name })}
                  hideLabel
                  value={o?.symbol ?? 'auto'}
                  onChange={(symbol) => setGroupStyle(series.id, g.key, { symbol })}
                  items={SYMBOLS.map((s) => ({
                    value: s,
                    label:
                      s === 'auto'
                        ? `${t('style.symbols.auto')} (${t(`style.symbols.${auto.symbol}`)})`
                        : t(`style.symbols.${s}`),
                  }))}
                />
              </div>
            </div>
          )
        })}
      </div>
    </Subsection>
  )
}

/**
 * Colour, pattern and width of a fit curve. "Automatic" shows what it resolves to (fitAppearance, the
 * rule the figure follows): never the data line's pattern, 2.25 px where the fit is the only line.
 */
function FitLineEditor({
  fit,
  look,
  plotType,
  lineMode,
  grouping,
  firstGroupColor,
}: {
  fit: FitSpec
  look: Look
  plotType: PlotSpec['type']
  lineMode: SeriesLineMode
  grouping: 'none' | 'pooled' | 'group'
  firstGroupColor: string | null
}) {
  const t = useT()
  const loc = useNumberLocale()
  const colorLabelId = useId()
  const style = fit.style
  const autoColor =
    grouping === 'pooled' ? NEUTRAL.text : grouping === 'group' ? (firstGroupColor ?? look.color) : look.color
  const resolve = (s: FitStyle) =>
    fitAppearance({ color: autoColor, dash: look.dash }, plotType, lineMode, s, {
      predictionBand: fit.show.predictionBand,
    })
  const drawn = resolve(style)
  const autoDash = resolve({ ...style, dash: 'auto' }).dash
  const autoWidth = resolve({ ...style, width: DEFAULT_FIT_STYLE.width }).width
  const px = (w: number) => t('style.widthPx', { width: formatPlain(w, loc.decimal) })
  const set = (patch: Partial<FitStyle>) => updateFit(fit.id, { style: { ...style, ...patch } })
  const automaticWidth = style.width === DEFAULT_FIT_STYLE.width
  const widths =
    automaticWidth || FIT_WIDTHS.includes(style.width)
      ? FIT_WIDTHS
      : [...FIT_WIDTHS, style.width].sort((a, b) => a - b)
  const colourValue = style.color.mode === 'palette' ? paletteSlot(style.color.index) : -1
  return (
    <Subsection
      title={t('style.fitLine')}
      aside={<LineSwatch color={drawn.color} dash={drawn.dash} width={drawn.width} />}
    >
      <div className="flex flex-col gap-1">
        <span id={colorLabelId} className="text-xs text-muted-foreground">
          {t('style.color')}
        </span>
        <RadioGroup
          aria-labelledby={colorLabelId}
          value={colourValue}
          onValueChange={(v: number) =>
            set({ color: v < 0 ? { mode: 'series' } : { mode: 'palette', index: v } })
          }
          className="flex flex-wrap gap-1"
          data-testid="fit-line-colors"
        >
          <Radio.Root
            value={-1}
            aria-label={t('style.fitColorAuto', { mode: grouping === 'none' ? 'series' : grouping })}
            title={t('style.fitColorAuto', { mode: grouping === 'none' ? 'series' : grouping })}
            // Text only: the preview beside the heading shows the colour it resolves to.
            className={cn(SWATCH_FRAME, 'flex items-center bg-background px-1.5 text-xs text-foreground')}
          >
            {t('style.fitColorAutoShort')}
          </Radio.Root>
          {SERIES_COLORS.map((c, ci) => (
            <Radio.Root
              key={c}
              value={ci}
              aria-label={colorName(t, ci)}
              title={colorName(t, ci)}
              className={SWATCH}
              style={{ backgroundColor: c }}
            />
          ))}
        </RadioGroup>
      </div>
      <div className="grid grid-cols-1 gap-2 @min-[20rem]:grid-cols-2">
        <Choice<LineDash | 'auto'>
          label={t('style.fitDash')}
          value={style.dash}
          onChange={(dash) => set({ dash })}
          items={[
            { value: 'auto', label: t('style.fitDashAuto', { dash: t(`style.dashes.${autoDash}`) }) },
            ...DASHES.map((d) => ({ value: d, label: t(`style.dashes.${d}`) })),
          ]}
        />
        <Choice<string>
          label={t('style.fitWidth')}
          value={automaticWidth ? 'auto' : String(style.width)}
          onChange={(v) => set({ width: v === 'auto' ? DEFAULT_FIT_STYLE.width : Number(v) })}
          items={[
            { value: 'auto', label: t('style.fitWidthAuto', { width: formatPlain(autoWidth, loc.decimal) }) },
            ...widths.map((w) => ({ value: String(w), label: px(w) })),
          ]}
        />
      </div>
    </Subsection>
  )
}
