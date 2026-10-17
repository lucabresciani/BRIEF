/**
 * The derivation pipeline: ProjectDoc + immutable RawTables → everything the table, the
 * statistics panel, the fits and the figure read. Nothing produced here is stored or edited: it is
 * recomputed from the document, and every stage is cached on the identity of its inputs (immer's
 * structural sharing keeps unchanged sub-objects by reference). Datasets, exclusions and filters are
 * shared by every plot (dataset stage); each plot is derived on its own (plot stage).
 *
 * Three sample levels, never mixed:
 * 1. analysis — DatasetView + exclusions + filters → AnalysisSample (column-wise for statistics,
 *    pairwise x/y for series, fits and replicate bars);
 * 2. figure   — axis scales only change SeriesData.render (points ≤ 0 hidden on a log axis);
 * 3. fit domain — checked by the fit gates (E_LOG_DOMAIN_FIT), never a mask.
 * INVARIANCE: scale, plot type, visibility, error-bar visibility, style, fit display options and
 * selection never reach levels 1 and 3, so the same fit and summary objects come back.
 */
import { resolvePlot } from '@/domain/figure/resolvePlot'
import { runFit } from '@/domain/fit/runFit'
import { INACTIVE, effectiveSettings, issue } from '@/domain/model'
import type {
  ColumnId,
  ColumnKind,
  ColumnMeta,
  Dataset,
  DatasetId,
  Exclusion,
  Filter,
  FitSpec,
  Issue,
  PlotId,
  PlotSpec,
  PlotView,
  ProjectDoc,
  RawTable,
  RowId,
  SeriesId,
  UncertaintySpec,
  XUncertaintySpec,
  XYSeriesSpec,
} from '@/domain/model'
import { summarizeColumn } from '@/domain/stats/descriptive'
import { describeUncertainty } from '@/domain/uncertainty/describe'
import { resolveMeasurementBars, resolveReplicateBars } from '@/domain/uncertainty/resolve'
import { analysisSample } from './analysisSample'
import { buildDatasetView } from './datasetView'
import { seriesData } from './series'
import { type GroupSlice, partitionGroups, splitIssues } from './split'
import { domainRows } from './transforms'
import { CELL } from './types'
import type {
  AnalysisSample,
  ColumnSummary,
  DatasetView,
  ErrorBarArrays,
  FitError,
  FitErrorCode,
  FitResult,
  GroupSummary,
  SeriesData,
} from './types'

export { splitGroups } from './split'

export type ReplicateBars = { groups: GroupSummary[]; bars: ErrorBarArrays }

/** One group of a split series (splitGroups), with what was derived from its masked sample. */
export interface DerivedGroup extends GroupSlice {
  /** Replicate statistics within the group (y spec of kind sd / sem / ci), else null. */
  replicate: ReplicateBars | null
  /** The group's own fit when FitSpec.perGroup, else null (the series has one pooled fit). */
  fit: FitResult | null
  /**
   * The group's fit error or warnings and replicate issues, each with params.group = the group label,
   * except those that do not depend on the group's rows (E_COLUMN_NOT_NUMERIC, I_SEM_COVERAGE).
   */
  issues: readonly Issue[]
}

export interface DerivedSeries {
  spec: XYSeriesSpec
  /** Position in plot.series (palette / symbol cycling). */
  index: number
  view: DatasetView
  xColumn: ColumnMeta
  yColumn: ColumnMeta
  /** seriesData(...): the scales affect only data.render, never data.sample. */
  data: SeriesData
  /**
   * Measurement bars on x (per row, aligned with data.rowIds). A column source on a derived x column is
   * refused (all invalid, E_DERIVED_UNCERTAINTY): see measurementBars.
   */
  xBars: ErrorBarArrays | null
  /** Measurement bars on y (per row, same rule); null when y uses replicate statistics. */
  yBars: ErrorBarArrays | null
  /**
   * y spec of kind sd / sem / ci: group statistics and bars aligned with the groups, over the whole
   * series (a split series draws its groups' own replicate statistics instead).
   */
  replicate: ReplicateBars | null
  /** At most one fit per series (the first FitSpec of the document for this series). */
  fitSpec: FitSpec | null
  /**
   * runFit(fitSpec, data, { xUnit, yUnit, yUncertainty: yBars }); null without a fit spec, and null for a
   * split series whose fit is per group (DerivedGroup.fit).
   */
  fit: FitResult | null
  /**
   * The series split by a column (spec.split): its groups in group order. null when not split, and when
   * the column has too many values to split (W_SPLIT_TOO_MANY_GROUPS: drawn whole).
   */
  split: { column: ColumnMeta; groups: readonly DerivedGroup[] } | null
  /**
   * Axis-column problems, bar issues, the fit error or warnings, the split issues and those of its
   * groups, I_ROWS_INACTIVE, I_SAMPLE_DIFFERS.
   */
  issues: Issue[]
}

/** The part of the document the dataset stage reads (and the figure names in its captions). */
export type DocSlice = Pick<ProjectDoc, 'datasets' | 'exclusions' | 'filters'>

/**
 * Dataset stage, shared by every plot. The same object comes back while doc.datasets, doc.exclusions,
 * doc.filters and the raw tables are unchanged, so it can be a memo dependency.
 */
export interface DerivedData {
  /** The slice of the document this stage was derived from. */
  doc: DocSlice
  views: ReadonlyMap<DatasetId, DatasetView>
  datasetIssues: ReadonlyMap<DatasetId, readonly Issue[]>
  /** Every dataset-level issue, in dataset order. */
  issues: readonly Issue[]
  columnSummary(datasetId: DatasetId, columnId: ColumnId): ColumnSummary | null
  columnSample(datasetId: DatasetId, columnIds: readonly ColumnId[]): AnalysisSample | null
}

/**
 * Plot stage of ONE plot. The same object comes back while the dataset stage, the PlotSpec and the fits
 * of its series are unchanged: editing another plot never rebuilds it.
 */
export interface DerivedPlot {
  plot: PlotSpec | null
  plotView: PlotView | null
  series: readonly DerivedSeries[]
  allSeries: readonly DerivedSeries[]
  axisScales: { readonly x: AxisScale; readonly y: AxisScale }
  issues: readonly Issue[]
}

export interface DerivedProject {
  doc: ProjectDoc
  views: ReadonlyMap<DatasetId, DatasetView>
  /**
   * The derived plot: the one asked for (null when that id is not in the document); without an id,
   * doc.activePlotId, else the first plot.
   */
  plot: PlotSpec | null
  plotView: PlotView | null
  /** Series of the plot when it is a scatter or line plot; empty for bar / histogram / box. */
  series: readonly DerivedSeries[]
  /**
   * Every series of the plot, whatever its type: they are always derived, so their fits stay the same
   * objects when the plot type is switched away and back.
   */
  allSeries: readonly DerivedSeries[]
  /** Statistics of one numeric column over its column-wise sample; null for absent / non-numeric columns. */
  columnSummary(datasetId: DatasetId, columnId: ColumnId): ColumnSummary | null
  /** analysisSample over the given columns (all must be usable for a row to be active); null for an absent dataset. */
  columnSample(datasetId: DatasetId, columnIds: readonly ColumnId[]): AnalysisSample | null
  /**
   * Axis scales as DRAWN, the ones every series' render mask was computed with: the requested scales,
   * except that a date axis (every plottable series has a datetime column on it) is always linear in
   * time — there is no logarithmic date axis, so no date is hidden as "≤ 0 on a log axis".
   */
  axisScales: { readonly x: AxisScale; readonly y: AxisScale }
  /** Dataset-level issues (I_BLANK_ROWS, E_TRANSFORM_DOMAIN), by dataset. */
  datasetIssues: ReadonlyMap<DatasetId, readonly Issue[]>
  /**
   * All issues: dataset-level ones, then those of the shown series, then broken series references.
   * The parse reports of the views are not repeated here (the table and column editor show them).
   */
  issues: readonly Issue[]
  /**
   * The two stages this object was assembled from. `doc` is always the current document, so a new
   * DerivedProject comes with every edit; memoised consumers depend on these parts instead.
   */
  parts: { readonly data: DerivedData; readonly plot: DerivedPlot }
}

// ---- small identity caches ----------------------------------------------------------------------

type Deps = readonly unknown[]
interface Slot<T> {
  deps: Deps
  value: T
}

const sameDeps = (a: Deps, b: Deps) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]))

/** The previous slot when every dependency is reference-equal (Object.is), else a freshly computed one. */
function slot<T>(prev: Slot<T> | undefined, deps: Deps, compute: () => T): Slot<T> {
  return prev && sameDeps(prev.deps, deps) ? prev : { deps, value: compute() }
}

/** A Map that keeps at most `max` entries (oldest dropped first). */
class BoundedMap<V> {
  private readonly map = new Map<string, V>()
  private readonly max: number
  constructor(max: number) {
    this.max = max
  }
  get(key: string): V | undefined {
    return this.map.get(key)
  }
  set(key: string, value: V): V {
    this.map.delete(key)
    this.map.set(key, value)
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string)
    return value
  }
}

const sameItems = <T>(a: readonly T[] | undefined, b: readonly T[]) =>
  a !== undefined && a.length === b.length && a.every((v, i) => v === b[i])

/** Same keys with Object.is-equal values (issue params are flat). */
function sameParams(a: Issue['params'], b: Issue['params']): boolean {
  const ka = Object.keys(a ?? {})
  const kb = Object.keys(b ?? {})
  return ka.length === kb.length && ka.every((k) => Object.is(a?.[k], b?.[k]))
}

/**
 * Issues of a group that say nothing about the group's own rows (a fit refused for the column's kind,
 * the coverage of ±1 SEM for a given n): left without params.group and stated once for the series.
 */
const GROUP_INDEPENDENT: ReadonlySet<string> = new Set(['E_COLUMN_NOT_NUMERIC', 'I_SEM_COVERAGE'])

/** Same rows and the same parsed column objects (ColumnMeta edits such as a rename do not count). */
function sameView(a: DatasetView, b: DatasetView): boolean {
  if (
    a.datasetId !== b.datasetId ||
    a.rowIds !== b.rowIds ||
    a.rowIndex !== b.rowIndex ||
    a.blankRows !== b.blankRows ||
    a.sourceRow !== b.sourceRow ||
    a.recordAxis !== b.recordAxis ||
    a.recordBlocks !== b.recordBlocks ||
    a.columnOrder.length !== b.columnOrder.length
  )
    return false
  for (let k = 0; k < a.columnOrder.length; k++) {
    const id = a.columnOrder[k]
    if (id !== b.columnOrder[k] || a.columns.get(id) !== b.columns.get(id)) return false
  }
  return true
}

// ---- per-dataset scope ----------------------------------------------------------------------------

interface DatasetEntry {
  dataset: Dataset
  raw: RawTable | null
  view: DatasetView
  /** Exclusions of this dataset and its ENABLED filters, stable by reference while unchanged. */
  exclusions: readonly Exclusion[]
  filters: readonly Filter[]
  issues: readonly Issue[]
}

/** I_BLANK_ROWS (count only: blank rows are not part of the view) and E_TRANSFORM_DOMAIN per derived column. */
function datasetIssues(dataset: Dataset, view: DatasetView): Issue[] {
  const out: Issue[] = []
  if (view.blankRows.length > 0) out.push(issue('I_BLANK_ROWS', { count: view.blankRows.length }))
  for (const meta of dataset.columns) {
    if (meta.source.type !== 'derived') continue
    const col = view.columns.get(meta.id)
    if (!col) continue
    const rows = domainRows(col)
    if (rows.length > 0)
      out.push(
        issue(
          'E_TRANSFORM_DOMAIN',
          { count: rows.length, op: meta.source.spec.op, column: meta.name },
          { rows, columnId: meta.id },
        ),
      )
  }
  return out
}

// ---- per-series helpers ---------------------------------------------------------------------------

interface GroupEntry {
  replicate?: Slot<ReplicateBars | null>
  fit?: Slot<FitResult | null>
  derived?: Slot<DerivedGroup>
}

interface SplitState {
  value: DerivedSeries['split']
  issues: readonly Issue[]
}

interface SeriesEntry {
  data?: Slot<SeriesData>
  xBars?: Slot<ErrorBarArrays | null>
  yBars?: Slot<ErrorBarArrays | null>
  replicate?: Slot<ReplicateBars | null>
  fit?: Slot<FitResult | null>
  /** Split: the partition (on the sample and the parsed column), then one entry per group key. */
  partition?: Slot<ReturnType<typeof partitionGroups> | null>
  groups?: Map<string, GroupEntry>
  split?: Slot<SplitState>
  derived?: Slot<DerivedSeries>
}

const NUL = '\u0000'
const metaSig = (m: ColumnMeta | undefined) =>
  m ? `${m.id}${NUL}${m.name}${NUL}${m.unit ?? '\u0001'}${NUL}${m.source.type}` : 'absent'

/** Everything resolveMeasurementBars reads from the column metadata (ids, names, units, source types). */
function barSignature(
  spec: UncertaintySpec,
  valueColumn: ColumnMeta,
  columnsById: (id: ColumnId) => ColumnMeta | undefined,
): string {
  const parts = [metaSig(valueColumn)]
  if (spec.kind === 'measurement') {
    const src = spec.source
    if (src.type === 'column') parts.push(metaSig(columnsById(src.column)))
    if (src.type === 'columnAsymmetric')
      parts.push(metaSig(columnsById(src.plus)), metaSig(columnsById(src.minus)))
  }
  return parts.join('\u0002')
}

/**
 * Measurement error bars of a value column (series x / y, bar values). Uncertainty read from a COLUMN
 * belongs to the quantity that column was measured for; a derived value column (ln V, 1/T, …) is a
 * transformed quantity and propagation is not implemented, so a column source on it is refused
 * (E_DERIVED_UNCERTAINTY): every bar invalid (NaN, nothing drawn, nothing compared with the
 * fit). A typed value or percent is the user's own statement about the plotted quantity and is kept.
 */
export function measurementBars(
  spec: XUncertaintySpec,
  values: Float64Array,
  view: DatasetView,
  valueColumn: ColumnMeta,
  columnsById: (id: ColumnId) => ColumnMeta | undefined,
): ErrorBarArrays | null {
  if (
    spec.kind === 'measurement' &&
    valueColumn.source.type === 'derived' &&
    (spec.source.type === 'column' || spec.source.type === 'columnAsymmetric')
  ) {
    const n = values.length
    return {
      plus: new Float64Array(n).fill(NaN),
      minus: spec.source.type === 'columnAsymmetric' ? new Float64Array(n).fill(NaN) : null,
      status: new Uint8Array(n).fill(CELL.invalid),
      descriptor: describeUncertainty(spec),
      issues: [issue('E_DERIVED_UNCERTAINTY', { column: valueColumn.name }, { columnId: valueColumn.id })],
    }
  }
  return resolveMeasurementBars(spec, values, view, valueColumn, columnsById)
}

const modelKey = (s: FitSpec) =>
  s.model.type === 'polynomial' ? `polynomial:${s.model.degree}` : s.model.type

const kindOf = (m: ColumnMeta): ColumnKind => effectiveSettings(m).kind

type AxisScale = 'linear' | 'log'

/** Columns a figure can place on an XY axis (labels and free text cannot). */
const plottable = (m: ColumnMeta) => kindOf(m) === 'numeric' || kindOf(m) === 'datetime'

/**
 * The scales the XY axes are drawn with (see DerivedProject.axisScales). An axis is a date axis when every
 * series whose columns resolve and are plottable has a datetime column on it — the rule buildFigure uses
 * to choose a Plotly 'date' axis — and a date axis is linear.
 */
function drawnScales(plot: PlotSpec, columnsOf: (spec: XYSeriesSpec) => [ColumnMeta, ColumnMeta] | null) {
  const usable: [ColumnMeta, ColumnMeta][] = []
  for (const spec of plot.series) {
    const cols = columnsOf(spec)
    if (cols && plottable(cols[0]) && plottable(cols[1])) usable.push(cols)
  }
  const xDate = usable.length > 0 && usable.every(([x]) => kindOf(x) === 'datetime')
  const yDate = usable.length > 0 && usable.every(([, y]) => kindOf(y) === 'datetime')
  return {
    x: xDate ? 'linear' : plot.xAxis.scale,
    y: yDate ? 'linear' : plot.yAxis.scale,
  } as const satisfies { x: AxisScale; y: AxisScale }
}

/** A fit on a label or date column is refused: its parameters would carry no meaningful unit. */
function notNumericFit(spec: FitSpec, data: SeriesData, column: ColumnMeta): FitError {
  return {
    status: 'error',
    fitId: spec.id,
    model: spec.model,
    error: issue('E_COLUMN_NOT_NUMERIC', { column: column.name }, { columnId: column.id }) as Issue & {
      code: FitErrorCode
    },
    provenance: {
      rowIdsUsed: [],
      nUsed: 0,
      nTotal: data.sample.nTotal,
      inactive: { ...data.sample.counts },
      usesGroupMeans: false,
      confidence: spec.confidence,
      tCritical: null,
    },
  }
}

/** I_ROWS_INACTIVE: "n = 9 of 10 (…)" — `missing` counts missing AND unreadable rows (also given apart). */
function inactiveIssue(sample: AnalysisSample): Issue | null {
  if (sample.nActive === sample.nTotal) return null
  const rows: RowId[] = []
  for (let i = 0; i < sample.reason.length; i++)
    if (sample.reason[i] !== INACTIVE.active) rows.push(sample.rowIds[i] as RowId)
  const c = sample.counts
  return issue(
    'I_ROWS_INACTIVE',
    {
      n: sample.nActive,
      total: sample.nTotal,
      missing: c.missing + c.invalid,
      invalid: c.invalid,
      excluded: c.excluded,
      filtered: c.filtered,
    },
    { rows },
  )
}

// ---- the deriver ----------------------------------------------------------------------------------

const EMPTY: readonly never[] = Object.freeze([])
const LINEAR = Object.freeze({ x: 'linear', y: 'linear' } as const)

type RawTables = Readonly<Record<string, RawTable>>

interface DataState {
  deps: Deps
  entries: ReadonlyMap<DatasetId, DatasetEntry>
  value: DerivedData
}

interface PlotState {
  plotView?: Slot<PlotView | null>
  /** Caches of this plot's series, kept while the plot exists (whichever plot is on screen). */
  series: Map<SeriesId, SeriesEntry>
  lastSeries: readonly DerivedSeries[]
  part?: Slot<DerivedPlot>
  last?: { doc: ProjectDoc; rawTables: RawTables; out: DerivedProject }
}

const newPlotState = (): PlotState => ({ series: new Map(), lastSeries: EMPTY })

const sameEntries = (a: ReadonlyMap<DatasetId, DatasetEntry>, b: ReadonlyMap<DatasetId, DatasetEntry>) =>
  a.size === b.size && [...b].every(([id, e]) => a.get(id) === e)

/** The x and y column metadata of a series; null when its dataset or a column no longer exists. */
function seriesColumns(
  entries: ReadonlyMap<DatasetId, DatasetEntry>,
  spec: XYSeriesSpec,
): [ColumnMeta, ColumnMeta] | null {
  const ds = entries.get(spec.datasetId)
  const x = ds?.dataset.columns.find((c) => c.id === spec.x)
  const y = ds?.dataset.columns.find((c) => c.id === spec.y)
  return x && y ? [x, y] : null
}

/**
 * Returns a memoised deriver in two stages, both cached on the identity of their inputs:
 * - the dataset stage, on (doc.datasets, doc.exclusions, doc.filters, rawTables): a view per (dataset,
 *   rawTable) — a rebuilt view with the same rows and parsed columns is replaced by the previous one, so
 *   a column rename keeps every downstream object — then column statistics, samples and dataset issues;
 * - one plot stage per plot, on (dataset stage, PlotSpec, the fits of its series): series data per
 *   (series columns, view, the dataset's exclusions and enabled filters, scales); bars per (uncertainty
 *   spec, values, view, the column metadata they read); fit per (fit id + model + confidence, x, y,
 *   sample, yBars, units).
 * Only the plot asked for is derived, fits included; the other plots keep their caches until they are
 * asked for or deleted. `plotId` omitted → doc.activePlotId, else the first plot; an id that is not in
 * the document → no plot. Same inputs (by reference) → the same output objects; calling again with the
 * same doc, rawTables and plot returns the same DerivedProject.
 */
export function createDeriver(): (
  doc: ProjectDoc,
  rawTables: Readonly<Record<string, RawTable>>,
  plotId?: PlotId,
) => DerivedProject {
  const samples = new BoundedMap<Slot<AnalysisSample>>(256)
  const summaries = new BoundedMap<Slot<ColumnSummary>>(256)
  let dataState: DataState | null = null
  const plotStates = new Map<PlotId, PlotState>()
  const noPlot = newPlotState()
  let knownPlots: readonly PlotSpec[] | null = null
  let fitIndex: { fits: readonly FitSpec[]; bySeries: Map<SeriesId, FitSpec> } | null = null

  const sampleOf = (e: DatasetEntry, columnIds: readonly ColumnId[]): AnalysisSample => {
    const key = `${e.dataset.id}${NUL}${columnIds.join('\u0001')}`
    const deps = [e.view, e.exclusions, e.filters]
    const prev = samples.get(key)
    const next = slot(prev, deps, () => analysisSample(e.view, columnIds, e.exclusions, e.filters))
    if (next !== prev) samples.set(key, next)
    return next.value
  }

  const summaryOf = (e: DatasetEntry, columnId: ColumnId): ColumnSummary | null => {
    const meta = e.dataset.columns.find((c) => c.id === columnId)
    if (!meta || kindOf(meta) !== 'numeric' || !e.view.columns.has(columnId)) return null
    const key = `${e.dataset.id}${NUL}${columnId}`
    const deps = [e.view, e.exclusions, e.filters]
    const prev = summaries.get(key)
    const next = slot(prev, deps, () => summarizeColumn(e.view, columnId, sampleOf(e, [columnId])))
    if (next !== prev) summaries.set(key, next)
    return next.value
  }

  /** One entry per dataset; an entry whose parts are all unchanged is the previous object. */
  function deriveDatasets(
    doc: ProjectDoc,
    rawTables: RawTables,
    previous: ReadonlyMap<DatasetId, DatasetEntry> | undefined,
  ): Map<DatasetId, DatasetEntry> {
    const next = new Map<DatasetId, DatasetEntry>()
    for (const dataset of doc.datasets) {
      const prev = previous?.get(dataset.id)
      const raw = dataset.origin === 'import' ? (rawTables[dataset.rawTableId] ?? null) : null
      let view: DatasetView
      if (prev && prev.dataset === dataset && prev.raw === raw) view = prev.view
      else {
        const built = buildDatasetView(dataset, raw)
        view = prev && sameView(prev.view, built) ? prev.view : built
      }
      const ex = doc.exclusions.filter((x) => x.datasetId === dataset.id)
      const fi = doc.filters.filter((f) => f.datasetId === dataset.id && f.enabled)
      const exclusions =
        ex.length === 0 ? EMPTY : prev && sameItems(prev.exclusions, ex) ? prev.exclusions : ex
      const filters = fi.length === 0 ? EMPTY : prev && sameItems(prev.filters, fi) ? prev.filters : fi
      const issues =
        prev && prev.dataset === dataset && prev.view === view ? prev.issues : datasetIssues(dataset, view)
      const same =
        prev &&
        prev.dataset === dataset &&
        prev.raw === raw &&
        prev.view === view &&
        prev.exclusions === exclusions &&
        prev.filters === filters &&
        prev.issues === issues
      next.set(dataset.id, same ? prev : { dataset, raw, view, exclusions, filters, issues })
    }
    return next
  }

  function dataStage(doc: ProjectDoc, rawTables: RawTables): DataState {
    const deps = [doc.datasets, doc.exclusions, doc.filters, rawTables]
    const prev = dataState
    if (prev && sameDeps(prev.deps, deps)) return prev
    const entries = deriveDatasets(doc, rawTables, prev?.entries)
    // A new rawTables object with the same tables for these datasets (e.g. a table added for an import
    // still in progress): nothing this stage holds changed.
    if (prev && sameDeps(prev.deps.slice(0, 3), deps.slice(0, 3)) && sameEntries(prev.entries, entries)) {
      dataState = { ...prev, deps }
      return dataState
    }
    // Keep the previous map when it holds the same views in the same order (memoised consumers stay put).
    const views = new Map<DatasetId, DatasetView>()
    for (const [id, e] of entries) views.set(id, e.view)
    const before = prev ? [...prev.value.views] : []
    const after = [...views]
    const sameViews =
      prev !== null &&
      before.length === after.length &&
      after.every(([id, v], k) => before[k][0] === id && before[k][1] === v)

    const byDataset = new Map<DatasetId, readonly Issue[]>()
    const issues: Issue[] = []
    for (const [id, e] of entries) {
      byDataset.set(id, e.issues)
      issues.push(...e.issues)
    }
    const value: DerivedData = {
      doc: { datasets: doc.datasets, exclusions: doc.exclusions, filters: doc.filters },
      views: sameViews ? prev.value.views : views,
      datasetIssues: byDataset,
      issues,
      columnSummary: (datasetId, columnId) => {
        const e = entries.get(datasetId)
        return e ? summaryOf(e, columnId) : null
      },
      columnSample: (datasetId, columnIds) => {
        const e = entries.get(datasetId)
        return e ? sampleOf(e, columnIds) : null
      },
    }
    dataState = { deps, entries, value }
    return dataState
  }

  function deriveSeries(
    entries: ReadonlyMap<DatasetId, DatasetEntry>,
    spec: XYSeriesSpec,
    index: number,
    scales: { x: AxisScale; y: AxisScale },
    fitSpec: FitSpec | null,
    entry: SeriesEntry,
  ): DerivedSeries | Issue {
    const ds = entries.get(spec.datasetId)
    const cols = seriesColumns(entries, spec)
    if (!ds || !cols) return issue('E_INTERNAL_GUARD', { where: 'series', ref: spec.id, problem: 'dangling' })
    const [xColumn, yColumn] = cols
    const { view, exclusions, filters } = ds
    const columnsById = (id: ColumnId) => ds.dataset.columns.find((c) => c.id === id)

    entry.data = slot(
      entry.data,
      [spec.id, spec.datasetId, spec.x, spec.y, view, exclusions, filters, scales.x, scales.y],
      () => seriesData(spec, view, exclusions, filters, scales),
    )
    const data = entry.data.value

    const xSpec = spec.errorBars.x
    entry.xBars = slot(entry.xBars, [xSpec, data.x, view, barSignature(xSpec, xColumn, columnsById)], () =>
      measurementBars(xSpec, data.x, view, xColumn, columnsById),
    )
    const ySpec = spec.errorBars.y
    if (ySpec.kind === 'sd' || ySpec.kind === 'sem' || ySpec.kind === 'ci') {
      entry.yBars = undefined
      // The x column's role decides whether x may vary inside a column-defined group (W_GROUP_X_VARIES).
      entry.replicate = slot(
        entry.replicate,
        [ySpec, data.sample, data.x, data.y, data.rowIds, view, xColumn.role],
        () => resolveReplicateBars(ySpec, data, view, { xRole: xColumn.role }),
      )
    } else {
      entry.replicate = undefined
      entry.yBars = slot(entry.yBars, [ySpec, data.y, view, barSignature(ySpec, yColumn, columnsById)], () =>
        measurementBars(ySpec, data.y, view, yColumn, columnsById),
      )
    }
    const xBars = entry.xBars.value
    const yBars = entry.yBars?.value ?? null
    const replicate = entry.replicate?.value ?? null

    // A label or date axis cannot be fitted (named in the error); only the name of such a column matters.
    const notNumeric =
      kindOf(xColumn) !== 'numeric' ? xColumn : kindOf(yColumn) !== 'numeric' ? yColumn : null
    // The pooled fit and every group fit read the same arrays; only the sample differs.
    const fitDeps = (sample: AnalysisSample): Deps =>
      fitSpec
        ? [
            fitSpec.id,
            modelKey(fitSpec),
            fitSpec.confidence,
            data.x,
            data.y,
            data.rowIds,
            sample,
            yBars,
            xColumn.unit,
            yColumn.unit,
            notNumeric?.id,
            notNumeric?.name,
          ]
        : [null]
    const fitOn = (input: SeriesData): FitResult | null => {
      if (!fitSpec) return null
      if (notNumeric) return notNumericFit(fitSpec, input, notNumeric)
      return runFit(fitSpec, input, { xUnit: xColumn.unit, yUnit: yColumn.unit, yUncertainty: yBars })
    }
    // Always computed, also while the fits are per group: switching the split never refits the series.
    entry.fit = slot(entry.fit, fitDeps(data.sample), () => fitOn(data))
    const pooledFit = entry.fit.value

    const split = splitStage(entry, ds, spec, data, view, xColumn, fitSpec, fitDeps, fitOn)
    const perGroup = split.value !== null && fitSpec?.perGroup === true
    const fit = perGroup ? null : pooledFit

    entry.derived = slot(
      entry.derived,
      [spec, index, view, xColumn, yColumn, data, xBars, yBars, replicate, fitSpec, fit, split],
      () => {
        const issues: Issue[] = []
        for (const col of [xColumn, yColumn]) {
          const k = kindOf(col)
          if (k === 'categorical' || k === 'text')
            issues.push(issue('E_COLUMN_NOT_NUMERIC', { column: col.name }, { columnId: col.id }))
        }
        if (xBars) issues.push(...xBars.issues)
        if (yBars) issues.push(...yBars.issues)
        // A split series draws the replicate statistics of its groups (reported with their group).
        if (replicate && split.value === null) issues.push(...replicate.bars.issues)
        const known = (i: Issue) =>
          i.columnId !== undefined &&
          issues.some((j) => j.code === i.code && j.columnId === i.columnId && j.params?.group === undefined)
        if (fit?.status === 'ok') issues.push(...fit.warnings)
        else if (fit && !known(fit.error)) issues.push(fit.error)
        issues.push(...split.issues)
        // A group-independent issue (no params.group) is stated once, however many groups raise it.
        const repeated = (i: Issue) =>
          i.params?.group === undefined &&
          issues.some((j) => j.code === i.code && j.columnId === i.columnId && sameParams(j.params, i.params))
        for (const g of split.value?.groups ?? [])
          for (const i of g.issues) if (!known(i) && !repeated(i)) issues.push(i)
        const inactive = inactiveIssue(data.sample)
        if (inactive) issues.push(inactive)
        if (fit?.status === 'ok') {
          const ySummary = summaryOf(ds, yColumn.id)
          if (ySummary && ySummary.n !== fit.provenance.nUsed)
            issues.push(
              issue(
                'I_SAMPLE_DIFFERS',
                { column: yColumn.name, nCol: ySummary.n, nFit: fit.provenance.nUsed },
                { columnId: yColumn.id },
              ),
            )
        }
        return {
          spec,
          index,
          view,
          xColumn,
          yColumn,
          data,
          xBars,
          yBars,
          replicate,
          fitSpec,
          fit,
          split: split.value,
          issues,
        }
      },
    )
    return entry.derived.value
  }

  /**
   * The split of a series (spec.split): a partition of its pairwise sample by the parsed column, cached
   * on [sample, parsed column] so a rename, a style edit or a scale change keeps every group object;
   * then per group (cached by key) the replicate statistics and, with FitSpec.perGroup, its own fit
   * (same dependencies as the pooled fit, with the group's sample).
   */
  function splitStage(
    entry: SeriesEntry,
    ds: DatasetEntry,
    spec: XYSeriesSpec,
    data: SeriesData,
    view: DatasetView,
    xColumn: ColumnMeta,
    fitSpec: FitSpec | null,
    fitDeps: (sample: AnalysisSample) => Deps,
    fitOn: (input: SeriesData) => FitResult | null,
  ): SplitState {
    const meta = spec.split ? ds.dataset.columns.find((c) => c.id === spec.split!.column) : undefined
    const pc = meta ? view.columns.get(meta.id) : undefined
    entry.partition = slot(entry.partition, pc ? [pc, data.sample] : [null], () =>
      pc ? partitionGroups(pc, data.sample) : null,
    )
    const partition = entry.partition.value
    const slices = partition && 'groups' in partition ? partition.groups : null
    const previous = entry.groups
    const nextGroups = new Map<string, GroupEntry>()
    const groups: DerivedGroup[] = []
    const ySpec = spec.errorBars.y
    const replicateKind = ySpec.kind === 'sd' || ySpec.kind === 'sem' || ySpec.kind === 'ci'
    const perGroup = fitSpec?.perGroup === true
    for (const g of slices ?? []) {
      const ge = previous?.get(g.key) ?? {}
      nextGroups.set(g.key, ge)
      const masked: SeriesData = { ...data, sample: g.sample }
      ge.replicate = slot(
        ge.replicate,
        replicateKind ? [ySpec, g.sample, data.x, data.y, data.rowIds, view, xColumn.role] : [null],
        () => (replicateKind ? resolveReplicateBars(ySpec, masked, view, { xRole: xColumn.role }) : null),
      )
      ge.fit = slot(ge.fit, perGroup ? fitDeps(g.sample) : [null], () => (perGroup ? fitOn(masked) : null))
      const replicate = ge.replicate.value
      const fit = ge.fit.value
      ge.derived = slot(ge.derived, [g, replicate, fit], () => {
        const own: Issue[] = []
        if (replicate) own.push(...replicate.bars.issues)
        if (fit?.status === 'ok') own.push(...fit.warnings)
        else if (fit) own.push(fit.error)
        const issues = own.map((i) =>
          GROUP_INDEPENDENT.has(i.code) ? i : { ...i, params: { ...i.params, group: g.label } },
        )
        return { ...g, replicate, fit, issues }
      })
      groups.push(ge.derived.value)
    }
    entry.groups = nextGroups
    const before = entry.split?.value.value?.groups
    const stableGroups = groups.length === 0 ? EMPTY : before && sameItems(before, groups) ? before : groups
    entry.split = slot(entry.split, [meta, partition, stableGroups], () => ({
      value: meta && slices ? { column: meta, groups: stableGroups } : null,
      issues: meta && partition ? splitIssues(partition, meta) : EMPTY,
    }))
    return entry.split.value
  }

  /** The first FitSpec of each series (a series has at most one), rebuilt only when doc.fits changes. */
  function fitsBySeries(doc: ProjectDoc): Map<SeriesId, FitSpec> {
    if (fitIndex?.fits !== doc.fits) {
      const bySeries = new Map<SeriesId, FitSpec>()
      for (const f of doc.fits) if (!bySeries.has(f.seriesId)) bySeries.set(f.seriesId, f)
      fitIndex = { fits: doc.fits, bySeries }
    }
    return fitIndex.bySeries
  }

  function plotStage(
    state: PlotState,
    data: DataState,
    plot: PlotSpec | null,
    fits: readonly (FitSpec | null)[],
  ): DerivedPlot {
    state.part = slot(state.part, [data.value, plot, ...fits], () => {
      const { entries } = data
      state.plotView = slot(state.plotView, [plot], () => (plot ? resolvePlot(plot) : null))
      const scales = plot ? drawnScales(plot, (spec) => seriesColumns(entries, spec)) : LINEAR
      const nextCache = new Map<SeriesId, SeriesEntry>()
      const all: DerivedSeries[] = []
      const broken: Issue[] = []
      plot?.series.forEach((spec, index) => {
        const entry = state.series.get(spec.id) ?? {}
        nextCache.set(spec.id, entry)
        const out = deriveSeries(entries, spec, index, scales, fits[index] ?? null, entry)
        if ('code' in out) broken.push(out)
        else all.push(out)
      })
      state.series = nextCache
      const allSeries = sameItems(state.lastSeries, all) ? state.lastSeries : all
      state.lastSeries = allSeries
      const shown = plot && (plot.type === 'scatter' || plot.type === 'line') ? allSeries : EMPTY
      const issues: Issue[] = [...data.value.issues]
      for (const s of shown) issues.push(...s.issues)
      issues.push(...broken)
      return { plot, plotView: state.plotView.value, series: shown, allSeries, axisScales: scales, issues }
    })
    return state.part.value
  }

  return (doc, rawTables, plotId) => {
    if (doc.plots !== knownPlots) {
      knownPlots = doc.plots
      // The caches of a deleted plot go with it (an undo that brings it back derives it afresh).
      const ids = new Set<PlotId>(doc.plots.map((p) => p.id))
      for (const id of plotStates.keys()) if (!ids.has(id)) plotStates.delete(id)
    }
    const plot =
      plotId === undefined
        ? (doc.plots.find((p) => p.id === doc.activePlotId) ?? doc.plots[0] ?? null)
        : (doc.plots.find((p) => p.id === plotId) ?? null)
    let state = noPlot
    if (plot) {
      const known = plotStates.get(plot.id)
      state = known ?? newPlotState()
      if (!known) plotStates.set(plot.id, state)
    }
    const last = state.last
    if (last && last.doc === doc && last.rawTables === rawTables) return last.out

    const data = dataStage(doc, rawTables)
    const bySeries = fitsBySeries(doc)
    const fits = plot ? plot.series.map((s) => bySeries.get(s.id) ?? null) : EMPTY
    const part = plotStage(state, data, plot, fits)
    const d = data.value
    const out: DerivedProject =
      last && last.doc === doc && last.out.parts.data === d && last.out.parts.plot === part
        ? last.out
        : {
            doc,
            views: d.views,
            plot: part.plot,
            plotView: part.plotView,
            series: part.series,
            allSeries: part.allSeries,
            axisScales: part.axisScales,
            columnSummary: d.columnSummary,
            columnSample: d.columnSample,
            datasetIssues: d.datasetIssues,
            issues: part.issues,
            parts: { data: d, plot: part },
          }
    state.last = { doc, rawTables, out }
    return out
  }
}
