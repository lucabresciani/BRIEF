/**
 * Referential integrity of a ProjectDoc. Every id stored in the document must point to
 * something that exists: series → dataset and columns, fits → series, exclusions and filters →
 * dataset (and column), uncertainty specs → columns of the series' own dataset, plot options →
 * dataset and columns, derived columns → their inputs (without cycles), notebook cells → columns.
 *
 * - checkRefs reports problems without touching the document (safe on frozen state);
 * - repairRefs fixes them in place (an immer draft or a freshly parsed object);
 * - cascadeRemoval removes an item and everything that references it, in the same commit.
 * Repairs never invent data: a dangling optional reference becomes null / { kind: 'none' }, an item
 * that cannot exist without the missing target (a series without its column, a fit without its
 * series, a derived column without its input) is removed.
 */
import { issue, type Issue } from './issues'
import type { ColumnId, DatasetId, PlotId, SeriesId } from './ids'
import type { ColumnMeta, Dataset, TransformSpec } from './dataset'
import type { ProjectDoc } from './project'
import type { BarOptions, BoxOptions, HistogramOptions, XYSeriesSpec } from './plot'
import type { UncertaintySpec } from './uncertainty'

export type Removal =
  | { kind: 'dataset'; id: DatasetId }
  | { kind: 'column'; datasetId: DatasetId; id: ColumnId }
  | { kind: 'series'; id: SeriesId }
  | { kind: 'plot'; id: PlotId }

/** Columns read by a derived-column transform. */
export function transformInputs(spec: TransformSpec): ColumnId[] {
  return 'input' in spec ? [spec.input] : [spec.left, spec.right]
}

/**
 * True when giving column `columnId` the transform `spec` would make it depend on itself, directly
 * or through other derived columns of the dataset. `columnId` may be a column not yet in the dataset.
 */
export function wouldCreateCycle(dataset: Dataset, columnId: ColumnId, spec: TransformSpec): boolean {
  const deps = derivedDeps(dataset.columns)
  deps.set(columnId, transformInputs(spec))
  return reaches(deps, transformInputs(spec), columnId)
}

/** Reports every broken reference (code E_INTERNAL_GUARD, params { where, ref, problem }). Never mutates. */
export function checkRefs(doc: ProjectDoc): Issue[] {
  return scan(doc, false).issues
}

/** Repairs every broken reference in place; returns the number of items changed or removed. */
export function repairRefs(doc: ProjectDoc): number {
  return scan(doc, true).count
}

/**
 * MUTATES (an immer draft): removes the item, then everything that referenced it (fits, exclusions,
 * filters, series, derived columns using it; a plot takes the fits of its series with it) and resets
 * optional references (uncertainty specs → none, split / bar / histogram / box options → null,
 * uncertaintyOf → null, activePlotId → the first plot). Returns the number of items removed or
 * changed, the removed item included (0 when it did not exist).
 */
export function cascadeRemoval(doc: ProjectDoc, removal: Removal): number {
  let removed = 0
  if (removal.kind === 'dataset') {
    removed += spliceWhere(doc.datasets, (d) => d.id === removal.id)
  } else if (removal.kind === 'column') {
    for (const d of doc.datasets) {
      if (d.id !== removal.datasetId) continue
      removed += spliceWhere(d.columns, (c) => c.id === removal.id)
      if (d.origin === 'notebook' && Object.hasOwn(d.cells, removal.id)) delete d.cells[removal.id]
    }
  } else if (removal.kind === 'series') {
    for (const p of doc.plots) removed += spliceWhere(p.series, (s) => s.id === removal.id)
  } else {
    removed += spliceWhere(doc.plots, (p) => p.id === removal.id)
  }
  return removed + repairRefs(doc)
}

// ── implementation ───────────────────────────────────────────────────────────────────────────────

interface Ctx {
  fix: boolean
  issues: Issue[]
  count: number
}

type Problem =
  | 'dangling'
  | 'duplicate'
  | 'cycle'
  | 'derived-uncertainty'
  | 'orphan-cells'
  | 'missing-cells'
  | 'row-counter'
  | 'stale-rows'
  | 'empty-exclusion'

function report(ctx: Ctx, where: string, ref: string, problem: Problem): void {
  ctx.issues.push(issue('E_INTERNAL_GUARD', { where, ref, problem }))
  ctx.count++
}

/** Removes (in place, keeping order) the items for which `bad` returns a description of the problem. */
function prune<T>(
  ctx: Ctx,
  list: T[],
  where: (item: T) => string,
  bad: (item: T) => { ref: string; problem: Problem } | null,
): void {
  const drop: number[] = []
  list.forEach((item, i) => {
    const b = bad(item)
    if (b) {
      report(ctx, where(item), b.ref, b.problem)
      drop.push(i)
    }
  })
  if (ctx.fix) for (let k = drop.length - 1; k >= 0; k--) list.splice(drop[k], 1)
}

function duplicateOf<T>(key: (item: T) => string): (item: T) => { ref: string; problem: Problem } | null {
  const seen = new Set<string>()
  return (item) => {
    const k = key(item)
    if (seen.has(k)) return { ref: k, problem: 'duplicate' }
    seen.add(k)
    return null
  }
}

function spliceWhere<T>(list: T[], match: (item: T) => boolean): number {
  let n = 0
  for (let i = list.length - 1; i >= 0; i--)
    if (match(list[i])) {
      list.splice(i, 1)
      n++
    }
  return n
}

function derivedDeps(columns: readonly ColumnMeta[]): Map<string, readonly string[]> {
  const deps = new Map<string, readonly string[]>()
  for (const c of columns) if (c.source.type === 'derived') deps.set(c.id, transformInputs(c.source.spec))
  return deps
}

/** Depth-first search through derived-column dependencies. */
function reaches(
  deps: ReadonlyMap<string, readonly string[]>,
  from: readonly string[],
  target: string,
): boolean {
  const stack = [...from]
  const seen = new Set<string>()
  while (stack.length) {
    const id = stack.pop()!
    if (id === target) return true
    if (seen.has(id)) continue
    seen.add(id)
    const next = deps.get(id)
    if (next) stack.push(...next)
  }
  return false
}

function scanDataset(ctx: Ctx, d: Dataset): void {
  const at = `datasets[${d.id}]`
  prune(
    ctx,
    d.columns,
    (c) => `${at}.columns[${c.id}]`,
    duplicateOf((c) => c.id),
  )

  // Derived columns: inputs must exist, no cycles. Removing one may orphan another: iterate.
  for (let pass = 0; pass <= d.columns.length; pass++) {
    const before = ctx.count
    const ids = new Set<string>(d.columns.map((c) => c.id))
    const deps = derivedDeps(d.columns)
    prune(
      ctx,
      d.columns,
      (c) => `${at}.columns[${c.id}].source.spec`,
      (c) => {
        if (c.source.type !== 'derived') return null
        const missing = transformInputs(c.source.spec).find((i) => !ids.has(i))
        if (missing !== undefined) return { ref: missing, problem: 'dangling' }
        return reaches(deps, transformInputs(c.source.spec), c.id) ? { ref: c.id, problem: 'cycle' } : null
      },
    )
    if (!ctx.fix || ctx.count === before) break
  }

  const ids = new Set<string>(d.columns.map((c) => c.id))
  for (const c of d.columns)
    if (c.uncertaintyOf !== null && !ids.has(c.uncertaintyOf)) {
      report(ctx, `${at}.columns[${c.id}].uncertaintyOf`, c.uncertaintyOf, 'dangling')
      if (ctx.fix) c.uncertaintyOf = null
    }

  if (d.origin !== 'notebook') return
  const notebookCols = d.columns.filter((c) => c.source.type === 'notebook')
  for (const key of Object.keys(d.cells))
    if (!notebookCols.some((c) => c.id === key)) {
      report(ctx, `${at}.cells`, key, 'orphan-cells')
      if (ctx.fix) delete d.cells[key]
    }
  for (const c of notebookCols)
    if (!Object.hasOwn(d.cells, c.id)) {
      report(ctx, `${at}.cells`, c.id, 'missing-cells')
      // Every row of a new column is missing (''), never 0.
      if (ctx.fix) d.cells[c.id] = d.rowIds.map(() => '')
    }
  let maxRow = -1
  for (const r of d.rowIds) if (r > maxRow) maxRow = r
  if (d.nextRowId <= maxRow) {
    report(ctx, `${at}.nextRowId`, String(d.nextRowId), 'row-counter')
    // Row ids are never reused: the counter must stay above every id in use.
    if (ctx.fix) d.nextRowId = maxRow + 1
  }
}

/** Column references of an uncertainty spec, split by what they must point to. */
function uncertaintyRefs(u: UncertaintySpec): { measurement: ColumnId[]; grouping: ColumnId[] } {
  if (u.kind === 'measurement') {
    const s = u.source
    const measurement =
      s.type === 'column' ? [s.column] : s.type === 'columnAsymmetric' ? [s.plus, s.minus] : []
    return { measurement, grouping: [] }
  }
  if (u.kind === 'none') return { measurement: [], grouping: [] }
  return { measurement: [], grouping: u.grouping.by === 'column' ? [u.grouping.column] : [] }
}

/**
 * Measurement uncertainty must come from a raw/notebook column of the same dataset, and can only be
 * attached to a raw/notebook value column: uncertainty propagation through a derived column is not
 * implemented, either way round (E_DERIVED_UNCERTAINTY). `valueColumn` is the column the
 * bars belong to (series x / y, bar values). Replicate grouping may use any column of the dataset.
 */
function uncertaintyProblem(
  u: UncertaintySpec,
  columns: ReadonlyMap<string, ColumnMeta> | null,
  valueColumn: ColumnId | null,
): { ref: string; problem: Problem } | null {
  const refs = uncertaintyRefs(u)
  for (const ref of refs.measurement) {
    const c = columns?.get(ref)
    if (!c) return { ref, problem: 'dangling' }
    if (c.source.type === 'derived') return { ref, problem: 'derived-uncertainty' }
  }
  const value = valueColumn === null ? undefined : columns?.get(valueColumn)
  if (refs.measurement.length > 0 && value?.source.type === 'derived')
    return { ref: value.id, problem: 'derived-uncertainty' }
  for (const ref of refs.grouping) if (!columns?.has(ref)) return { ref, problem: 'dangling' }
  return null
}

function scanSeries(
  ctx: Ctx,
  s: XYSeriesSpec,
  where: string,
  columns: ReadonlyMap<string, ColumnMeta>,
): void {
  const x = uncertaintyProblem(s.errorBars.x, columns, s.x)
  if (x) {
    report(ctx, `${where}.errorBars.x`, x.ref, x.problem)
    if (ctx.fix) s.errorBars.x = { kind: 'none' }
  }
  const y = uncertaintyProblem(s.errorBars.y, columns, s.y)
  if (y) {
    report(ctx, `${where}.errorBars.y`, y.ref, y.problem)
    if (ctx.fix) s.errorBars.y = { kind: 'none' }
  }
  // Without its column the split means nothing: the series goes back to a single curve.
  if (s.split !== null && !columns.has(s.split.column)) {
    report(ctx, `${where}.split.column`, s.split.column, 'dangling')
    if (ctx.fix) s.split = null
  }
}

/**
 * Plot-type options (bar / histogram / box): a dangling dataset is nulled; returns the columns of
 * the (remaining) dataset, null when there is none, so that its column references null themselves.
 */
function optionColumns(
  ctx: Ctx,
  opts: BarOptions | HistogramOptions | BoxOptions,
  where: string,
  datasets: ReadonlyMap<string, ReadonlyMap<string, ColumnMeta>>,
): ReadonlyMap<string, ColumnMeta> | null {
  if (opts.datasetId === null) return null
  const cols = datasets.get(opts.datasetId)
  if (cols) return cols
  report(ctx, `${where}.datasetId`, opts.datasetId, 'dangling')
  if (ctx.fix) opts.datasetId = null
  return null
}

/** Reports a column reference that is set but not a column of `cols`; true when it must be cleared. */
function danglingColumn(
  ctx: Ctx,
  where: string,
  ref: ColumnId | null,
  cols: ReadonlyMap<string, ColumnMeta> | null,
): boolean {
  if (ref === null || cols?.has(ref)) return false
  report(ctx, where, ref, 'dangling')
  return ctx.fix
}

function scan(doc: ProjectDoc, fix: boolean): Ctx {
  const ctx: Ctx = { fix, issues: [], count: 0 }

  prune(
    ctx,
    doc.datasets,
    (d) => `datasets[${d.id}]`,
    duplicateOf((d) => d.id),
  )
  for (const d of doc.datasets) scanDataset(ctx, d)
  const datasets = new Map<string, ReadonlyMap<string, ColumnMeta>>(
    doc.datasets.map((d) => [d.id, new Map(d.columns.map((c) => [c.id as string, c]))]),
  )
  const notebookRows = new Map<string, ReadonlySet<number>>()
  for (const d of doc.datasets) if (d.origin === 'notebook') notebookRows.set(d.id, new Set(d.rowIds))

  prune(
    ctx,
    doc.plots,
    (p) => `plots[${p.id}]`,
    duplicateOf((p) => p.id),
  )
  const seriesIds = duplicateOf<XYSeriesSpec>((s) => s.id)
  for (const p of doc.plots) {
    const at = `plots[${p.id}]`
    prune(
      ctx,
      p.series,
      (s) => `${at}.series[${s.id}]`,
      (s) => {
        const dup = seriesIds(s)
        if (dup) return dup
        const cols = datasets.get(s.datasetId)
        if (!cols) return { ref: s.datasetId, problem: 'dangling' }
        if (!cols.has(s.x)) return { ref: s.x, problem: 'dangling' }
        if (!cols.has(s.y)) return { ref: s.y, problem: 'dangling' }
        return null
      },
    )
    for (const s of p.series) {
      // In check mode a series with a dangling dataset is still listed (already reported above).
      const cols = datasets.get(s.datasetId)
      if (cols) scanSeries(ctx, s, `${at}.series[${s.id}]`, cols)
    }

    const bar = p.bar
    const barCols = optionColumns(ctx, bar, `${at}.bar`, datasets)
    if (danglingColumn(ctx, `${at}.bar.category`, bar.category, barCols)) bar.category = null
    if (danglingColumn(ctx, `${at}.bar.value`, bar.value, barCols)) bar.value = null
    if (bar.aggregate === 'none') {
      const bad = uncertaintyProblem(bar.uncertainty, barCols, bar.value)
      if (bad) {
        report(ctx, `${at}.bar.uncertainty`, bad.ref, bad.problem)
        if (fix) bar.uncertainty = { kind: 'none' }
      }
    }
    const hist = p.histogram
    const histCols = optionColumns(ctx, hist, `${at}.histogram`, datasets)
    if (danglingColumn(ctx, `${at}.histogram.value`, hist.value, histCols)) hist.value = null
    if (danglingColumn(ctx, `${at}.histogram.groupBy`, hist.groupBy, histCols)) hist.groupBy = null
    const box = p.box
    const boxCols = optionColumns(ctx, box, `${at}.box`, datasets)
    if (danglingColumn(ctx, `${at}.box.value`, box.value, boxCols)) box.value = null
    if (danglingColumn(ctx, `${at}.box.groupBy`, box.groupBy, boxCols)) box.groupBy = null
  }

  if (doc.activePlotId !== null && !doc.plots.some((p) => p.id === doc.activePlotId)) {
    report(ctx, 'activePlotId', doc.activePlotId, 'dangling')
    if (fix) doc.activePlotId = doc.plots.length ? doc.plots[0].id : null
  }

  const liveSeries = new Set<string>(doc.plots.flatMap((p) => p.series.map((s) => s.id)))
  const fitIds = duplicateOf<{ id: string }>((f) => f.id)
  prune(
    ctx,
    doc.fits,
    (f) => `fits[${f.id}]`,
    (f) => fitIds(f) ?? (liveSeries.has(f.seriesId) ? null : { ref: f.seriesId, problem: 'dangling' }),
  )

  const exclusionIds = duplicateOf<{ id: string }>((e) => e.id)
  prune(
    ctx,
    doc.exclusions,
    (e) => `exclusions[${e.id}]`,
    (e) => exclusionIds(e) ?? (datasets.has(e.datasetId) ? null : { ref: e.datasetId, problem: 'dangling' }),
  )
  for (const e of doc.exclusions) {
    const rows = notebookRows.get(e.datasetId)
    if (rows && e.rowIds.some((r) => !rows.has(r))) {
      // Notebook rows deleted after the exclusion was made (ids are never reused).
      report(ctx, `exclusions[${e.id}].rowIds`, e.datasetId, 'stale-rows')
      if (fix) e.rowIds = e.rowIds.filter((r) => rows.has(r))
    }
  }
  // An exclusion without rows excludes nothing (in fix mode: also those emptied just above).
  prune(
    ctx,
    doc.exclusions,
    (e) => `exclusions[${e.id}]`,
    (e) => (e.rowIds.length === 0 ? { ref: e.id, problem: 'empty-exclusion' } : null),
  )

  const filterIds = duplicateOf<{ id: string }>((f) => f.id)
  prune(
    ctx,
    doc.filters,
    (f) => `filters[${f.id}]`,
    (f) => {
      const dup = filterIds(f)
      if (dup) return dup
      const cols = datasets.get(f.datasetId)
      if (!cols) return { ref: f.datasetId, problem: 'dangling' }
      return cols.has(f.column) ? null : { ref: f.column, problem: 'dangling' }
    },
  )

  return ctx
}
