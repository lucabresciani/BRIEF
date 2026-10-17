/**
 * zod 4 schemas for the .sciplot project file (schema version 2) and every persisted type of
 * src/domain/model. Untrusted input: ids are constrained by a strict regex, strings and arrays are
 * bounded, numbers must be finite (zod 4 rejects NaN and ±Infinity), unknown keys are stripped.
 * Compile-time assertions at the bottom keep the schemas in sync with the TypeScript model.
 * Version 1 files are brought to version 2 by migrate.ts BEFORE they reach these schemas.
 */
import { z } from 'zod'
import {
  ALL_REASON_CODES,
  NATIVE,
  SCHEMA_VERSION,
  type AxisSpec,
  type BarOptions,
  type BoxOptions,
  type Brand,
  type ColumnDetection,
  type ColumnMeta,
  type ColumnParseSettings,
  type ColumnSource,
  type Dataset,
  type DatasetLayout,
  type Exclusion,
  type Filter,
  type FitModel,
  type FitSpec,
  type FitStyle,
  type GroupSpreadSpec,
  type HistogramOptions,
  type ImportedDataset,
  type Issue,
  type LegendSpec,
  type LineOptions,
  type MeasurementMeaning,
  type MeasurementSource,
  type NotebookDataset,
  type OperationKind,
  type OperationLogEntry,
  type PlotExportSettings,
  type PlotSpec,
  type ProjectDoc,
  type ProjectFile,
  type RawRegion,
  type RawSource,
  type RawTableJSON,
  type ReplicateGrouping,
  type ScatterOptions,
  type SeriesStyle,
  type SplitSpec,
  type TransformSpec,
  type UncertaintySpec,
  type WorkspaceState,
  type XUncertaintySpec,
  type XYSeriesSpec,
} from '@/domain/model'
import { LIMITS } from '@/domain/import/limits'

export const PROJECT_LIMITS = {
  /** Larger files are refused before parsing. */
  maxBytes: LIMITS.maxProjectBytes,
  /** Timestamps, versions, i18n keys. */
  shortText: 256,
  /** Anything that comes from the user or from the imported file (names, notes, cell text). */
  text: 1_000_000,
  /** Rows, columns and row-id lists: the padded import grid never exceeds LIMITS.maxCells cells. */
  grid: LIMITS.maxCells,
  /** Datasets, plots, series, fits, filters, exclusions, issue lists. */
  collection: 100_000,
  /** Operation log entries. */
  log: 1_000_000,
} as const

const L = PROJECT_LIMITS

/** Ids produced by newId(): `prefix_` + hex + base36 counter. */
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
/**
 * Names that the id pattern accepts but that must never become an id: ids are used as object keys
 * (raw table records, notebook cells), where "__proto__" or "toString" would shadow the prototype.
 */
export const RESERVED_IDS: ReadonlySet<string> = new Set([
  ...Object.getOwnPropertyNames(Object.prototype),
  'prototype',
])
/** Row ids and grid row numbers end up in Int32Arrays (DatasetView, RawTable.sourceRow). */
const INT32_MAX = 2 ** 31 - 1

const id = z
  .string()
  .regex(ID_PATTERN, 'Invalid id')
  .refine((s) => !RESERVED_IDS.has(s), 'Reserved name used as id')
const shortText = z.string().max(L.shortText)
const text = z.string().max(L.text)
const nullableText = text.nullable()
/** z.number() rejects NaN and ±Infinity in zod 4. */
const finite = z.number()
const nonNegInt = z.int().nonnegative()
const rowInt = z.int().nonnegative().max(INT32_MAX)
const paramsRecord = z.record(z.string().max(64), z.union([text, finite]))

/**
 * Large homogeneous arrays (grid columns, row ids) are checked with a single tight loop: one issue
 * per array instead of one per element, and no per-element schema overhead on millions of cells.
 */
function denseArray<T>(isItem: (v: unknown) => boolean, what: string, max: number = L.grid) {
  return z.custom<T[]>((v) => {
    if (!Array.isArray(v) || v.length > max) return false
    for (let i = 0; i < v.length; i++) if (!isItem(v[i])) return false
    return true
  }, `Expected an array of at most ${max} ${what}`)
}

const isRowInt = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= INT32_MAX
const isCellText = (v: unknown) => typeof v === 'string' && v.length <= L.text
const NATIVE_MAX = Math.max(...Object.values(NATIVE))
const isNativeKind = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= NATIVE_MAX
const isFiniteOrNull = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v))

const rowIdArray = denseArray<number>(isRowInt, 'non-negative 32-bit integer row ids')
const cellTextArray = denseArray<string>(isCellText, 'strings')

// ── issues ───────────────────────────────────────────────────────────────────────────────────────

export const IssueSchema = z.object({
  code: z.enum(ALL_REASON_CODES),
  severity: z.enum(['error', 'warning', 'info']),
  params: paramsRecord.optional(),
  rows: rowIdArray.optional(),
  columnId: id.optional(),
})
const issueList = z.array(IssueSchema).max(L.collection)

// ── raw table ────────────────────────────────────────────────────────────────────────────────────

export const RawRegionSchema = z.object({
  orientation: z.enum(['columns', 'rows']),
  blocks: z
    .array(
      z.object({
        range: shortText,
        label: nullableText,
        firstRow: rowInt,
        rowCount: rowInt,
      }),
    )
    .max(L.collection),
  labelColumns: z.array(rowInt).max(L.grid),
})

export const RawSourceSchema = z.object({
  kind: z.enum(['csv', 'tsv', 'text', 'clipboard', 'xlsx', 'xls', 'ods', 'example']),
  fileName: nullableText,
  sheetName: nullableText,
  encoding: z.enum(['utf-8', 'utf-16le', 'utf-16be', 'windows-1252']).nullable(),
  delimiter: z.enum(['\t', ';', ',', '|', 'none']).nullable(),
  byteSize: nonNegInt.nullable(),
  importedAt: shortText,
  region: RawRegionSchema.optional(),
})

const RawColumnJSONSchema = z.object({
  text: cellTextArray,
  native: z
    .object({
      kind: denseArray<number>(isNativeKind, `native cell kinds (0–${NATIVE_MAX})`),
      num: denseArray<number | null>(isFiniteOrNull, 'finite numbers or null'),
    })
    .nullable(),
})

export const RawTableJSONSchema = z
  .object({
    id,
    source: RawSourceSchema,
    rowCount: rowInt.max(L.grid),
    sourceRow: rowIdArray,
    columns: z.array(RawColumnJSONSchema).max(L.grid),
    tokenIssues: issueList,
  })
  .superRefine((t, ctx) => {
    const n = t.rowCount
    if (t.sourceRow.length !== n)
      ctx.addIssue({ code: 'custom', path: ['sourceRow'], message: `Expected ${n} entries (rowCount)` })
    t.columns.forEach((c, j) => {
      if (c.text.length !== n)
        ctx.addIssue({
          code: 'custom',
          path: ['columns', j, 'text'],
          message: `Expected ${n} cells (rowCount)`,
        })
      if (c.native && (c.native.kind.length !== n || c.native.num.length !== n))
        ctx.addIssue({
          code: 'custom',
          path: ['columns', j, 'native'],
          message: `Expected ${n} cells (rowCount)`,
        })
    })
    // Provenance must describe rows and columns that exist: it labels every record of the table.
    const region = t.source.region
    if (!region) return
    region.blocks.forEach((b, k) => {
      if (b.firstRow + b.rowCount > n)
        ctx.addIssue({
          code: 'custom',
          path: ['source', 'region', 'blocks', k],
          message: `Rows ${b.firstRow}+${b.rowCount} past the end of the table (${n} rows)`,
        })
    })
    region.labelColumns.forEach((c, k) => {
      if (c >= t.columns.length)
        ctx.addIssue({
          code: 'custom',
          path: ['source', 'region', 'labelColumns', k],
          message: `Column ${c} does not exist (${t.columns.length} columns)`,
        })
    })
  })

// ── datasets and columns ─────────────────────────────────────────────────────────────────────────

const ColumnKindSchema = z.enum(['numeric', 'categorical', 'datetime', 'text'])
const DecimalModeSchema = z.enum(['dot', 'comma', 'mixed'])
const PercentModeSchema = z.enum(['display', 'fraction'])

export const ColumnParseSettingsSchema = z.object({
  kind: ColumnKindSchema,
  decimal: DecimalModeSchema,
  percent: PercentModeSchema,
})

export const ColumnDetectionSchema = z.object({
  ...ColumnParseSettingsSchema.shape,
  confidence: z.enum(['high', 'low']),
  explanations: issueList,
})

export const TransformSpecSchema = z.discriminatedUnion('op', [
  z.object({ op: z.enum(['ln', 'log10', 'sqrt', 'reciprocal', 'square']), input: id }),
  z.object({ op: z.literal('affine'), input: id, a: finite, b: finite }),
  z.object({ op: z.enum(['difference', 'ratio', 'product']), left: id, right: id }),
])

export const ColumnSourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('raw'), index: rowInt }),
  z.object({ type: z.literal('notebook') }),
  z.object({ type: z.literal('derived'), spec: TransformSpecSchema }),
])

export const ColumnMetaSchema = z.object({
  id,
  source: ColumnSourceSchema,
  name: text,
  unit: nullableText,
  unitSource: z.enum(['header', 'unitsRow', 'cells', 'user']).nullable(),
  role: z.enum(['measurement', 'uncertainty', 'group', 'identifier', 'ignore']),
  uncertaintyOf: id.nullable(),
  detected: ColumnDetectionSchema,
  override: ColumnParseSettingsSchema.partial(),
})

export const DatasetLayoutSchema = z.object({
  headerRow: rowInt.nullable(),
  unitsRow: rowInt.nullable(),
  dataStartRow: rowInt,
  dataEndRow: rowInt,
})

const datasetBase = {
  id,
  name: text,
  createdAt: shortText,
  example: z.object({ id: z.enum(['free-fall', 'ohm', 'cooling', 'beer-lambert', 'pendulum']) }).nullable(),
  columns: z.array(ColumnMetaSchema).max(L.grid),
  notes: z.array(text).max(L.collection),
}

export const ImportedDatasetSchema = z.object({
  ...datasetBase,
  origin: z.literal('import'),
  rawTableId: id,
  layout: DatasetLayoutSchema,
})

export const NotebookDatasetSchema = z
  .object({
    ...datasetBase,
    origin: z.literal('notebook'),
    rowIds: rowIdArray,
    cells: z.record(id, cellTextArray),
    nextRowId: rowInt,
  })
  .superRefine((d, ctx) => {
    if (new Set(d.rowIds).size !== d.rowIds.length)
      ctx.addIssue({ code: 'custom', path: ['rowIds'], message: 'Duplicate row ids' })
    for (const [key, cells] of Object.entries(d.cells))
      if (cells.length !== d.rowIds.length)
        ctx.addIssue({
          code: 'custom',
          path: ['cells', key],
          message: `Expected ${d.rowIds.length} cells (one per row id)`,
        })
  })

export const DatasetSchema = z.discriminatedUnion('origin', [ImportedDatasetSchema, NotebookDatasetSchema])

// ── uncertainty ──────────────────────────────────────────────────────────────────────────────────

const ConfidenceLevelSchema = z.literal([0.9, 0.95, 0.99])

export const MeasurementSourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('absolute'), value: finite.nonnegative() }),
  z.object({ type: z.literal('percent'), percent: finite.nonnegative() }),
  z.object({ type: z.literal('column'), column: id }),
  z.object({ type: z.literal('columnAsymmetric'), plus: id, minus: id }),
])

export const MeasurementMeaningSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('standard') }),
  z.object({ type: z.literal('expanded'), k: finite.positive() }),
  z.object({ type: z.literal('unspecified') }),
])

const MeasurementSpecSchema = z.object({
  kind: z.literal('measurement'),
  origin: z.enum(['instrument', 'user']),
  source: MeasurementSourceSchema,
  meaning: MeasurementMeaningSchema,
})
const NoUncertaintySchema = z.object({ kind: z.literal('none') })

export const ReplicateGroupingSchema = z.discriminatedUnion('by', [
  z.object({ by: z.literal('sameX') }),
  z.object({ by: z.literal('column'), column: id }),
])

export const UncertaintySpecSchema = z.discriminatedUnion('kind', [
  NoUncertaintySchema,
  MeasurementSpecSchema,
  z.object({ kind: z.literal('sd'), grouping: ReplicateGroupingSchema }),
  z.object({ kind: z.literal('sem'), grouping: ReplicateGroupingSchema }),
  z.object({
    kind: z.literal('ci'),
    grouping: ReplicateGroupingSchema,
    level: ConfidenceLevelSchema,
    method: z.literal('t'),
  }),
])
export const XUncertaintySpecSchema = z.discriminatedUnion('kind', [
  NoUncertaintySchema,
  MeasurementSpecSchema,
])

export const GroupSpreadSpecSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('sd') }),
  z.object({ kind: z.literal('sem') }),
  z.object({ kind: z.literal('ci'), level: ConfidenceLevelSchema, method: z.literal('t') }),
])

// ── plots ────────────────────────────────────────────────────────────────────────────────────────

export const AxisSpecSchema = z.object({
  label: nullableText,
  unit: nullableText,
  scale: z.enum(['linear', 'log']),
  range: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('auto') }),
    z.object({ mode: z.literal('fixed'), min: finite, max: finite }),
  ]),
  showGrid: z.boolean(),
})

const MarkerSymbolSchema = z.enum([
  'circle',
  'square',
  'diamond',
  'triangle-up',
  'triangle-down',
  'cross',
  'x',
])
const LineDashSchema = z.enum(['solid', 'dash', 'dot', 'dashdot', 'longdash', 'longdashdot'])

export const SeriesStyleSchema = z.object({
  paletteIndex: nonNegInt,
  symbol: MarkerSymbolSchema.or(z.literal('auto')),
  open: z.boolean(),
  markerSize: finite.positive(),
  lineDash: LineDashSchema.or(z.literal('auto')),
  lineWidth: finite.nonnegative(),
})

export const SplitSpecSchema = z.object({
  column: id,
  overrides: z
    .array(
      z.object({
        key: text,
        paletteIndex: nonNegInt.nullable(),
        symbol: MarkerSymbolSchema.or(z.literal('auto')),
      }),
    )
    .max(L.collection),
})

export const XYSeriesSpecSchema = z.object({
  id,
  datasetId: id,
  name: nullableText,
  x: id,
  y: id,
  visible: z.boolean(),
  style: SeriesStyleSchema,
  errorBars: z.object({ x: XUncertaintySpecSchema, y: UncertaintySpecSchema, visible: z.boolean() }),
  split: SplitSpecSchema.nullable(),
})

export const LegendSpecSchema = z.object({
  visible: z.boolean(),
  position: z.enum(['auto', 'top-left', 'top-right', 'bottom-left', 'bottom-right', 'outside']),
})
export const ScatterOptionsSchema = z.object({ residualPanel: z.boolean(), showExcluded: z.boolean() })
export const LineOptionsSchema = z.object({ markers: z.boolean(), sortByX: z.boolean() })

const barBase = {
  datasetId: id.nullable(),
  category: id.nullable(),
  value: id.nullable(),
  showObservations: z.boolean(),
  colorByCategory: z.boolean(),
}
export const BarOptionsSchema = z.discriminatedUnion('aggregate', [
  z.object({ ...barBase, aggregate: z.literal('mean'), spread: GroupSpreadSpecSchema }),
  z.object({ ...barBase, aggregate: z.literal('none'), uncertainty: XUncertaintySpecSchema }),
])

export const HistogramOptionsSchema = z.object({
  datasetId: id.nullable(),
  value: id.nullable(),
  bins: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('auto') }),
    z.object({ mode: z.literal('count'), count: z.int().positive() }),
    z.object({ mode: z.literal('width'), width: finite.positive(), start: finite.nullable() }),
  ]),
  groupBy: id.nullable(),
  groupMode: z.enum(['overlay', 'stack']),
})

export const BoxOptionsSchema = z.object({
  datasetId: id.nullable(),
  value: id.nullable(),
  groupBy: id.nullable(),
  points: z.enum(['all', 'outliers', 'none']),
  showMean: z.boolean(),
  colorByGroup: z.boolean(),
})

export const PlotExportSettingsSchema = z.object({
  widthPx: finite.positive(),
  heightPx: finite.positive(),
  scale: z.literal([1, 2, 3]),
  caption: z.boolean(),
  includeResiduals: z.boolean(),
})

export const PlotSpecSchema = z.object({
  id,
  name: text,
  type: z.enum(['scatter', 'line', 'bar', 'histogram', 'box']),
  title: text,
  xAxis: AxisSpecSchema,
  yAxis: AxisSpecSchema,
  legend: LegendSpecSchema,
  series: z.array(XYSeriesSpecSchema).max(L.collection),
  scatter: ScatterOptionsSchema,
  line: LineOptionsSchema,
  bar: BarOptionsSchema,
  histogram: HistogramOptionsSchema,
  box: BoxOptionsSchema,
  export: PlotExportSettingsSchema,
})

// ── fits, exclusions, filters ────────────────────────────────────────────────────────────────────

export const FitModelSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('linear') }),
  z.object({ type: z.literal('polynomial'), degree: z.int().min(1).max(10) }),
  z.object({ type: z.literal('exponential') }),
  z.object({ type: z.literal('power') }),
])

export const FitStyleSchema = z.object({
  color: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('series') }),
    z.object({ mode: z.literal('palette'), index: nonNegInt }),
  ]),
  dash: LineDashSchema.or(z.literal('auto')),
  width: finite.positive(),
})

export const FitSpecSchema = z.object({
  id,
  seriesId: id,
  model: FitModelSchema,
  confidence: ConfidenceLevelSchema,
  show: z.object({
    curve: z.boolean(),
    confidenceBand: z.boolean(),
    predictionBand: z.boolean(),
    residuals: z.boolean(),
  }),
  curveRange: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('data') }),
    z.object({ mode: z.literal('extend'), min: finite, max: finite }),
  ]),
  style: FitStyleSchema,
  perGroup: z.boolean(),
})

export const ExclusionSchema = z.object({
  id,
  datasetId: id,
  rowIds: rowIdArray,
  reason: z.enum(['outlier-candidate', 'measurement-problem', 'out-of-scope', 'other']),
  note: text,
  createdAt: shortText,
})

const filterBase = { id, datasetId: id, enabled: z.boolean(), column: id }
export const FilterSchema = z.discriminatedUnion('type', [
  z.object({ ...filterBase, type: z.literal('range'), min: finite.nullable(), max: finite.nullable() }),
  z.object({ ...filterBase, type: z.literal('category'), keep: z.array(text).max(L.collection) }),
])

// ── operation log ────────────────────────────────────────────────────────────────────────────────

/** Runtime list of OperationKind (the model only declares the type); the sync check keeps it complete. */
export const OPERATION_KINDS = [
  'dataset.import',
  'dataset.remove',
  'dataset.rename',
  'dataset.layout',
  'column.edit',
  'column.parse',
  'column.derive',
  'column.remove',
  'plot.create',
  'plot.remove',
  'plot.rename',
  'plot.duplicate',
  'plot.reorder',
  'plot.type',
  'plot.axis',
  'plot.style',
  'plot.options',
  'plot.viewToLimits',
  'series.map',
  'series.add',
  'series.remove',
  'series.visibility',
  'series.split',
  'fit.add',
  'fit.edit',
  'fit.remove',
  'uncertainty.set',
  'exclusion.add',
  'exclusion.remove',
  'filter.set',
  'notebook.create',
  'notebook.edit',
  'notebook.rows',
  'project.rename',
  'project.settings',
] as const satisfies readonly OperationKind[]

export const OperationLogEntrySchema = z.object({
  id,
  at: shortText,
  op: z.enum(OPERATION_KINDS),
  label: z.object({ key: shortText, params: paramsRecord.optional() }),
  datasetId: id.nullable(),
  plotId: id.nullable(),
})

// ── project ──────────────────────────────────────────────────────────────────────────────────────

export const ProjectDocSchema = z.object({
  id,
  name: text,
  createdAt: shortText,
  updatedAt: shortText,
  datasets: z.array(DatasetSchema).max(L.collection),
  plots: z.array(PlotSpecSchema).max(L.collection),
  activePlotId: id.nullable(),
  fits: z.array(FitSpecSchema).max(L.collection),
  exclusions: z.array(ExclusionSchema).max(L.collection),
  filters: z.array(FilterSchema).max(L.collection),
  numberFormat: z.object({ decimal: z.enum(['auto', 'dot', 'comma']) }),
})

/** Panes of the 'single' (1), 'columns' (2) and 'grid' (4) layouts. */
const MAX_PANES = 4

export const WorkspaceStateSchema = z.object({
  layout: z.enum(['single', 'columns', 'grid']),
  panes: z.array(id.nullable()).max(MAX_PANES),
  focused: z
    .int()
    .nonnegative()
    .max(MAX_PANES - 1),
})

export const ProjectFileSchema = z
  .object({
    format: z.literal('sciplot'),
    schemaVersion: z.literal(SCHEMA_VERSION),
    appVersion: shortText,
    savedAt: shortText,
    project: ProjectDocSchema,
    rawTables: z.array(RawTableJSONSchema).max(L.collection),
    operationLog: z.array(OperationLogEntrySchema).max(L.log),
    workspace: WorkspaceStateSchema.optional(),
  })
  .superRefine((f, ctx) => {
    const seen = new Set<string>()
    f.rawTables.forEach((t, i) => {
      if (seen.has(t.id))
        ctx.addIssue({
          code: 'custom',
          path: ['rawTables', i, 'id'],
          message: `Duplicate raw table id ${t.id}`,
        })
      seen.add(t.id)
    })
  })

export type ProjectFileJSON = z.infer<typeof ProjectFileSchema>

// ── compile-time sync check between the schemas and src/domain/model ────────────────────────────

/** Deep copy of T without id brands and readonly modifiers (the JSON shape of a persisted type). */
export type Unbrand<T> =
  T extends Brand<string, string>
    ? string
    : T extends Brand<number, string>
      ? number
      : T extends readonly (infer E)[]
        ? Unbrand<E>[]
        : T extends object
          ? { -readonly [K in keyof T]: Unbrand<T[K]> }
          : T

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type Assert<T extends true> = T
type Sync<S extends z.ZodType, M> = Same<z.infer<S>, Unbrand<M>>

/**
 * Fails to compile when a schema drifts from the model (missing or extra required field, missing
 * union member or literal, wrong optionality or primitive type). TypeScript stops comparing
 * instantiations of the same mapped type after a few nesting levels (it then assumes they match),
 * so EVERY persisted object type is asserted at its own root: each field is verified within one or
 * two levels of some assertion. RawTableJSON / ProjectFile declare tokenIssues as unknown[], so
 * for those two the check is one-directional (schema output ⊆ model).
 */
export type SchemaModelSync = [
  Assert<Sync<typeof IssueSchema, Issue>>,
  Assert<Sync<typeof RawRegionSchema, RawRegion>>,
  Assert<Sync<typeof RawSourceSchema, RawSource>>,
  Assert<Sync<typeof ColumnParseSettingsSchema, ColumnParseSettings>>,
  Assert<Sync<typeof ColumnDetectionSchema, ColumnDetection>>,
  Assert<Sync<typeof TransformSpecSchema, TransformSpec>>,
  Assert<Sync<typeof ColumnSourceSchema, ColumnSource>>,
  Assert<Sync<typeof ColumnMetaSchema, ColumnMeta>>,
  Assert<Sync<typeof DatasetLayoutSchema, DatasetLayout>>,
  Assert<Sync<typeof ImportedDatasetSchema, ImportedDataset>>,
  Assert<Sync<typeof NotebookDatasetSchema, NotebookDataset>>,
  Assert<Sync<typeof DatasetSchema, Dataset>>,
  Assert<Sync<typeof MeasurementSourceSchema, MeasurementSource>>,
  Assert<Sync<typeof MeasurementMeaningSchema, MeasurementMeaning>>,
  Assert<Sync<typeof ReplicateGroupingSchema, ReplicateGrouping>>,
  Assert<Sync<typeof UncertaintySpecSchema, UncertaintySpec>>,
  Assert<Sync<typeof XUncertaintySpecSchema, XUncertaintySpec>>,
  Assert<Sync<typeof GroupSpreadSpecSchema, GroupSpreadSpec>>,
  Assert<Sync<typeof AxisSpecSchema, AxisSpec>>,
  Assert<Sync<typeof SeriesStyleSchema, SeriesStyle>>,
  Assert<Sync<typeof SplitSpecSchema, SplitSpec>>,
  Assert<Sync<typeof XYSeriesSpecSchema, XYSeriesSpec>>,
  Assert<Sync<typeof LegendSpecSchema, LegendSpec>>,
  Assert<Sync<typeof ScatterOptionsSchema, ScatterOptions>>,
  Assert<Sync<typeof LineOptionsSchema, LineOptions>>,
  Assert<Sync<typeof BarOptionsSchema, BarOptions>>,
  Assert<Sync<typeof HistogramOptionsSchema, HistogramOptions>>,
  Assert<Sync<typeof BoxOptionsSchema, BoxOptions>>,
  Assert<Sync<typeof PlotExportSettingsSchema, PlotExportSettings>>,
  Assert<Sync<typeof PlotSpecSchema, PlotSpec>>,
  Assert<Sync<typeof FitModelSchema, FitModel>>,
  Assert<Sync<typeof FitStyleSchema, FitStyle>>,
  Assert<Sync<typeof FitSpecSchema, FitSpec>>,
  Assert<Sync<typeof ExclusionSchema, Exclusion>>,
  Assert<Sync<typeof FilterSchema, Filter>>,
  Assert<Sync<typeof OperationLogEntrySchema, OperationLogEntry>>,
  Assert<Sync<typeof ProjectDocSchema, ProjectDoc>>,
  Assert<Sync<typeof WorkspaceStateSchema, WorkspaceState>>,
  Assert<Same<(typeof OPERATION_KINDS)[number], OperationKind>>,
  Assert<z.infer<typeof RawTableJSONSchema> extends Unbrand<RawTableJSON> ? true : false>,
  Assert<z.infer<typeof ProjectFileSchema> extends Unbrand<ProjectFile> ? true : false>,
]
