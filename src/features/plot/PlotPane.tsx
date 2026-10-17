import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Plus } from 'lucide-react'
import { buildFigure, type FigureInput } from '@/domain/figure/buildFigure'
import { COMPACT_PANE_HEIGHT, NARROW_PANE_WIDTH } from '@/domain/figure/layout'
import { rowsFromPlotlyPoints } from '@/domain/figure/selectionMap'
import { seriesLabels } from '@/domain/figure/labels'
import { uidOwner } from '@/domain/figure/traces/common'
import { asRowId, type DatasetId, type PlotId, type SeriesId } from '@/domain/model'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Select as SelectPrimitive } from '@base-ui/react/select'
import { toast } from '@/components/ui/toast'
import { useI18n, useT } from '@/i18n/I18nProvider'
import { issueHint, issueTitle } from '@/i18n/translate'
import { PlotCanvasLazy } from '@/plot/PlotCanvasLazy'
import { preloadPlot } from '@/plot/preload'
import type { PlotCanvasHandle, PlotPoint } from '@/plot/PlotCanvas'
import { fontsReady, PLOT_FONT_FAMILY } from '@/platform/fonts'
import { useDerivedPlot, useNumberLocale } from '@/state/derived'
import { useProjectStore } from '@/state/projectStore'
import { ui, useUiStore } from '@/state/uiStore'
import { setSeriesVisibility } from '@/state/actions/plot'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { AreaError } from '@/app/AreaError'
import { cn } from '@/lib/utils'
import { NewPlotMenu } from './NewPlotMenu'
import { PlotSkeleton } from './PlotSkeleton'
import { PlotWarnings } from './PlotWarnings'
import { SampleBadge } from './SampleBadge'
import { commitPendingEdit, paneId, plotDatasetIds, tabId, usePlotLabels } from './plotLabels'
import { useRegisterPane } from './paneRegistry'
import { useStaggered } from './useStaggered'
import { useTableHoverLabel } from './useTableHoverLabel'

/**
 * One pane of the plot area. Focusing it (pointer down or keyboard focus inside) makes its plot the
 * active plot that the toolbar and the inspector edit. `split`: side-by-side layout, with a compact
 * header and a ring on the focused pane.
 */
export function PlotPane({
  index,
  plotId,
  split,
  focused,
}: {
  index: number
  plotId: PlotId | null
  split: boolean
  focused: boolean
}) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const focus = () => {
    if (focused) return
    commitPendingEdit(ref.current)
    ui.focusPane(index)
  }
  return (
    <div
      ref={ref}
      id={paneId(index)}
      data-plot-pane={index}
      data-plot-id={plotId ?? undefined}
      data-focused={focused ? '' : undefined}
      role={plotId ? 'tabpanel' : 'region'}
      aria-labelledby={plotId ? tabId(plotId) : undefined}
      aria-label={plotId ? undefined : t('plot.pane.label', { n: index + 1 })}
      onPointerDownCapture={focus}
      onFocusCapture={focus}
      className={cn(
        'relative flex h-full min-h-0 min-w-0 flex-col bg-background',
        // The focused pane's ring: drawn above the canvas, never in the way of the pointer.
        split &&
          'after:pointer-events-none after:absolute after:inset-0 after:z-(--z-sticky) after:opacity-0 after:shadow-[inset_0_0_0_2px_var(--ring)] after:transition-opacity after:duration-(--dur-press) after:ease-(--ease-out-ui) data-focused:after:opacity-100',
      )}
    >
      {plotId ? (
        <PaneBody key={plotId} index={index} plotId={plotId} split={split} focused={focused} />
      ) : (
        <EmptyPane index={index} />
      )}
    </div>
  )
}

/** Plot switcher of a pane: choosing a plot shown in another pane swaps the two. */
function PaneSwitcher({ index, plotId, header }: { index: number; plotId: PlotId | null; header: boolean }) {
  const t = useT()
  const plots = useProjectStore((s) => s.doc.plots)
  const labels = usePlotLabels()
  const items = plots.map((p) => ({ value: p.id, label: labels.get(p.id) ?? '' }))
  return (
    <Select
      items={items}
      value={plotId}
      onValueChange={(v) => {
        if (v) ui.showPlot(v as PlotId, index)
      }}
    >
      <SelectPrimitive.Label className="sr-only">
        {t('plot.pane.switcher', { n: index + 1 })}
      </SelectPrimitive.Label>
      <SelectTrigger
        size="sm"
        className={
          header
            ? 'h-6 min-w-0 shrink border-transparent bg-transparent px-1.5 text-sm font-medium'
            : 'w-56 max-w-full bg-background'
        }
      >
        <SelectValue placeholder={t('plot.pane.choose')} className="min-w-0 truncate" />
      </SelectTrigger>
      <SelectContent align="start" alignItemWithTrigger={false} className="max-w-80">
        {items.map((i) => (
          <SelectItem key={i.value} value={i.value}>
            <span className="truncate">{i.label}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** An empty pane teaches its next step: choose a plot for it, or create one. */
function EmptyPane({ index }: { index: number }) {
  const t = useT()
  const hasPlots = useProjectStore((s) => s.doc.plots.length > 0)
  return (
    <div className="flex h-full flex-col items-start justify-center gap-2 px-8 py-6">
      <p className="text-sm font-semibold">{hasPlots ? t('plot.pane.choose') : t('plot.pane.noPlots')}</p>
      <p className="max-w-prose text-sm text-muted-foreground">
        {hasPlots ? t('plot.pane.chooseLead') : t('plot.pane.noPlotsLead')}
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        {hasPlots ? <PaneSwitcher index={index} plotId={null} header={false} /> : null}
        <NewPlotMenu
          pane={index}
          render={
            <Button
              size="sm"
              variant={hasPlots ? 'outline' : 'default'}
              className={hasPlots ? 'bg-background' : undefined}
            />
          }
        >
          <Plus aria-hidden />
          {t('plot.tabs.newPlot')}
        </NewPlotMenu>
      </div>
    </div>
  )
}

function useFontsLoaded(): boolean {
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    let alive = true
    void fontsReady().then(() => alive && setLoaded(true))
    preloadPlot()
    return () => {
      alive = false
    }
  }, [])
  return loaded
}

/**
 * Size of the plot area (CSS px) for FigureContext.paneHeight / paneWidth. The figure only compares them
 * with COMPACT_PANE_HEIGHT and NARROW_PANE_WIDTH, so the state changes only when the pane crosses one
 * of them: dragging a divider does not rebuild the figure at every frame.
 */
function usePaneSize(ref: RefObject<HTMLDivElement | null>): { height?: number; width?: number } {
  const [size, setSize] = useState<{ height?: number; width?: number }>({})
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const side = (prev: number | undefined, next: number, limit: number) =>
      prev !== undefined && prev < limit === next < limit ? prev : next
    const update = () => {
      const h = el.clientHeight
      const w = el.clientWidth
      if (h <= 0 || w <= 0) return
      setSize((prev) => {
        const height = side(prev.height, h, COMPACT_PANE_HEIGHT)
        const width = side(prev.width, w, NARROW_PANE_WIDTH)
        return height === prev.height && width === prev.width ? prev : { height, width }
      })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return size
}

function PaneBody({
  index,
  plotId,
  split,
  focused,
}: {
  index: number
  plotId: PlotId
  split: boolean
  focused: boolean
}) {
  const { t, lang } = useI18n()
  const derived = useDerivedPlot(plotId)
  const loc = useNumberLocale()
  const fontsLoaded = useFontsLoaded()
  const uses = useMemo(() => new Set<DatasetId>(plotDatasetIds(derived.plot)), [derived.plot])
  // A selection is shared by every plot of its dataset; the others neither redraw nor highlight. The
  // focused pane draws it at once, the other panes one task after another (useStaggered).
  const selection = useStaggered(
    useUiStore((s) => (s.selection && uses.has(s.selection.datasetId) ? s.selection : null)),
    focused ? 0 : index + 1,
  )
  // Table → plot hover labels go to the focused pane only.
  const hoverRow = useUiStore((s) =>
    focused && s.hoverRow?.origin === 'table' && uses.has(s.hoverRow.datasetId) ? s.hoverRow : null,
  )
  const dragmode = useUiStore((s) => s.dragmode)
  const viewResetCounter = useUiStore((s) => s.viewResets[plotId] ?? 0)
  const advanced = useUiStore((s) => s.level === 'advanced')
  const canvas = useRef<PlotCanvasHandle>(null)
  const area = useRef<HTMLDivElement>(null)
  const { height: paneHeight, width: paneWidth } = usePaneSize(area)
  // The zoom this plot had when it was last on screen, restored by the canvas on its first draw.
  const [initialView] = useState(() => ui.get().views[plotId] ?? null)

  // A new DerivedProject comes with every edit of the document; its two stages stay the same objects
  // unless this plot or the datasets changed, so an edit of another plot does not redraw this pane.
  const { data, plot: plotStage } = derived.parts
  const input = useMemo<FigureInput>(
    () => ({
      doc: data.doc,
      views: data.views,
      columnSample: data.columnSample,
      plot: plotStage.plot,
      plotView: plotStage.plotView,
      series: plotStage.series,
      axisScales: plotStage.axisScales,
    }),
    [data, plotStage],
  )
  const figure = useMemo(
    () =>
      buildFigure(input, {
        mode: 'screen',
        lang,
        loc,
        t,
        selection,
        dragmode,
        viewResetCounter,
        fontFamily: PLOT_FONT_FAMILY,
        advanced,
        paneHeight,
        paneWidth,
      }),
    [input, lang, loc, t, selection, dragmode, viewResetCounter, advanced, paneHeight, paneWidth],
  )
  // A zoom recorded under another uirevision (other columns, scale or type) no longer describes the plot.
  const viewRev = String(figure.layout.uirevision ?? '')
  useRegisterPane(plotId, canvas, viewRev)

  const datasetOfUid = useCallback(
    (uid: string | undefined): DatasetId | null => {
      if (!uid) return null
      const seriesId = uidOwner(uid) as SeriesId
      return (
        plotStage.series.find((s) => s.spec.id === seriesId)?.spec.datasetId ??
        plotStage.plot?.bar.datasetId ??
        plotStage.plot?.histogram.datasetId ??
        plotStage.plot?.box.datasetId ??
        null
      )
    },
    [plotStage],
  )

  const onSelected = useCallback(
    (points: readonly PlotPoint[]) => {
      // Plotly re-emits an empty selection when it redraws: clearing is done by double-click / Esc / Clear.
      if (!points.length) return
      // A selection belongs to one dataset: keep the one with most selected points.
      const byDataset = new Map<DatasetId, PlotPoint[]>()
      for (const p of points) {
        const ds = datasetOfUid(p.data?.uid)
        if (!ds) continue
        byDataset.set(ds, [...(byDataset.get(ds) ?? []), p])
      }
      if (!byDataset.size) return ui.clearSelection()
      const [datasetId, pts] = [...byDataset.entries()].sort((a, b) => b[1].length - a[1].length)[0]
      if (byDataset.size > 1) {
        const name = useProjectStore.getState().doc.datasets.find((d) => d.id === datasetId)?.name ?? ''
        toast.add({
          title: issueTitle(t, { code: 'I_SELECTION_ONE_DATASET', params: { name } }),
          type: 'info',
        })
      }
      const rows = rowsFromPlotlyPoints(pts, figure.selectionMap)
      ui.select(rows.length ? { datasetId, rowIds: new Set(rows), origin: 'plot', anchor: null } : null)
    },
    [datasetOfUid, figure.selectionMap, t],
  )

  const onPointClick = useCallback(
    (p: PlotPoint) => {
      const datasetId = datasetOfUid(p.data?.uid)
      const rows = rowsFromPlotlyPoints([p], figure.selectionMap)
      if (!datasetId || !rows.length) return
      const cur = ui.get().selection
      const next = new Set(cur && cur.datasetId === datasetId ? cur.rowIds : [])
      if (next.has(rows[0]) && next.size === 1) next.clear()
      else {
        next.clear()
        next.add(rows[0])
      }
      ui.select(next.size ? { datasetId, rowIds: next, origin: 'plot', anchor: asRowId(rows[0]) } : null)
    },
    [datasetOfUid, figure.selectionMap],
  )

  const onLegendClick = useCallback(
    (uid: string | undefined) => {
      const seriesId = uid ? uidOwner(uid) : undefined
      const s = derived.series.find((x) => x.spec.id === seriesId)
      if (!s) return false
      // The same label as the legend and the inspector, so two series with the same y stay distinct.
      const labels = seriesLabels(
        derived.series.map((x) => x.spec),
        useProjectStore.getState().doc.datasets,
        t,
      )
      setSeriesVisibility(s.spec.id, !s.spec.visible, labels.get(s.spec.id) ?? s.yColumn.name)
      return false
    },
    [derived.series, t],
  )

  const onHoverPoint = useCallback(
    (p: PlotPoint | null) => {
      if (!p) {
        if (ui.get().hoverRow?.origin === 'plot') ui.set({ hoverRow: null })
        return
      }
      const datasetId = datasetOfUid(p.data?.uid)
      const rows = rowsFromPlotlyPoints([p], figure.selectionMap)
      if (datasetId && rows.length)
        ui.set({ hoverRow: { datasetId, rowId: asRowId(rows[0]), origin: 'plot' } })
    },
    [datasetOfUid, figure.selectionMap],
  )

  useTableHoverLabel(canvas, hoverRow, figure.selectionMap.byRow)

  const notConfigured = figure.data.length === 0
  const blocking = figure.issues.find((i) => i.severity === 'error')
  const notes = figure.issues.filter((i) => i.severity !== 'error')

  return (
    <>
      {split ? (
        // Not a toolbar: the one toolbar of the plot area is above the panes.
        <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border pr-2 pl-1">
          <PaneSwitcher index={index} plotId={plotId} header />
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <SampleBadge plotId={plotId} />
            <PlotWarnings plotId={plotId} issues={notes} compact />
          </div>
        </div>
      ) : (
        <PlotWarnings plotId={plotId} issues={notes} />
      )}
      <div ref={area} className="relative min-h-0 flex-1 px-1 pt-1">
        <ErrorBoundary fallback={(reset, err) => <AreaError reset={reset} error={err} />} resetKey={plotId}>
          {notConfigured ? (
            <div className="flex h-full flex-col items-start justify-center gap-1 px-8">
              <p className="text-sm font-semibold">
                {blocking ? issueTitle(t, blocking) : t('plot.emptyTitle')}
              </p>
              <p className="max-w-prose text-sm text-muted-foreground">{t('plot.emptyLead')}</p>
            </div>
          ) : !fontsLoaded ? (
            <PlotSkeleton />
          ) : (
            <PlotCanvasLazy
              ref={canvas}
              fallback={<PlotSkeleton />}
              data={figure.data}
              layout={figure.layout}
              config={figure.config}
              ariaLabel={figure.a11y}
              initialView={initialView}
              onSelected={onSelected}
              onDeselect={() => ui.clearSelection()}
              onPointClick={onPointClick}
              onLegendClick={onLegendClick}
              onViewChange={(view) => ui.setView(plotId, { ...view, rev: viewRev })}
              onHoverPoint={onHoverPoint}
              onError={(err) => {
                // Same shape as import errors: title says what failed, description gives the next step.
                const issue = { code: 'E_PLOT_RENDER' as const, params: { reason: err.message } }
                toast.add({
                  title: issueTitle(t, issue),
                  description: issueHint(t, issue) || undefined,
                  type: 'error',
                })
              }}
            />
          )}
        </ErrorBoundary>
        {/* One live region at a time: an exclusion would otherwise be read once per pane. */}
        <p className="sr-only" aria-live={focused ? 'polite' : 'off'}>
          {figure.indicator ?? ''}
        </p>
      </div>
    </>
  )
}
