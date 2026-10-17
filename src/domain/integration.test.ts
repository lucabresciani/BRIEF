/**
 * Cross-module integration tests: the paths no single module owns.
 * import → datasetView / pipeline → fit → figure → project file / CSV → back.
 * Every comparison after a round trip is BIT-exact (Object.is): a reopened project or a re-imported
 * export must give the same doubles, not merely close ones.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import { analysisSample } from '@/domain/derive/analysisSample'
import { buildDatasetView } from '@/domain/derive/datasetView'
import { createDeriver, type DerivedProject } from '@/domain/derive/pipeline'
import type { ColumnSummary, DatasetView, Selection } from '@/domain/derive/types'
import { analysisCsv, cellInDecimal, CSV_PRESETS, originalCsv } from '@/domain/export/csv'
import { buildFigure, type FigureContext } from '@/domain/figure/buildFigure'
import { figureContext } from '@/domain/figure/testing'
import {
  importBytes,
  importText,
  type ImportDraft,
  type ImportOverrides,
} from '@/domain/import/importPipeline'
import {
  ALL_REASON_CODES,
  DEFAULT_SERIES_STYLE,
  type ColumnId,
  type ColumnMeta,
  type ConfidenceLevel,
  type Dataset,
  type DatasetId,
  type ExclusionId,
  type Filter,
  type FilterId,
  type FitId,
  type FitModel,
  type FitSpec,
  type ImportedDataset,
  type Issue,
  type MeasurementSource,
  type NotebookDataset,
  type PlotId,
  type PlotSpec,
  type PlotType,
  type ProjectDoc,
  type ProjectId,
  type RawTable,
  type Result,
  type RowId,
  type SeriesId,
  type TransformSpec,
  type UncertaintySpec,
  type XUncertaintySpec,
  type XYSeriesSpec,
} from '@/domain/model'
import { checkFileSize } from '@/domain/import/limits'
import { importRegions } from '@/domain/import/regionImport'
import { tokenize } from '@/domain/import/tokenize'
import { cascadeRemoval, checkRefs, wouldCreateCycle } from '@/domain/model/integrity'
import { deserializeProject } from '@/domain/project/deserialize'
import { ProjectDocSchema } from '@/domain/project/schema'
import { checkReopenSize, serializeProject } from '@/domain/project/serialize'
import { initialPlot } from '@/domain/recommend/recommend'
// Test-only, read as data: the message catalogue the UI renders issues with (no UI code is imported).
import { issuesEn } from '@/i18n/issues.en'
import { issuesIt } from '@/i18n/issues.it'
import { issueHint, issueTitle, makeTranslator } from '@/i18n/translate'

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────

const EXAMPLES = ['ohm', 'freeFall', 'cooling', 'beerLambert', 'pendulum'] as const
const exampleText = (name: string) => readFileSync(resolve('src/examples', `${name}.csv`), 'utf8')
const fixtureBytes = (name: string) => new Uint8Array(readFileSync(resolve('tests/fixtures/import', name)))
const T0 = '2026-01-01T00:00:00.000Z'
/** Fuzz seeds and lengths can be raised locally: FUZZ_SEED=… FUZZ_STEPS=… npx vitest run src/domain/integration.test.ts */
const FUZZ_SEED = Number(process.env.FUZZ_SEED ?? 7)
const FUZZ_STEPS = Number(process.env.FUZZ_STEPS ?? 500)
const enc = (s: string) => new TextEncoder().encode(s)

function draftOf(r: Result<ImportDraft>): ImportDraft {
  if (!r.ok) throw new Error(`import failed: ${r.error.code} ${JSON.stringify(r.error.params ?? {})}`)
  return r.value
}

function datasetOf(d: ImportDraft, id: string): ImportedDataset {
  return {
    id: id as DatasetId,
    name: d.suggestedName,
    createdAt: T0,
    example: null,
    columns: d.columns,
    notes: d.notes,
    origin: 'import',
    rawTableId: d.rawTable.id,
    layout: d.layout,
  }
}

function linearFit(id: string, seriesId: string, model: FitModel = { type: 'linear' }): FitSpec {
  return {
    id: id as FitId,
    seriesId: seriesId as SeriesId,
    model,
    confidence: 0.95,
    show: { curve: true, confidenceBand: true, predictionBand: true, residuals: true },
    curveRange: { mode: 'data' },
    style: { color: { mode: 'series' }, dash: 'auto', width: 2 },
    perGroup: false,
  }
}

function docOf(datasets: Dataset[], plot: PlotSpec | null, fits: FitSpec[] = []): ProjectDoc {
  return {
    id: 'proj_1' as ProjectId,
    name: 'Integration',
    createdAt: T0,
    updatedAt: T0,
    datasets,
    plots: plot ? [plot] : [],
    activePlotId: plot ? plot.id : null,
    fits,
    exclusions: [],
    filters: [],
    numberFormat: { decimal: 'auto' },
  }
}

interface Project {
  doc: ProjectDoc
  rawTables: Record<string, RawTable>
}

/** What the app does on import: the dataset, the recommended first plot and, if suggested, a linear fit. */
function projectFromDraft(d: ImportDraft, id: string): Project {
  const dataset = datasetOf(d, id)
  const view = buildDatasetView(dataset, d.rawTable)
  const { plot, recommendation } = initialPlot(dataset, view, 'plot_1' as PlotId, 'ser_1' as SeriesId)
  plot.scatter = { ...plot.scatter, residualPanel: true }
  const fits = recommendation.suggestFit && plot.series.length ? [linearFit('fit_1', 'ser_1')] : []
  return { doc: docOf([dataset], plot, fits), rawTables: { [d.rawTable.id]: d.rawTable } }
}

/** Indices where two numeric arrays differ bit for bit (Object.is: NaN equals NaN, −0 differs from +0). */
function bitDiff(a: ArrayLike<number>, b: ArrayLike<number>): number[] {
  if (a.length !== b.length) return [-1]
  const out: number[] = []
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) out.push(i)
  return out
}

function expectSameView(a: DatasetView | undefined, b: DatasetView | undefined) {
  expect(a).toBeDefined()
  expect(b).toBeDefined()
  expect(Array.from(b!.rowIds)).toEqual(Array.from(a!.rowIds))
  expect(Array.from(b!.sourceRow)).toEqual(Array.from(a!.sourceRow))
  expect(Array.from(b!.blankRows)).toEqual(Array.from(a!.blankRows))
  expect(b!.columnOrder).toEqual(a!.columnOrder)
  for (const id of a!.columnOrder) {
    const ca = a!.columns.get(id)!
    const cb = b!.columns.get(id)!
    expect(cb.settings, id).toEqual(ca.settings)
    expect(bitDiff(ca.values, cb.values), id).toEqual([])
    expect(Array.from(cb.status), id).toEqual(Array.from(ca.status))
    expect(cb.text, id).toEqual(ca.text)
    expect(cb.categories?.labels ?? null, id).toEqual(ca.categories?.labels ?? null)
    expect(cb.report, id).toEqual(ca.report)
  }
}

/** The comparable parts of a DerivedProject (functions excluded, summaries evaluated for every column). */
function snapshot(d: DerivedProject) {
  const summaries: unknown[] = []
  for (const ds of d.doc.datasets)
    for (const c of ds.columns) summaries.push([ds.id, c.id, d.columnSummary(ds.id, c.id)])
  return {
    views: d.views,
    plotView: d.plotView,
    series: d.series,
    allSeries: d.allSeries,
    datasetIssues: d.datasetIssues,
    issues: d.issues,
    summaries,
  }
}

const screen = (over: Partial<FigureContext> = {}) => figureContext(over)
const exporting = (over: Partial<FigureContext> = {}) =>
  figureContext({ mode: 'export', size: { width: 1000, height: 650 }, ...over })

/** Small deterministic PRNG (mulberry32) so the fuzz cases are reproducible from the seed. */
function rng(seed: number) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (n: number) => Math.floor(next() * n)
  const pick = <T>(xs: readonly T[]): T => xs[int(xs.length)]!
  const bool = (p = 0.5) => next() < p
  return { next, int, pick, bool }
}

// ── 1. examples end to end, through a save / reopen cycle ───────────────────────────────────────────

describe('examples: import → derive → figure → save → reopen → identical results', () => {
  for (const name of EXAMPLES) {
    it(name, () => {
      const d = draftOf(importText(exampleText(name), { kind: 'example', fileName: `${name}.csv` }))
      expect(d.fastPath).toBe(true)
      expect(d.issues.filter((i) => i.severity === 'error')).toEqual([])
      const p = projectFromDraft(d, 'ds_1')
      expect(checkRefs(p.doc)).toEqual([])

      const derived = createDeriver()(p.doc, p.rawTables)
      expect(derived.issues.filter((i) => i.severity === 'error')).toEqual([])
      for (const s of derived.series) if (s.fit) expect(s.fit.status).toBe('ok')
      const fig = buildFigure(derived, screen())
      const figExport = buildFigure(derived, exporting())
      expect(fig.data.length).toBeGreaterThan(0)
      expect(fig.issues.filter((i) => i.severity === 'error')).toEqual([])
      expect(figExport.issues.filter((i) => i.severity === 'error')).toEqual([])
      // No false note on the bundled measurements: real spreads, x constant in replicate groups.
      const notes = [...derived.issues, ...fig.issues].map((i) => i.code)
      for (const ds of p.doc.datasets)
        for (const c of ds.columns)
          notes.push(...(derived.columnSummary(ds.id, c.id)?.warnings ?? []).map((w) => w.code))
      for (const code of ['I_ZERO_SPREAD', 'W_GROUP_X_VARIES', 'I_DATE_AXIS_LINEAR'])
        expect(notes, code).not.toContain(code)

      // Save and reopen: same document, same raw tables, same derived numbers and the same figure.
      const text = serializeProject(p.doc, p.rawTables, [], '0.0.0-test', T0)
      const back = deserializeProject(text)
      if (!back.ok) throw new Error(back.error.code)
      expect(back.value.repaired).toEqual([])
      expect(back.value.doc).toEqual(p.doc)
      expect(back.value.rawTables).toEqual(p.rawTables)
      const derived2 = createDeriver()(back.value.doc, back.value.rawTables)
      expectSameView(derived.views.get('ds_1' as DatasetId), derived2.views.get('ds_1' as DatasetId))
      expect(snapshot(derived2)).toEqual(snapshot(derived))
      expect(buildFigure(derived2, screen())).toEqual(fig)
      expect(buildFigure(derived2, exporting())).toEqual(figExport)

      // Saving the reopened project again gives the same file content.
      const again = serializeProject(back.value.doc, back.value.rawTables, [], '0.0.0-test', T0)
      expect(JSON.parse(again)).toEqual(JSON.parse(text))
    })
  }

  it('Ohm through the whole chain matches the exact oracle (slope, SE, R², residual signs)', () => {
    const ref = JSON.parse(readFileSync(resolve('tests/fixtures/reference/ohm.json'), 'utf8')).linear
    const d = draftOf(importText(exampleText('ohm'), { kind: 'example', fileName: 'ohm.csv' }))
    const p = projectFromDraft(d, 'ds_1')
    const back = deserializeProject(serializeProject(p.doc, p.rawTables, [], 'test', T0))
    if (!back.ok) throw new Error(back.error.code)
    const fit = createDeriver()(back.value.doc, back.value.rawTables).series[0]!.fit!
    if (fit.status !== 'ok') throw new Error(fit.error.code)
    const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b)
    expect(rel(fit.params[1]!.value, Number(ref.coefficients[1]))).toBeLessThan(1e-13)
    expect(rel(fit.params[1]!.se!, Number(ref.se[1]))).toBeLessThan(1e-12)
    expect(rel(fit.params[0]!.value, Number(ref.coefficients[0]))).toBeLessThan(1e-11)
    expect(rel(fit.r2!, Number(ref.r2))).toBeLessThan(1e-15)
    expect(fit.residualSignRuns).toBe(ref.residualSigns)
    expect(fit.provenance.nUsed).toBe(ref.n)
  })
})

// ── 2. CSV exports read back by the importer ─────────────────────────────────────────────────────────

describe('analysis CSV export → importer: the same doubles come back', () => {
  for (const preset of ['standard', 'excelItalian'] as const) {
    for (const name of EXAMPLES) {
      it(`${name} (${preset})`, () => {
        const d = draftOf(importText(exampleText(name), { kind: 'example', fileName: `${name}.csv` }))
        const dataset = datasetOf(d, 'ds_a')
        const view = buildDatasetView(dataset, d.rawTable)
        const sample = analysisSample(
          view,
          dataset.columns.map((c) => c.id),
          [],
          [],
        )
        const opts = CSV_PRESETS[preset]
        const csv = analysisCsv({ view, columns: dataset.columns, sample }, opts)
        const back = draftOf(importBytes(enc(csv), `${name}-analysis.csv`))
        expect(back.detection.delimiter).toBe(opts.delimiter)
        expect(back.issues.filter((i) => i.severity === 'error')).toEqual([])
        expect(back.columns.map((c) => c.name)).toEqual([
          'row',
          ...dataset.columns.map((c) => c.name),
          'status',
        ])
        expect(back.columns.slice(1, -1).map((c) => c.unit)).toEqual(dataset.columns.map((c) => c.unit))

        const view2 = buildDatasetView(datasetOf(back, 'ds_b'), back.rawTable)
        expect(bitDiff(view2.columns.get(back.columns[0]!.id)!.values, view.sourceRow)).toEqual([])
        dataset.columns.forEach((c, k) => {
          const a = view.columns.get(c.id)!
          const b = view2.columns.get(back.columns[k + 1]!.id)!
          expect(b.settings.kind, c.name).toBe(a.settings.kind)
          if (a.settings.kind === 'numeric') {
            // The decimal separator the exporter wrote is the one the importer reads.
            expect(b.settings.decimal === 'mixed', c.name).toBe(false)
            expect(bitDiff(a.values, b.values), c.name).toEqual([])
            expect(Array.from(b.status), c.name).toEqual(Array.from(a.status))
          } else expect(b.text, c.name).toEqual(a.text)
        })
      })
    }
  }

  it('values that need 17 significant digits, tiny and huge magnitudes survive both presets', () => {
    const values = [
      0.1 + 0.2,
      1 / 3,
      -2.5e-300,
      6.02214076e23,
      123456.789,
      -0.000123,
      5e-324,
      1.7976931348623157e308,
    ]
    const text = 'x (m),y (s)\n' + values.map((v, i) => `${i},${v}`).join('\n') + '\n'
    const d = draftOf(importText(text, { kind: 'csv', fileName: 'edge.csv' }))
    const dataset = datasetOf(d, 'ds_e')
    const view = buildDatasetView(dataset, d.rawTable)
    const yId = dataset.columns[1]!.id
    expect(bitDiff(view.columns.get(yId)!.values, values)).toEqual([])
    for (const preset of ['standard', 'excelItalian'] as const) {
      const sample = analysisSample(view, [yId], [], [])
      const csv = analysisCsv({ view, columns: dataset.columns, sample }, CSV_PRESETS[preset])
      const back = draftOf(importBytes(enc(csv), 'edge-analysis.csv'))
      const view2 = buildDatasetView(datasetOf(back, 'ds_f'), back.rawTable)
      expect(bitDiff(view2.columns.get(back.columns[2]!.id)!.values, values), preset).toEqual([])
    }
  })

  it('a fitted analysis CSV carries in_fit, predicted and residual columns that read back exactly', () => {
    const d = draftOf(importText(exampleText('ohm'), { kind: 'example', fileName: 'ohm.csv' }))
    const p = projectFromDraft(d, 'ds_1')
    p.doc.exclusions = [
      {
        id: 'exc_1' as ExclusionId,
        datasetId: 'ds_1' as DatasetId,
        rowIds: [3 as RowId],
        reason: 'measurement-problem',
        note: '',
        createdAt: T0,
      },
    ]
    const derived = createDeriver()(p.doc, p.rawTables)
    const s = derived.series[0]!
    if (s.fit?.status !== 'ok') throw new Error('fit failed')
    const fit = s.fit
    const csv = analysisCsv(
      { view: s.view, columns: [s.xColumn, s.yColumn], sample: s.data.sample, fit },
      CSV_PRESETS.excelItalian,
    )
    const back = draftOf(importBytes(enc(csv), 'ohm-fit.csv'))
    expect(back.columns.map((c) => c.name)).toEqual(['row', 'I', 'V', 'status', 'in_fit', 'residual'])
    const view2 = buildDatasetView(datasetOf(back, 'ds_r'), back.rawTable)
    const inFit = view2.columns.get(back.columns[4]!.id)!.values
    const residual = view2.columns.get(back.columns[5]!.id)!.values
    const used = new Set<number>(fit.provenance.rowIdsUsed)
    expect(Array.from(inFit)).toEqual(Array.from(s.view.rowIds, (r) => (used.has(r) ? 1 : 0)))
    const expected = Array.from(s.view.rowIds, (r) => {
      const k = fit.provenance.rowIdsUsed.indexOf(r as RowId)
      return k < 0 ? NaN : fit.residuals[k]!
    })
    expect(bitDiff(residual, expected)).toEqual([])
    expect(fit.provenance.nUsed).toBe(9)
  })
})

describe('original CSV export → importer: same text (decimal mark aside), same values', () => {
  for (const name of EXAMPLES) {
    it(name, () => {
      const d = draftOf(importText(exampleText(name), { kind: 'example', fileName: `${name}.csv` }))
      const dataset = datasetOf(d, 'ds_o')
      const view = buildDatasetView(dataset, d.rawTable)
      for (const preset of ['standard', 'excelItalian'] as const) {
        const opts = CSV_PRESETS[preset]
        const back = draftOf(importBytes(enc(originalCsv(dataset, d.rawTable, opts)), `${name}.csv`))
        expect(back.columns.map((c) => [c.name, c.unit])).toEqual(
          dataset.columns.map((c) => [c.name, c.unit]),
        )
        const view2 = buildDatasetView(datasetOf(back, 'ds_p'), back.rawTable)
        dataset.columns.forEach((c, k) => {
          const a = view.columns.get(c.id)!
          const b = view2.columns.get(back.columns[k]!.id)!
          // The examples use '.' decimals: the Italian Excel preset writes them with ',' (only the
          // decimal mark of numbers changes), and the importer reads that back with ',' as decimal.
          const numeric = a.settings.kind === 'numeric'
          const text = numeric
            ? a.text.map((s) => cellInDecimal(s, a.settings.decimal, opts.decimal))
            : a.text
          expect(b.text, `${preset} ${c.name}`).toEqual(text)
          const decimal =
            numeric && opts.decimal === ',' && a.text.some((s) => s.includes('.')) ? 'comma' : null
          expect(b.settings, `${preset} ${c.name}`).toEqual(decimal ? { ...a.settings, decimal } : a.settings)
          expect(Array.from(b.status), `${preset} ${c.name}`).toEqual(Array.from(a.status))
          expect(bitDiff(a.values, b.values), `${preset} ${c.name}`).toEqual([])
        })
      }
    })
  }
})

// ── 3. spreadsheets and notebooks through the project file ─────────────────────────────────────────

describe('spreadsheet import → save → reopen keeps native cells and parsed values', () => {
  const files = [
    'excel-saved.xlsx',
    'libreoffice-saved.xlsx',
    'libreoffice-saved.ods',
    'date1904.xlsx',
    'merged-header.xlsx',
    'data-from-A3.xlsx',
    'formula-no-cache.xlsx',
    'biff8-tables.xls',
    'excel95-cp1252.xls',
  ]
  for (const f of files) {
    it(f, () => {
      const d = draftOf(importBytes(fixtureBytes(f), f, {}, { xlsx: XLSX }))
      expect(d.rawTable.columns.some((c) => c.native !== null)).toBe(true)
      const p = projectFromDraft(d, 'ds_x')
      const derived = createDeriver()(p.doc, p.rawTables)
      const fig = buildFigure(derived, screen())
      const back = deserializeProject(serializeProject(p.doc, p.rawTables, [], 'test', T0))
      if (!back.ok) throw new Error(back.error.code)
      expect(back.value.repaired).toEqual([])
      expect(back.value.rawTables).toEqual(p.rawTables)
      const derived2 = createDeriver()(back.value.doc, back.value.rawTables)
      expectSameView(derived.views.get('ds_x' as DatasetId), derived2.views.get('ds_x' as DatasetId))
      expect(snapshot(derived2)).toEqual(snapshot(derived))
      expect(buildFigure(derived2, screen())).toEqual(fig)
    })

    it(`${f}: analysis CSV (dates as ISO 8601, percents as shown) reads back to the same values`, () => {
      const d = draftOf(importBytes(fixtureBytes(f), f, {}, { xlsx: XLSX }))
      const dataset = datasetOf(d, 'ds_y')
      const view = buildDatasetView(dataset, d.rawTable)
      const sample = analysisSample(view, [], [], [])
      for (const preset of ['standard', 'excelItalian'] as const) {
        const csv = analysisCsv({ view, columns: dataset.columns, sample }, CSV_PRESETS[preset])
        const back = draftOf(importBytes(enc(csv), 'analysis.csv'))
        const view2 = buildDatasetView(datasetOf(back, 'ds_z'), back.rawTable)
        dataset.columns.forEach((c, k) => {
          const a = view.columns.get(c.id)!
          const b = view2.columns.get(back.columns[k + 1]!.id)!
          const label = `${preset} ${c.name}`
          if (a.settings.kind === 'numeric' || a.settings.kind === 'datetime') {
            // An all-missing column comes back as text: nothing to compare but its emptiness.
            if (a.report.nValid === 0) expect(b.report.nValid, label).toBe(0)
            else {
              expect(b.settings.kind, label).toBe(a.settings.kind)
              expect(bitDiff(a.values, b.values), label).toEqual([])
            }
          }
        })
      }
    })
  }
})

/**
 * Sheet blocks through the per-plot deriver and the schema 2 project file: the region
 * provenance must pass the schema, survive the round trip, and keep naming sheet columns for records
 * that were columns of the sheet.
 */
describe('sheet regions → derive → figure → CSV → save → reopen', () => {
  const MICRO = 'micro-tables.xlsx'
  const regionDrafts = (spec: Parameters<typeof importRegions>[2]) => {
    const r = importRegions(fixtureBytes(MICRO), MICRO, spec, {}, { xlsx: XLSX })
    if (!r.ok) throw new Error(`import failed: ${r.error.code}`)
    return r.value
  }
  type HoverTrace = { uid: string; customdata: unknown[][]; hovertemplate: string }
  const pointsOf = (fig: ReturnType<typeof buildFigure>) => {
    const t = (fig.data as unknown as HoverTrace[]).find((x) => x.uid === 'ser_1__points')
    if (!t) throw new Error('no points trace')
    return t
  }
  const reopen = (p: Project) => {
    const back = deserializeProject(serializeProject(p.doc, p.rawTables, [], 'test', T0))
    if (!back.ok) throw new Error(`reopen failed: ${back.error.code} ${JSON.stringify(back.error.params)}`)
    expect(back.value.repaired).toEqual([])
    expect(back.value.rawTables).toEqual(p.rawTables)
    return back.value
  }

  it('stacked transposed blocks: records are sheet columns in the hover, caption and CSV, before and after reopening', () => {
    const [d, ...rest] = regionDrafts({
      sheetName: 'Transposed',
      mode: 'stack',
      regions: ['B2:F6', 'B8:F12'].map((range) => ({ range, orientation: 'rows' as const })),
    })
    expect(rest).toEqual([])
    expect(d!.rawTable.source.region).toMatchObject({ orientation: 'rows', labelColumns: [0] })
    const p = projectFromDraft(d!, 'ds_t')
    const view0 = buildDatasetView(datasetOf(d!, 'ds_t'), d!.rawTable)
    // The second record of the first block: sheet column D.
    const excludedRow = view0.rowIds[1]!
    p.doc = {
      ...p.doc,
      exclusions: [
        {
          id: 'ex_1' as ExclusionId,
          datasetId: 'ds_t' as DatasetId,
          rowIds: [excludedRow as RowId],
          reason: 'measurement-problem',
          note: '',
          createdAt: T0,
        },
      ],
    }

    const derived = createDeriver()(p.doc, p.rawTables)
    const view = derived.views.get('ds_t' as DatasetId)!
    expect(view.recordAxis).toBe('column')
    const fig = buildFigure(derived, screen())
    const points = pointsOf(fig)
    // Both tables have a sheet column C: the hover names the table with the column (whole line in the field).
    const at = (block: string, pos: string) =>
      `table.blockRecord|${JSON.stringify({ block, axis: 'column', pos })}`
    expect(points.customdata.map((c) => c[1])).toEqual([
      at('layers 0', 'C'),
      at('layers 0', 'E'),
      at('layers 0', 'F'),
      at('layers 2', 'C'),
      at('layers 2', 'D'),
      at('layers 2', 'E'),
      at('layers 2', 'F'),
    ])
    expect(points.hovertemplate).not.toContain('figure.hover.column')
    expect(points.hovertemplate).not.toContain('figure.hover.row')
    const records = `table.blockRecords|${JSON.stringify({ block: 'layers 0', axis: 'column', count: 1, list: 'D' })}`
    expect(
      fig.caption.some((l) =>
        l.startsWith(`figure.caption.excludedRecords|{"records":${JSON.stringify(records)}`),
      ),
    ).toBe(true)

    const dataset = p.doc.datasets[0] as ImportedDataset
    const sample = analysisSample(
      view,
      dataset.columns.map((c) => c.id),
      p.doc.exclusions,
      [],
    )
    const csv = analysisCsv({ view, columns: dataset.columns, sample }, CSV_PRESETS.standard)
    const lines = csv.split(/\r?\n/)
    expect(lines[0]!.split(',')[0]).toBe('column')
    expect(lines.slice(1, 9).map((l) => l.split(',').slice(0, 2).join(','))).toEqual([
      'C,0',
      'D,0',
      'E,0',
      'F,0',
      'C,2',
      'D,2',
      'E,2',
      'F,2',
    ])

    const back = reopen(p)
    const derived2 = createDeriver()(back.doc, back.rawTables)
    expect(derived2.views.get('ds_t' as DatasetId)!.recordAxis).toBe('column')
    expect(snapshot(derived2)).toEqual(snapshot(derived))
    expect(buildFigure(derived2, screen())).toEqual(fig)
  })

  it('separate blocks in columns: one dataset per block, records stay sheet rows, regions survive reopening', () => {
    const drafts = regionDrafts({
      sheetName: 'Grid',
      mode: 'separate',
      regions: ['B2:E9', 'G2:J9'].map((range) => ({ range, orientation: 'columns' as const })),
    })
    expect(drafts).toHaveLength(2)
    const datasets = drafts.map((d, k) => datasetOf(d, `ds_${k}`))
    const rawTables = Object.fromEntries(drafts.map((d) => [d.rawTable.id, d.rawTable]))
    const first = projectFromDraft(drafts[0]!, 'ds_0')
    const p: Project = { doc: { ...first.doc, datasets }, rawTables }

    const derived = createDeriver()(p.doc, p.rawTables)
    for (const ds of datasets) expect(derived.views.get(ds.id)!.recordAxis).toBe('row')
    const fig = buildFigure(derived, screen())
    const points = pointsOf(fig)
    expect(points.hovertemplate).toContain('figure.hover.row')
    expect(points.customdata.map((c) => c[1])).toEqual([4, 5, 6, 7, 8, 9])

    const back = reopen(p)
    const derived2 = createDeriver()(back.doc, back.rawTables)
    expect(snapshot(derived2)).toEqual(snapshot(derived))
    expect(buildFigure(derived2, screen())).toEqual(fig)
  })
})

function numericMeta(
  id: string,
  name: string,
  source: ColumnMeta['source'],
  unit: string | null,
): ColumnMeta {
  return {
    id: id as ColumnId,
    source,
    name,
    unit,
    unitSource: unit ? 'user' : null,
    role: 'measurement',
    uncertaintyOf: null,
    detected: { kind: 'numeric', decimal: 'dot', percent: 'display', confidence: 'high', explanations: [] },
    override: {},
  }
}

function notebookDataset(): NotebookDataset {
  return {
    id: 'ds_nb' as DatasetId,
    name: 'Notebook',
    createdAt: T0,
    example: null,
    origin: 'notebook',
    columns: [
      numericMeta('col_t', 't', { type: 'notebook' }, 's'),
      numericMeta('col_n', 'N', { type: 'notebook' }, null),
      numericMeta(
        'col_ln',
        'ln N',
        { type: 'derived', spec: { op: 'ln', input: 'col_n' as ColumnId } },
        null,
      ),
    ],
    notes: [],
    rowIds: [0, 1, 2, 3, 4, 5, 7].map((r) => r as RowId),
    cells: {
      col_t: ['0', '1', '2', '3', '4', '', '6'],
      col_n: ['1000', '612', '371', '0', '137', '80', 'n/a'],
    },
    nextRowId: 8,
  }
}

describe('notebook dataset with a derived column', () => {
  it('derives, fits, draws and survives a save / reopen bit for bit', () => {
    const ds = notebookDataset()
    const plot: PlotSpec = {
      ...initialPlot(ds, buildDatasetView(ds, null), 'plot_1' as PlotId, 'ser_1' as SeriesId).plot,
    }
    plot.type = 'scatter'
    plot.series = [
      {
        id: 'ser_1' as SeriesId,
        datasetId: ds.id,
        name: null,
        x: 'col_t' as ColumnId,
        y: 'col_n' as ColumnId,
        visible: true,
        style: { ...DEFAULT_SERIES_STYLE },
        errorBars: { x: { kind: 'none' }, y: { kind: 'none' }, visible: true },
        split: null,
      },
    ]
    const doc = docOf([ds], plot, [linearFit('fit_1', 'ser_1', { type: 'exponential' })])
    const derived = createDeriver()(doc, {})
    const s = derived.series[0]!
    // Rows: t missing (row 5), N = 0 (valid for the column, out of the log domain of the fit), N 'n/a'.
    expect(s.data.sample.nTotal).toBe(7)
    expect(s.data.sample.nActive).toBe(5)
    expect(s.fit?.status).toBe('error')
    if (s.fit?.status === 'error') expect(s.fit.error.code).toBe('E_LOG_DOMAIN_FIT')
    // ln N: N = 0 is out of the domain of ln → E_TRANSFORM_DOMAIN on that row only.
    const dom = derived.datasetIssues.get(ds.id)!.find((i) => i.code === 'E_TRANSFORM_DOMAIN')
    expect(dom?.rows).toEqual([3])
    const lnN = derived.views.get(ds.id)!.columns.get('col_ln' as ColumnId)!
    expect(lnN.values[0]).toBe(Math.log(1000))
    expect(Number.isNaN(lnN.values[3]!)).toBe(true)

    const fig = buildFigure(derived, screen())
    const back = deserializeProject(serializeProject(doc, {}, [], 'test', T0))
    if (!back.ok) throw new Error(back.error.code)
    expect(back.value.doc).toEqual(doc)
    const derived2 = createDeriver()(back.value.doc, back.value.rawTables)
    expectSameView(derived.views.get(ds.id), derived2.views.get(ds.id))
    expect(snapshot(derived2)).toEqual(snapshot(derived))
    expect(buildFigure(derived2, screen())).toEqual(fig)
  })
})

describe('pipeline ↔ figure: a date axis is never logarithmic', () => {
  // Dates up to 1970-01-01 are epoch milliseconds ≤ 0: a log mask would hide them from a time axis.
  const csv =
    'date,level (m)\n1965-03-01,2.1\n1969-12-31,2.4\n1970-01-01,2.2\n1975-06-01,2.9\n1980-01-01,3.1\n'
  const project = (xScale: 'linear' | 'log', yScale: 'linear' | 'log') => {
    const d = draftOf(importText(csv, { kind: 'csv', fileName: 'levels.csv' }))
    const p = projectFromDraft(d, 'ds_t')
    const plot = p.doc.plots[0]!
    p.doc.plots = [
      {
        ...plot,
        type: 'scatter',
        xAxis: { ...plot.xAxis, scale: xScale },
        yAxis: { ...plot.yAxis, scale: yScale },
      },
    ]
    return createDeriver()(p.doc, p.rawTables)
  }

  it('a log scale requested on a date axis hides no date and claims no hidden point', () => {
    const lin = project('linear', 'linear')
    const log = project('log', 'linear')
    expect(lin.series[0]!.xColumn.detected.kind).toBe('datetime')
    expect(log.axisScales).toEqual({ x: 'linear', y: 'linear' })
    expect(Array.from(log.series[0]!.data.render)).toEqual([0, 0, 0, 0, 0])
    const fig = buildFigure(log, screen())
    expect((fig.layout.xaxis as { type?: string }).type).toBe('date')
    expect(fig.issues.map((i) => i.code)).not.toContain('W_LOG_AXIS_HIDDEN')
    // The figure is the linear one: same points drawn, and the ignored log request is reported.
    expect(fig.data).toEqual(buildFigure(lin, screen()).data)
    expect(fig.issues).toContainEqual({ code: 'I_DATE_AXIS_LINEAR', severity: 'info', params: { axis: 'x' } })
    expect(buildFigure(lin, screen()).issues.map((i) => i.code)).not.toContain('I_DATE_AXIS_LINEAR')
  })

  it('the numeric y axis still honours its log scale next to a date x axis', () => {
    const log = project('log', 'log')
    expect(log.axisScales).toEqual({ x: 'linear', y: 'log' })
    expect((buildFigure(log, screen()).layout.yaxis as { type?: string }).type).toBe('log')
  })
})

// ── 4. robustness: the importer and the deriver never throw ────────────────────────────────────────

describe('importer: row overrides from the dialog never make it throw', () => {
  it('600 random overrides (stale, out of range, non-integer, inconsistent)', () => {
    const r = rng(20261014 + FUZZ_SEED - 7)
    const inputs = [
      ...EXAMPLES.map(exampleText),
      ...[
        'preamble-12.csv',
        'units-row.csv',
        'blank-lines.csv',
        'ragged.csv',
        'embedded-newline.csv',
        'sep-line.csv',
      ].map((f) => readFileSync(resolve('tests/fixtures/import', f), 'utf8')),
    ]
    const failures: string[] = []
    const deriver = createDeriver()
    for (let k = 0; k < FUZZ_STEPS + 100; k++) {
      const text = r.pick(inputs)
      const n = text.split('\n').length
      const row = () =>
        r.pick<number | undefined>([
          undefined,
          -1,
          0,
          1,
          2,
          3,
          n - 2,
          n - 1,
          n,
          n + 7,
          1.5,
          NaN,
          r.int(n + 3),
        ])
      const ov: ImportOverrides = {}
      if (r.bool(0.7)) ov.headerRow = r.bool(0.2) ? null : row()
      if (r.bool(0.5)) ov.unitsRow = r.bool(0.3) ? null : row()
      if (r.bool(0.6)) ov.dataStartRow = row()
      if (r.bool(0.2)) ov.delimiter = r.pick([',', ';', '\t', '|', 'none'] as const)
      if (r.bool(0.1)) ov.ignoreQuotes = true
      try {
        const res = importText(text, { kind: 'csv', fileName: 'fuzz.csv' }, ov)
        if (!res.ok) continue
        const d = res.value
        const { layout } = d
        const rows = d.rawTable.rowCount
        for (const v of [layout.headerRow, layout.unitsRow, layout.dataStartRow, layout.dataEndRow])
          if (v !== null && !(Number.isInteger(v) && v >= 0 && v < rows))
            failures.push(
              `layout out of grid ${JSON.stringify(layout)} rows ${rows} ov ${JSON.stringify(ov)}`,
            )
        const p = projectFromDraft(d, 'ds_f')
        const derived = deriver(p.doc, p.rawTables)
        buildFigure(derived, screen())
      } catch (e) {
        failures.push(`${JSON.stringify(ov)} on input ${inputs.indexOf(text)}: ${String(e)}`)
      }
    }
    expect(failures).toEqual([])
  })
})

/**
 * Stateful fuzz of the deriver: a project with every example plus a notebook dataset is edited step by
 * step the way immer does it (only the changed path gets new objects), and after each step the SHARED,
 * memoised deriver must give exactly what a FRESH deriver computes for the same document: no stale cache
 * entry may survive an edit. Every document is schema-valid and free of dangling references, and neither
 * the deriver nor the figure builder may throw. `visit` receives every issue produced along the way.
 */
interface FuzzStats {
  failures: string[]
  fitsOk: number
  fitsError: number
}

function runEditFuzz(
  seed: number,
  steps: number,
  visit: (issues: readonly Issue[]) => void = () => {},
): FuzzStats {
  const r = rng(seed)
  const imported = [
    ...EXAMPLES.map((name) =>
      draftOf(importText(exampleText(name), { kind: 'example', fileName: `${name}.csv` })),
    ),
    // A time series with dates before 1970 (epoch ms ≤ 0), a label column and a missing value.
    draftOf(
      importText(
        'date,level (m),site\n1962-05-01,2.1,A\n1966-05-01,2.4,B\n1969-12-31,NA,A\n1970-01-01,2.2,B\n' +
          '1974-05-01,2.9,A\n1978-05-01,3.1,B\n1982-05-01,3.0,A\n1990-05-01,3.6,B\n',
        { kind: 'csv', fileName: 'levels.csv' },
      ),
    ),
  ]
  const rawTables: Record<string, RawTable> = Object.fromEntries(
    imported.map((d) => [d.rawTable.id, d.rawTable]),
  )
  const datasets: Dataset[] = [...imported.map((d, k) => datasetOf(d, `ds_${k}`)), notebookDataset()]
  const first = datasets[0]!
  let doc = docOf(
    datasets,
    initialPlot(
      first,
      buildDatasetView(first, imported[0]!.rawTable),
      'plot_1' as PlotId,
      'ser_0' as SeriesId,
    ).plot,
  )
  let uid = 0
  const fresh = (prefix: string) => `${prefix}_${++uid}`

  const plotOf = () => doc.plots[0]!
  const setPlot = (patch: Partial<PlotSpec>) => {
    doc = { ...doc, plots: [{ ...plotOf(), ...patch }] }
  }
  /** Replaces the series list; fits of series that are gone go with them (as the store's cascade does). */
  const setSeries = (series: XYSeriesSpec[]) => {
    setPlot({ series })
    const kept = new Set<string>(series.map((s) => s.id))
    if (doc.fits.some((f) => !kept.has(f.seriesId)))
      doc = { ...doc, fits: doc.fits.filter((f) => kept.has(f.seriesId)) }
  }
  const anyDataset = () => r.pick(doc.datasets)
  const anyColumn = (ds: Dataset) => r.pick(ds.columns)
  /** Mostly a numeric column (what a user plots), sometimes any column (labels, identifiers…). */
  const axisColumn = (ds: Dataset) => {
    const numeric = ds.columns.filter((c) => (c.override.kind ?? c.detected.kind) === 'numeric')
    return numeric.length && r.bool(0.85) ? r.pick(numeric) : anyColumn(ds)
  }
  /** Uncertainty sources must be measured (raw / notebook) columns: E_DERIVED_UNCERTAINTY otherwise. */
  const sourceColumn = (ds: Dataset) => r.pick(ds.columns.filter((c) => c.source.type !== 'derived'))
  const datasetById = (id: DatasetId) => doc.datasets.find((d) => d.id === id)!
  const rowIdsOf = (ds: Dataset) =>
    ds.origin === 'notebook'
      ? ds.rowIds
      : Array.from(
          { length: ds.layout.dataEndRow - ds.layout.dataStartRow + 1 },
          (_, i) => (ds.layout.dataStartRow + i) as RowId,
        )
  const conf = () => r.pick<ConfidenceLevel>([0.9, 0.95, 0.99])
  /**
   * A measurement-uncertainty spec for the value column `value`. Column sources only on a measured
   * (raw / notebook) value column: on a derived one they are refused (E_DERIVED_UNCERTAINTY, no
   * propagation), so the generator gives a typed value there, as the uncertainty panel does.
   */
  const measurement = (ds: Dataset, value: ColumnId): XUncertaintySpec => {
    const derivedValue = ds.columns.find((c) => c.id === value)?.source.type === 'derived'
    const meaning = r.pick([
      { type: 'standard' as const },
      { type: 'expanded' as const, k: r.pick([1, 2, 3]) },
      { type: 'unspecified' as const },
    ])
    const origin = r.pick(['instrument', 'user'] as const)
    const pick = r.int(5)
    switch (derivedValue && pick >= 3 ? 1 : pick) {
      case 0:
        return { kind: 'none' }
      case 1:
        return {
          kind: 'measurement',
          origin,
          meaning,
          source: { type: 'absolute', value: r.pick([0, 0.01, 0.5, 3]) },
        }
      case 2:
        return {
          kind: 'measurement',
          origin,
          meaning,
          source: { type: 'percent', percent: r.pick([0, 1, 5, 150]) },
        }
      case 3:
        return {
          kind: 'measurement',
          origin,
          meaning,
          source: { type: 'column', column: sourceColumn(ds).id },
        }
      default:
        return {
          kind: 'measurement',
          origin,
          meaning,
          source: { type: 'columnAsymmetric', plus: sourceColumn(ds).id, minus: sourceColumn(ds).id },
        }
    }
  }
  const yUncertainty = (ds: Dataset, value: ColumnId): UncertaintySpec => {
    const grouping = r.bool() ? { by: 'sameX' as const } : { by: 'column' as const, column: anyColumn(ds).id }
    switch (r.int(5)) {
      case 0:
        return { kind: 'sd', grouping }
      case 1:
        return { kind: 'sem', grouping }
      case 2:
        return { kind: 'ci', grouping, level: conf(), method: 't' }
      default:
        return measurement(ds, value)
    }
  }
  const newSeries = (): XYSeriesSpec => {
    const ds = anyDataset()
    const id = fresh('ser') as SeriesId
    const name = r.bool(0.2) ? 'Series <b>&%{x}' : null
    const x = axisColumn(ds).id
    const y = axisColumn(ds).id
    const visible = r.bool(0.85)
    const style = { ...DEFAULT_SERIES_STYLE, paletteIndex: r.int(10) }
    const errorBars = { x: measurement(ds, x), y: yUncertainty(ds, y), visible: r.bool(0.8) }
    return { id, datasetId: ds.id, name, x, y, visible, style, errorBars, split: null }
  }
  const fitModel = (): FitModel =>
    r.pick<FitModel>([
      { type: 'linear' },
      { type: 'polynomial', degree: 1 + r.int(10) },
      { type: 'exponential' },
      { type: 'power' },
    ])
  const range = () =>
    r.bool(0.6)
      ? ({ mode: 'auto' } as const)
      : ({ mode: 'fixed', min: r.pick([-10, 0, 0.5, 1, 100]), max: r.pick([-5, 0, 1, 10, 1000]) } as const)

  const addFit = () => {
    const s = plotOf().series
    if (!s.length) return
    const seriesId = r.pick(s).id
    const spec: FitSpec = {
      id: fresh('fit') as FitId,
      seriesId,
      model: fitModel(),
      confidence: conf(),
      show: { curve: r.bool(0.9), confidenceBand: r.bool(), predictionBand: r.bool(), residuals: r.bool() },
      curveRange: r.bool(0.7)
        ? { mode: 'data' }
        : { mode: 'extend', min: r.pick([-1, 0, 2]), max: r.pick([-2, 1, 50]) },
      style: { color: { mode: 'series' }, dash: 'auto', width: 2 },
      perGroup: false,
    }
    doc = { ...doc, fits: [...doc.fits.filter((f) => f.seriesId !== seriesId), spec] }
  }
  const editFit = () => {
    if (!doc.fits.length) return
    const k = r.int(doc.fits.length)
    const f = doc.fits[k]!
    const next = r.pick<Partial<FitSpec>>([
      { model: fitModel() },
      { confidence: conf() },
      { show: { ...f.show, confidenceBand: !f.show.confidenceBand } },
    ])
    doc = { ...doc, fits: doc.fits.map((v, i) => (i === k ? { ...v, ...next } : v)) }
  }

  const edits: (() => void)[] = [
    () => setPlot({ type: r.pick<PlotType>(['scatter', 'line', 'bar', 'histogram', 'box']) }),
    () => setPlot({ xAxis: { ...plotOf().xAxis, scale: r.pick(['linear', 'log'] as const) } }),
    () =>
      setPlot({ yAxis: { ...plotOf().yAxis, scale: r.pick(['linear', 'log'] as const), range: range() } }),
    () => setPlot({ xAxis: { ...plotOf().xAxis, range: range(), label: r.bool() ? null : 'x <i>&' } }),
    () => setSeries([...plotOf().series, newSeries()].slice(-3)),
    () => setSeries(plotOf().series.length ? plotOf().series.slice(1) : [newSeries()]),
    () => {
      const s = plotOf().series
      if (!s.length) return
      const k = r.int(s.length)
      const ds = datasetById(s[k]!.datasetId)
      const cur = s[k]!
      let next = r.pick<Partial<XYSeriesSpec>>([
        { x: axisColumn(ds).id },
        { y: axisColumn(ds).id },
        { visible: !cur.visible },
        { style: { ...cur.style, markerSize: 3 + r.int(10), open: r.bool() } },
        { errorBars: { ...cur.errorBars, visible: !cur.errorBars.visible } },
        { errorBars: { ...cur.errorBars, y: yUncertainty(ds, cur.y) } },
        { errorBars: { ...cur.errorBars, x: measurement(ds, cur.x) } },
      ])
      // As the store does (setSeriesMapping): a new column on an axis resets that axis' uncertainty,
      // which referred to the old variable.
      if (next.x !== undefined && next.x !== cur.x)
        next = { ...next, errorBars: { ...cur.errorBars, x: { kind: 'none' } } }
      if (next.y !== undefined && next.y !== cur.y)
        next = { ...next, errorBars: { ...cur.errorBars, y: { kind: 'none' } } }
      setPlot({ series: s.map((v, i) => (i === k ? { ...v, ...next } : v)) })
    },
    () => setPlot({ scatter: { residualPanel: r.bool(), showExcluded: r.bool() } }),
    () => setPlot({ line: { markers: r.bool(), sortByX: r.bool() } }),
    () => {
      const ds = anyDataset()
      const common = {
        datasetId: ds.id,
        category: anyColumn(ds).id,
        value: anyColumn(ds).id,
        showObservations: r.bool(),
        colorByCategory: false,
      }
      setPlot({
        bar: r.bool()
          ? {
              ...common,
              aggregate: 'mean',
              spread: r.pick([
                { kind: 'none' },
                { kind: 'sd' },
                { kind: 'sem' },
                { kind: 'ci', level: conf(), method: 't' },
              ] as const),
            }
          : { ...common, aggregate: 'none', uncertainty: measurement(ds, common.value) },
      })
    },
    () => {
      const ds = anyDataset()
      setPlot({
        histogram: {
          datasetId: ds.id,
          value: anyColumn(ds).id,
          bins: r.pick([
            { mode: 'auto' },
            { mode: 'count', count: 1 + r.int(40) },
            { mode: 'width', width: r.pick([1e-9, 0.01, 0.5, 7, 1e6]), start: r.pick([null, -3, 0, 1.5]) },
          ] as const),
          groupBy: null,
          groupMode: 'overlay',
        },
      })
    },
    () => {
      const ds = anyDataset()
      setPlot({
        box: {
          datasetId: ds.id,
          value: anyColumn(ds).id,
          groupBy: r.bool(0.3) ? null : anyColumn(ds).id,
          points: r.pick(['all', 'outliers', 'none'] as const),
          showMean: r.bool(),
          colorByGroup: false,
        },
      })
    },
    addFit,
    editFit,
    () => {
      doc = { ...doc, fits: doc.fits.slice(1) }
    },
    () => {
      const ds = anyDataset()
      const ids = rowIdsOf(ds).filter(() => r.bool(0.15))
      if (!ids.length) return
      doc = {
        ...doc,
        exclusions: [
          ...doc.exclusions,
          {
            id: fresh('exc') as ExclusionId,
            datasetId: ds.id,
            rowIds: ids,
            reason: r.pick(['outlier-candidate', 'measurement-problem', 'out-of-scope', 'other'] as const),
            note: 'fuzz',
            createdAt: T0,
          },
        ].slice(-4),
      }
    },
    () => {
      doc = { ...doc, exclusions: doc.exclusions.slice(1) }
    },
    () => {
      const ds = anyDataset()
      const base = {
        id: fresh('flt') as FilterId,
        datasetId: ds.id,
        enabled: r.bool(0.8),
        column: anyColumn(ds).id,
      }
      const f: Filter = r.bool()
        ? { ...base, type: 'range', min: r.pick([null, -1, 0.5, 2]), max: r.pick([null, 1, 3, 100]) }
        : { ...base, type: 'category', keep: r.pick([[], ['A'], ['B', 'A'], ['1']]) }
      doc = { ...doc, filters: [...doc.filters, f].slice(-3) }
    },
    () => {
      if (!doc.filters.length) return
      const k = r.int(doc.filters.length)
      doc = { ...doc, filters: doc.filters.map((f, i) => (i === k ? { ...f, enabled: !f.enabled } : f)) }
    },
    () => {
      // Parse override or a metadata edit on one column (immer path copy: dataset → columns → column).
      const di = r.int(doc.datasets.length)
      const ds = doc.datasets[di]!
      const ci = r.int(ds.columns.length)
      const c = ds.columns[ci]!
      const next: ColumnMeta = r.pick<ColumnMeta>([
        { ...c, override: { ...c.override, decimal: r.pick(['dot', 'comma', 'mixed'] as const) } },
        {
          ...c,
          override: {
            ...c.override,
            kind: r.pick(['numeric', 'categorical', 'text', 'datetime'] as const),
          },
        },
        { ...c, override: { ...c.override, percent: r.pick(['display', 'fraction'] as const) } },
        { ...c, override: {} },
        { ...c, name: `${c.name}′` },
        { ...c, unit: r.pick([null, 'm', 'V', 'mg/L']), unitSource: 'user' },
        { ...c, role: r.pick(['measurement', 'uncertainty', 'group', 'identifier', 'ignore'] as const) },
      ])
      const columns = ds.columns.map((v, i) => (i === ci ? next : v))
      doc = { ...doc, datasets: doc.datasets.map((v, i) => (i === di ? { ...ds, columns } : v)) }
    },
    () => {
      // A derived column (the UI checks wouldCreateCycle first).
      const di = r.int(doc.datasets.length)
      const ds = doc.datasets[di]!
      const a = anyColumn(ds).id
      const b = anyColumn(ds).id
      const spec: TransformSpec = r.pick<TransformSpec>([
        { op: r.pick(['ln', 'log10', 'sqrt', 'reciprocal', 'square'] as const), input: a },
        { op: 'affine', input: a, a: r.pick([-2, 0.5, 1e3]), b: r.pick([0, 1, -273.15]) },
        { op: r.pick(['difference', 'ratio', 'product'] as const), left: a, right: b },
      ])
      const id = fresh('col') as ColumnId
      if (wouldCreateCycle(ds, id, spec)) return
      const meta = numericMeta(id, `d${uid}`, { type: 'derived', spec }, null)
      doc = {
        ...doc,
        datasets: doc.datasets.map((v, i) => (i === di ? { ...ds, columns: [...ds.columns, meta] } : v)),
      }
    },
    () => {
      // Removal of a derived column or of a series, with the cascade the store applies.
      const draft = structuredClone(doc)
      const ds = r.pick(draft.datasets)
      const derived = ds.columns.filter((c) => c.source.type === 'derived')
      if (derived.length && r.bool())
        cascadeRemoval(draft, { kind: 'column', datasetId: ds.id, id: r.pick(derived).id })
      else if (draft.plots[0]!.series.length)
        cascadeRemoval(draft, { kind: 'series', id: r.pick(draft.plots[0]!.series).id })
      else return
      doc = draft
    },
    () => {
      doc = { ...doc, numberFormat: { decimal: r.pick(['auto', 'dot', 'comma'] as const) } }
    },
  ]

  // Fits are the costliest path to get wrong: give adding / editing one more weight.
  edits.push(addFit, addFit, editFit)

  const shared = createDeriver()
  const failures: string[] = []
  let fitsOk = 0
  let fitsError = 0
  for (let step = 0; step < steps; step++) {
    r.pick(edits)()
    const valid = ProjectDocSchema.safeParse(doc)
    if (!valid.success) {
      failures.push(`step ${step}: generator produced an invalid doc: ${valid.error.issues[0]?.message}`)
      break
    }
    const dangling = checkRefs(doc)
    if (dangling.length) {
      failures.push(`step ${step}: dangling refs ${JSON.stringify(dangling[0])}`)
      break
    }
    const selDs = r.pick(doc.datasets)
    const selection: Selection | null = r.bool(0.3)
      ? {
          datasetId: selDs.id,
          rowIds: new Set(rowIdsOf(selDs).filter(() => r.bool(0.3))),
          origin: r.pick(['plot', 'table'] as const),
          anchor: null,
        }
      : null
    const ctxs = [
      screen({ selection, loc: { decimal: r.pick(['.', ','] as const) } }),
      exporting({ selection: null, lang: 'it', loc: { decimal: ',' } }),
    ]
    try {
      const a = shared(doc, rawTables)
      const b = createDeriver()(doc, rawTables)
      const snap = snapshot(a)
      expect(snap).toEqual(snapshot(b))
      for (const ctx of ctxs) {
        const fig = buildFigure(a, ctx)
        expect(fig).toEqual(buildFigure(b, ctx))
        visit(fig.issues)
      }
      expect(a.issues.some((i) => i.code === 'E_INTERNAL_GUARD')).toBe(false)
      visit(a.issues)
      for (const list of a.datasetIssues.values()) visit(list)
      for (const [, , summary] of snap.summaries as [unknown, unknown, ColumnSummary | null][])
        if (summary) visit(summary.warnings)
      for (const s of a.allSeries) {
        visit(s.issues)
        if (s.fit?.status === 'ok') {
          fitsOk++
          visit(s.fit.warnings)
          for (const p of s.fit.params) expect(Number.isFinite(p.value)).toBe(true)
        } else if (s.fit) {
          fitsError++
          visit([s.fit.error])
        }
      }
    } catch (e) {
      failures.push(`step ${step}: ${String(e).slice(0, 600)}`)
      break
    }
  }
  return { failures, fitsOk, fitsError }
}

describe('deriver + figure: memoised results always equal a fresh computation', () => {
  it('500 random edits (plot type, axes, columns, uncertainties, fits, exclusions, filters, parse overrides, derived columns, removals)', () => {
    const { failures, fitsOk, fitsError } = runEditFuzz(FUZZ_SEED, FUZZ_STEPS)
    expect(failures).toEqual([])
    // The edits really exercised the fit paths, both successful and refused.
    expect(fitsOk).toBeGreaterThan(20)
    expect(fitsError).toBeGreaterThan(5)
  }, 60_000)
})

// ── 5. issue parameters ↔ message placeholders ──────────────────────────────────────────────────

/** Every issue a project produces: derivation, fits, summaries of every column and both figure modes. */
function projectIssues(doc: ProjectDoc, rawTables: Record<string, RawTable>): Issue[] {
  const out: Issue[] = []
  const d = createDeriver()(doc, rawTables)
  out.push(...d.issues)
  for (const list of d.datasetIssues.values()) out.push(...list)
  for (const s of d.allSeries) {
    out.push(...s.issues)
    if (s.fit?.status === 'ok') out.push(...s.fit.warnings)
    else if (s.fit) out.push(s.fit.error)
  }
  for (const ds of doc.datasets)
    for (const c of ds.columns) out.push(...(d.columnSummary(ds.id, c.id)?.warnings ?? []))
  for (const ctx of [screen(), exporting()]) out.push(...buildFigure(d, ctx).issues)
  return out
}

interface Scenario {
  /** Column indexes of x and y (default 0 and 1). */
  x?: number
  y?: number
  fit?: FitModel
  extend?: [number, number]
  /** Uncertainty specs, given the column ids of the dataset (derived columns appended last). */
  yBars?: (cols: ColumnId[]) => UncertaintySpec
  xBars?: (cols: ColumnId[]) => XUncertaintySpec
  derived?: (cols: ColumnId[]) => TransformSpec[]
  plot?: (plot: PlotSpec, cols: ColumnId[]) => PlotSpec
}

/** Issues of a one-dataset project built from CSV text, with one series, its fit and plot options. */
function scenarioIssues(csv: string, s: Scenario = {}): Issue[] {
  const d = draftOf(importText(csv, { kind: 'csv', fileName: 'scenario.csv' }))
  const dataset = datasetOf(d, 'ds_s')
  const base = dataset.columns.map((c) => c.id)
  const derived = (s.derived?.(base) ?? []).map((spec, k) =>
    numericMeta(`col_d${k}`, `d${k}`, { type: 'derived', spec }, null),
  )
  dataset.columns = [...dataset.columns, ...derived]
  const cols = dataset.columns.map((c) => c.id)
  let plot: PlotSpec = {
    ...initialPlot(dataset, buildDatasetView(dataset, d.rawTable), 'plot_1' as PlotId, 'ser_1' as SeriesId)
      .plot,
    type: 'scatter',
  }
  plot.series = [
    {
      id: 'ser_1' as SeriesId,
      datasetId: dataset.id,
      name: null,
      x: cols[s.x ?? 0]!,
      y: cols[s.y ?? 1]!,
      visible: true,
      style: { ...DEFAULT_SERIES_STYLE },
      errorBars: {
        x: s.xBars?.(cols) ?? { kind: 'none' },
        y: s.yBars?.(cols) ?? { kind: 'none' },
        visible: true,
      },
      split: null,
    },
  ]
  if (s.plot) plot = s.plot(plot, cols)
  const fits = s.fit ? [linearFit('fit_1', 'ser_1', s.fit)] : []
  if (s.extend) fits[0]!.curveRange = { mode: 'extend', min: s.extend[0], max: s.extend[1] }
  return projectIssues(docOf([dataset], plot, fits), { [d.rawTable.id]: d.rawTable })
}

/** A measurement-uncertainty spec (standard, user-given) from a source chosen by column ids. */
const measuredBy =
  (source: (cols: ColumnId[]) => MeasurementSource) =>
  (cols: ColumnId[]): XUncertaintySpec => ({
    kind: 'measurement',
    origin: 'user',
    meaning: { type: 'standard' },
    source: source(cols),
  })

/**
 * Every {placeholder} of an issue's title and hint (both languages) must be supplied by the domain in
 * Issue.params, except {rows}, which the UI fills from Issue.rows, and {axis} ('row' unless the domain or
 * the row labeler says 'column'), both filled by formatIssueParams in src/i18n. A
 * missing parameter would show a raw "{count}" to the user. Checked on the issues the domain really
 * emits: every import fixture, every project fixture and a run of the stateful edit fuzz.
 */
describe('issue params cover the placeholders of their messages (en, it)', () => {
  it('for every issue emitted by imports, project loading, derivation, fits and figures', () => {
    const seen: Issue[] = []
    const visit = (list: readonly Issue[]) => {
      for (const i of list) seen.push(i)
    }
    const fromResult = (r: Result<unknown>) => {
      visit(r.warnings)
      if (!r.ok) visit([r.error])
    }
    for (const f of readdirSync(resolve('tests/fixtures/import'))) {
      const r = importBytes(fixtureBytes(f), f, {}, { xlsx: XLSX })
      fromResult(r)
      if (r.ok) {
        visit(r.value.issues)
        visit(r.value.rawTable.tokenIssues)
        for (const c of r.value.columns) visit(c.detected.explanations)
      }
    }
    for (const f of readdirSync(resolve('tests/fixtures/projects')))
      fromResult(deserializeProject(readFileSync(resolve('tests/fixtures/projects', f), 'utf8')))
    fromResult(importText('', { kind: 'clipboard', fileName: null }))
    fromResult(importText('a;b\n', { kind: 'clipboard', fileName: null }))
    fromResult(importBytes(enc('{"format":"sciplot"}'), 'p.sciplot'))
    expect(runEditFuzz(FUZZ_SEED + 1, 300, visit).failures).toEqual([])

    // Targeted inputs for the codes random edits do not reach. Import level:
    visit([checkFileSize(30 * 2 ** 20, 'text').error!, checkFileSize(6 * 2 ** 20, 'text').warning!])
    fromResult(tokenize('a,b\n1,2\n', ',', { maxCells: 3 }))
    const notAZip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    fromResult(importBytes(notAZip, 'broken.xlsx', {}, { xlsx: XLSX }))
    fromResult(importBytes(fixtureBytes('excel-saved.xlsx'), 'x.xlsx', { sheetName: 'Nope' }, { xlsx: XLSX }))
    // Sheet blocks: transposed blocks stacked with a label, and stacked without one.
    for (const labels of [undefined, []]) {
      const r = importRegions(
        fixtureBytes('micro-tables.xlsx'),
        'micro-tables.xlsx',
        {
          sheetName: 'Transposed',
          mode: 'stack',
          regions: ['B2:F6', 'B8:F12'].map((range) => ({ range, orientation: 'rows' as const })),
          labels,
        },
        {},
        { xlsx: XLSX },
      )
      fromResult(r)
      if (r.ok) for (const d of r.value) visit(d.issues)
    }
    const texts: [string, 'csv' | 'clipboard'][] = [
      ['Rossi, Mario;12;3\nBianchi, Anna;14;5\nVerdi, Luca;11;2\nNeri, Ugo;15;4\n', 'csv'],
      ['a;b;\n1;2;\n3;4;\n', 'csv'],
      ['name,city\nAnna,Rome\nLuca,Milan\nEva,Turin\n', 'csv'],
      ['x;y\n1;1,234.5\n2;2.345,6\n3;3.456,7\n4;4.567,8\n', 'csv'],
      ['x,y\n1,2 mV\n2,3 mV\n3,4 mV\n4,5 mV\n5,6 V\n', 'csv'],
      ['x,y\n1,NA\n2,NA\n3,NA\n', 'csv'],
      ['x\ty\n1\t2\n3\t4\n', 'clipboard'],
      ['x,x\n1,2\n3,4\n', 'csv'],
      ['x,y\n1,2\n2,n/r\n3,4\n4,5\n5,6\n', 'csv'],
    ]
    for (const [text, kind] of texts) {
      const r = importText(text, { kind, fileName: null })
      fromResult(r)
      if (r.ok) {
        visit(r.value.issues)
        for (const c of r.value.columns) visit(c.detected.explanations)
      }
    }
    // Fits.
    const line = 'x,y\n1,2.1\n2,3.9\n3,6.2\n4,7.8\n5,10.1\n6,12.2\n'
    const clustered =
      'x,y\n' +
      Array.from({ length: 30 }, (_, i) => {
        const x = i < 27 ? 1 + i * 1e-3 : 10 + i
        return `${x},${Math.sin(x)}`
      }).join('\n')
    visit(scenarioIssues('x,y\n1,2\n2,4\n', { fit: { type: 'polynomial', degree: 2 } }))
    visit(scenarioIssues('x,y\n1,2\n1,3\n1,4\n2,5\n2,6\n2,7\n', { fit: { type: 'polynomial', degree: 3 } }))
    visit(scenarioIssues('x,y\n1,2\n1.00000000000001,3\n1.00000000000002,4\n', { fit: { type: 'linear' } }))
    visit(scenarioIssues('x,y\n1,5\n2,5\n3,5\n4,5\n', { fit: { type: 'linear' } }))
    visit(scenarioIssues('x,y\n2,1\n2,3\n2,5\n', { fit: { type: 'linear' } }))
    visit(scenarioIssues('x,y\n1,0\n2,3\n3,4\n', { derived: (c) => [{ op: 'ln', input: c[1]! }] }))
    visit(scenarioIssues('x,y\n1,-1\n2,3\n3,5\n', { fit: { type: 'power' } }))
    visit(scenarioIssues(exampleText('freeFall'), { fit: { type: 'polynomial', degree: 2 } }))
    // Calendar years: a rounded quadratic far from the origin needs the centred form (I_EQUATION_CENTRED);
    // a doubling per year makes a = exp(ln a) ≈ e^-1385 unrepresentable (E_OVERFLOW).
    const years = Array.from({ length: 31 }, (_, i) => 1990 + i)
    visit(
      scenarioIssues(
        'year,v\n' + years.map((x, i) => `${x},${100 + 3 * i - 0.05 * i * i + (i % 3) * 0.4}`).join('\n'),
        {
          fit: { type: 'polynomial', degree: 2 },
        },
      ),
    )
    visit(
      scenarioIssues('year,n\n2001,10\n2002,20.5\n2003,39\n2004,81\n2005,160\n', {
        fit: { type: 'exponential' },
      }),
    )
    // Near-duplicate design (from polyQR.test): κ₁ above 1e6 → W_ILL_CONDITIONED.
    visit(
      scenarioIssues(
        'x,y\n0,1\n0,1.1\n0,0.9\n1,2\n1,2.1\n1,1.9\n1.00000001,2.05\n1.00000001,1.95\n1.00000001,2\n',
        {
          fit: { type: 'polynomial', degree: 2 },
        },
      ),
    )
    visit(scenarioIssues(line, { fit: { type: 'exponential' }, extend: [0, 1e6] }))
    visit(scenarioIssues(line, { fit: { type: 'linear' }, extend: [-10, 50] }))
    visit(scenarioIssues('x,y\n1,1.1\n2,3.9\n3,9.2\n4,15.8\n', { fit: { type: 'polynomial', degree: 2 } }))
    visit(scenarioIssues(clustered, { fit: { type: 'polynomial', degree: 10 } }))
    visit(scenarioIssues(clustered, { fit: { type: 'polynomial', degree: 7 } }))
    visit(scenarioIssues('x,y\n1,2\n2,4.1\nNA,5\n4,8.2\n5,9.9\n', { fit: { type: 'linear' } }))
    // Uncertainties, axes and plot types.
    const withU = 'x (m),y (V),u (mV),v (V)\n1,2,0.1,0.1\n2,4,-0.2,\n3,6,,0.1\n4,0,0.1,0.1\n5,10,0.1,0.1\n'
    visit(scenarioIssues(withU, { yBars: measuredBy((c) => ({ type: 'column', column: c[2]! })) }))
    visit(
      scenarioIssues(withU, {
        yBars: measuredBy((c) => ({ type: 'columnAsymmetric', plus: c[3]!, minus: c[2]! })),
      }),
    )
    visit(scenarioIssues(withU, { yBars: measuredBy(() => ({ type: 'percent', percent: 150 })) }))
    visit(scenarioIssues(withU, { xBars: measuredBy(() => ({ type: 'absolute', value: -1 })) }))
    visit(
      scenarioIssues(withU, {
        derived: (c) => [{ op: 'square', input: c[3]! }],
        yBars: measuredBy((c) => ({ type: 'column', column: c[4]! })),
      }),
    )
    const logY = (p: PlotSpec): PlotSpec => ({ ...p, yAxis: { ...p.yAxis, scale: 'log' } })
    visit(scenarioIssues(withU, { yBars: measuredBy(() => ({ type: 'absolute', value: 5 })), plot: logY }))
    visit(
      scenarioIssues(withU, {
        plot: (p) => ({
          ...logY(p),
          yAxis: { ...logY(p).yAxis, range: { mode: 'fixed', min: 0, max: 10 } },
          xAxis: { ...p.xAxis, range: { mode: 'fixed', min: 5, max: 1 } },
        }),
      }),
    )
    const beer = exampleText('beerLambert')
    visit(scenarioIssues(beer, { yBars: () => ({ kind: 'sem', grouping: { by: 'sameX' } }) }))
    const ci: UncertaintySpec = { kind: 'ci', grouping: { by: 'sameX' }, level: 0.95, method: 't' }
    visit(scenarioIssues('x,y\n1,2\n1,3\n2,4\n3,5\n3,6\n', { yBars: () => ci }))
    // Zero spread: identical readings in a group (and in the y column of the summaries).
    visit(
      scenarioIssues('x,y\n1,2.0\n1,2.0\n1,2.0\n', {
        yBars: () => ({ kind: 'sem', grouping: { by: 'sameX' } }),
      }),
    )
    // Grouping Beer–Lambert by replicate number mixes every concentration in each group.
    visit(scenarioIssues(beer, { yBars: (c) => ({ kind: 'sd', grouping: { by: 'column', column: c[2]! } }) }))
    // A log scale requested on a date axis.
    visit(
      scenarioIssues('date,v\n2020-01-01,1\n2020-01-02,2\n2020-01-03,3\n', {
        plot: (p) => ({ ...p, xAxis: { ...p.xAxis, scale: 'log' } }),
      }),
    )
    // Centred for the offset only: an exact line far from x = 0 (reason 'offset').
    visit(scenarioIssues('x,y\n1000,1\n1001,3\n1002,5\n1003,7\n', { fit: { type: 'linear' } }))
    // A malformed quoted field (kind 'malformed'), next to the unclosed one of the fixtures.
    fromResult(tokenize('a,b\n"x" y,1\n2,3\n', ',', { maxCells: 100 }))
    const ds = 'ds_s' as DatasetId
    const groups = 'g,v\nA,1\nA,2\nB,3\n'
    visit(
      scenarioIssues(groups, {
        plot: (p, c) => ({
          ...p,
          type: 'bar',
          bar: {
            datasetId: ds,
            category: c[0]!,
            value: c[1]!,
            showObservations: true,
            colorByCategory: false,
            aggregate: 'none',
            uncertainty: { kind: 'none' },
          },
        }),
      }),
    )
    visit(
      scenarioIssues(groups, {
        plot: (p, c) => ({
          ...logY(p),
          type: 'bar',
          bar: {
            ...p.bar,
            datasetId: ds,
            category: c[0]!,
            value: c[1]!,
            aggregate: 'mean',
            spread: { kind: 'sd' },
          },
        }),
      }),
    )
    visit(
      scenarioIssues(groups, {
        plot: (p, c) => ({
          ...p,
          type: 'box',
          box: {
            datasetId: ds,
            value: c[1]!,
            groupBy: c[0]!,
            points: 'all',
            showMean: true,
            colorByGroup: false,
          },
        }),
      }),
    )
    visit(
      scenarioIssues('g,v\nA,NA\nB,NA\n', {
        plot: (p, c) => ({
          ...p,
          type: 'histogram',
          histogram: {
            datasetId: ds,
            value: c[1]!,
            bins: { mode: 'auto' },
            groupBy: null,
            groupMode: 'overlay',
          },
        }),
      }),
    )
    visit(
      scenarioIssues(groups, {
        plot: (p) => ({
          ...p,
          type: 'histogram',
          histogram: {
            datasetId: null,
            value: null,
            bins: { mode: 'auto' },
            groupBy: null,
            groupMode: 'overlay',
          },
        }),
      }),
    )
    // Split series: a row without a group value, and a column with too many values.
    const splitBy = (k: number) => (p: PlotSpec, c: ColumnId[]) => ({
      ...p,
      series: p.series.map((x) => ({ ...x, split: { column: c[k]!, overrides: [] } })),
    })
    visit(
      scenarioIssues('x,y,g\n1,2,A\n2,3,A\n3,5,A\n1,2,B\n2,4,B\n3,7,B\n4,8,\n', {
        fit: { type: 'linear' },
        plot: splitBy(2),
      }),
    )
    visit(
      scenarioIssues('x,y,g\n' + Array.from({ length: 60 }, (_, i) => `${i},${2 * i},${i}`).join('\n'), {
        plot: splitBy(2),
      }),
    )
    visit(
      scenarioIssues('v,g\n1,A\n2,A\n3,B\n4,\n', {
        plot: (p, c) => ({
          ...p,
          type: 'histogram',
          histogram: {
            datasetId: ds,
            value: c[0]!,
            bins: { mode: 'auto' },
            groupBy: c[1]!,
            groupMode: 'stack',
          },
        }),
      }),
    )
    visit(scenarioIssues('x,y\n1,2\n2,3\n3,NA\n'))
    visit(scenarioIssues('x,y\n1,2\n'))
    visit(scenarioIssues('x,y\n' + Array.from({ length: 5001 }, (_, i) => `${i},${i % 7}`).join('\n')))
    // Project files and integrity.
    fromResult(deserializeProject('{"format":"sciplot"}', { maxBytes: 5 }))
    fromResult(deserializeProject('{"format":"other"}'))
    fromResult(deserializeProject('{"format":"sciplot","schemaVersion":1}'))
    visit([checkReopenSize('x'.repeat(100), 10)!])
    visit(checkRefs({ ...docOf([], null), fits: [linearFit('fit_x', 'ser_missing')] }))

    const problems = new Set<string>()
    const codes = new Set<string>()
    for (const i of seen) {
      codes.add(i.code)
      for (const [lang, dict] of [
        ['en', issuesEn],
        ['it', issuesIt],
      ] as const) {
        const msg = dict[i.code]
        // {name}, plural {count|one|other} and select {kind|a=…|b=…} forms (also nested in an option),
        // in every branch: each one reads its parameter.
        for (const m of `${msg.title} ${msg.hint}`.matchAll(/\{(\w+)/g)) {
          const key = m[1]!
          const supplied = i.params !== undefined && key in i.params
          if (!supplied && !(key === 'rows' && i.rows?.length) && key !== 'axis')
            problems.add(
              `${i.code} (${lang}): {${key}} not supplied; params ${JSON.stringify(i.params ?? {})}`,
            )
        }
        // As the user reads it: nothing left unfilled (e.g. a select value without its option).
        const t = makeTranslator(lang)
        const shown = `${issueTitle(t, i)} ${issueHint(t, i)}`
        // Braces typed by the user (a series named "%{x}") are text, not a form left unfilled.
        let bare = shown
        for (const v of Object.values(i.params ?? {}))
          if (typeof v === 'string') bare = bare.split(v).join('')
        if (/[{}]/.test(bare)) problems.add(`${i.code} (${lang}) renders as "${shown}"`)
      }
    }
    expect([...problems].sort()).toEqual([])
    // Both reasons of the centred equation and both kinds of quote error are among them.
    const paramsOf = (code: string, key: string) =>
      new Set(seen.filter((i) => i.code === code).map((i) => i.params?.[key]))
    expect(paramsOf('I_EQUATION_CENTRED', 'reason')).toEqual(new Set(['rounding', 'offset']))
    expect(paramsOf('E_QUOTES_UNCLOSED', 'kind')).toEqual(new Set(['unclosed', 'malformed']))
    expect(paramsOf('I_ZERO_SPREAD', 'scope')).toEqual(new Set(['column', 'groups']))
    // The corpus reaches EVERY code the domain emits as an Issue; the rest are emitted by the UI
    // (storage, clipboard, worker, form validation, rendering, export) or, for E_NOT_A_NUMBER, used
    // by the domain only as a per-row code in ParseReport.invalidExamples.
    expect(ALL_REASON_CODES.filter((c) => !codes.has(c)).sort()).toEqual(
      [...UI_EMITTED_CODES, ...RETIRED_CODES].sort(),
    )
  }, 60_000)
})

/** No longer emitted (.xls workbooks are now read like the others); still declared, as the project schema lists every code. */
const RETIRED_CODES = ['E_XLS_LEGACY'] as const

const UI_EMITTED_CODES = [
  'W_WORKER_FALLBACK',
  'E_CLIPBOARD_DENIED',
  'E_CLIPBOARD_EMPTY',
  'E_NOT_A_NUMBER',
  'E_DUPLICATE_COLUMN_NAME',
  'E_EMPTY_NAME',
  'E_EXCLUSION_NOTE_REQUIRED',
  'I_SELECTION_ONE_DATASET',
  'E_PLOT_RENDER',
  'E_STORAGE_UNAVAILABLE',
  'E_STORAGE_QUOTA',
  'W_STORAGE_RETRY',
  'I_PROJECT_READ_ONLY',
  'E_EXPORT_FAILED',
] as const
