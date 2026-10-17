import { describe, it, expect } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  DEFAULT_AXIS,
  DEFAULT_EXPORT,
  DEFAULT_SERIES_STYLE,
  NATIVE,
  issue,
  type ColumnId,
  type ColumnMeta,
  type ColumnSource,
  type DatasetId,
  type ExclusionId,
  type FilterId,
  type FitId,
  type OperationLogEntry,
  type PlotId,
  type PlotSpec,
  type ProjectDoc,
  type ProjectId,
  type RawSource,
  type RawTable,
  type RawTableId,
  type RowId,
  type SeriesId,
  type WorkspaceState,
} from '@/domain/model'
import { checkReopenSize, rawTableToJSON, serializeProject, utf8ByteLength } from './serialize'
import { deserializeProject } from './deserialize'
import { migrateProjectJSON } from './migrate'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- free-form edits of parsed project JSON
type Json = any

// ── reference project: the source of tests/fixtures/projects/{v1-ok,broken-refs,proto-pollution} ──
// ── (as version 1 files) and, extended to two plots, of v2-multiplot ────────────────────────────

const ID = {
  prj: 'prj_5e1c7a9b1' as ProjectId,
  rawOhm: 'raw_8d02f4c13' as RawTableId,
  rawPend: 'raw_c41e9b7a4' as RawTableId,
  dsOhm: 'ds_2a9f6c015' as DatasetId,
  dsPend: 'ds_7b3d1e826' as DatasetId,
  dsSpring: 'ds_e05a4c917' as DatasetId,
  colI: 'col_1f3a5c7e8' as ColumnId,
  colV: 'col_2b4d6f809' as ColumnId,
  colUV: 'col_3c5e7a91a' as ColumnId,
  colP: 'col_4d6f8b02b' as ColumnId,
  colTrial: 'col_5e7a9c13c' as ColumnId,
  colObs: 'col_6f8bad24d' as ColumnId,
  colT: 'col_7a9cbe35e' as ColumnId,
  colM: 'col_8bad0f46f' as ColumnId,
  colX: 'col_9cbe1a57g' as ColumnId,
  plot: 'plt_0e4b8f2d1h' as PlotId,
  serOhm: 'ser_1a2b3c4di' as SeriesId,
  serPow: 'ser_5e6f7a8bj' as SeriesId,
  fitOhm: 'fit_6c7d8e9fk' as FitId,
  fitPow: 'fit_0a1b2c3dl' as FitId,
  excOhm: 'exc_4e5f6a7bm' as ExclusionId,
  excSpring: 'exc_8c9d0e1fn' as ExclusionId,
  fltRange: 'flt_2a3b4c5do' as FilterId,
  fltObs: 'flt_6e7f8a9bp' as FilterId,
  plotPend: 'plt_7c1d9e3a2q' as PlotId,
  serPend: 'ser_3b8e1f6cr' as SeriesId,
  fitPend: 'fit_9d2a4c7es' as FitId,
} as const

const rows = (...ids: number[]) => ids.map((r) => r as RowId)

function column(
  id: ColumnId,
  source: ColumnSource,
  name: string,
  unit: string | null,
  extra: Partial<ColumnMeta> = {},
) {
  const c: ColumnMeta = {
    id,
    source,
    name,
    unit,
    unitSource: unit ? 'header' : null,
    role: 'measurement',
    uncertaintyOf: null,
    detected: { kind: 'numeric', decimal: 'dot', percent: 'display', confidence: 'high', explanations: [] },
    override: {},
    ...extra,
  }
  return c
}

/** Grid rows → positional raw columns (as the tokenizer / spreadsheet reader produce them). */
function rawTable(
  id: RawTableId,
  source: RawSource,
  grid: string[][],
  sourceRow: number[],
  native: { kind: number[]; num: number[] }[] | null,
  tokenIssues: RawTable['tokenIssues'],
): RawTable {
  const width = grid[0].length
  return {
    id,
    source,
    rowCount: grid.length,
    sourceRow: Int32Array.from(sourceRow),
    columns: Array.from({ length: width }, (_, j) => ({
      text: grid.map((r) => r[j]),
      native: native
        ? { kind: Uint8Array.from(native[j].kind), num: Float64Array.from(native[j].num) }
        : null,
    })),
    tokenIssues,
  }
}

function referenceRawTables(): Record<string, RawTable> {
  const ohmGrid = [
    ["# Ohm's law — resistor R1 (47 Ω nominal), 2026-10-02", '', ''],
    ['I (A)', 'V (V)', 'u(V) (V)'],
    ['0.010', '0.464', '0.004'],
    ['0.020', '0.941', '0.004'],
    ['0.030', '1.402', '0.005'],
    ['0.040', '1.882', '0.005'],
    ['0.050', '2.339', 'NA'],
    ['0.060', '2.808', '0.006'],
    ['', '', ''],
    ['0.070', '3.294', '0.006'],
    ['0.080', '3.764', '0.007'],
    ['0.090', '4.241', '0.007'],
    ['0.100', '4.706', '0.008'],
  ]
  const ohm = rawTable(
    ID.rawOhm,
    {
      kind: 'csv',
      fileName: 'ohm-R1.csv',
      sheetName: null,
      encoding: 'utf-8',
      delimiter: ',',
      byteSize: 251,
      importedAt: '2026-10-02T09:14:05.120Z',
    },
    ohmGrid,
    ohmGrid.map((_, i) => i + 1),
    null,
    [issue('W_RAGGED_ROWS', { count: 2, row: 1 }, { rows: rows(0, 8) })],
  )

  // Spreadsheet with the table starting at A2: header on sheet row 2; one empty T cell (native NaN).
  const N = NaN
  const pendGrid = [
    ['trial', 'observer', 'T (s)'],
    ['1', 'A', '1.70'],
    ['2', 'A', '1.75'],
    ['3', 'A', ''],
    ['1', 'B', '1.66'],
    ['2', 'B', '1.98'],
    ['3', 'B', '1.79'],
  ]
  const { number: n, text: t, empty: e } = NATIVE
  const pend = rawTable(
    ID.rawPend,
    {
      kind: 'xlsx',
      fileName: 'pendulum.xlsx',
      sheetName: 'Timings',
      encoding: null,
      delimiter: null,
      byteSize: 9214,
      importedAt: '2026-10-02T09:31:47.002Z',
    },
    pendGrid,
    [2, 3, 4, 5, 6, 7, 8],
    [
      { kind: [t, n, n, n, n, n, n], num: [N, 1, 2, 3, 1, 2, 3] },
      { kind: [t, t, t, t, t, t, t], num: [N, N, N, N, N, N, N] },
      { kind: [t, n, n, e, n, n, n], num: [N, 1.7, 1.75, N, 1.66, 1.98, 1.79] },
    ],
    [issue('I_TRIMMED_EMPTY')],
  )
  return { [ohm.id]: ohm, [pend.id]: pend }
}

function referenceDoc(): ProjectDoc {
  const detectedText = (kind: 'categorical' | 'text') =>
    ({ kind, decimal: 'dot', percent: 'display', confidence: 'high', explanations: [] }) as const
  return {
    id: ID.prj,
    name: 'Lab session 3 — Ohm & pendulum',
    createdAt: '2026-10-02T09:13:40.512Z',
    updatedAt: '2026-10-02T10:02:11.904Z',
    datasets: [
      {
        id: ID.dsOhm,
        name: 'ohm-R1',
        createdAt: '2026-10-02T09:14:05.120Z',
        example: null,
        origin: 'import',
        rawTableId: ID.rawOhm,
        layout: { headerRow: 1, unitsRow: null, dataStartRow: 2, dataEndRow: 12 },
        notes: ["# Ohm's law — resistor R1 (47 Ω nominal), 2026-10-02"],
        columns: [
          column(ID.colI, { type: 'raw', index: 0 }, 'I', 'A'),
          column(ID.colV, { type: 'raw', index: 1 }, 'V', 'V'),
          column(ID.colUV, { type: 'raw', index: 2 }, 'u(V)', 'V', {
            role: 'uncertainty',
            uncertaintyOf: ID.colV,
            detected: {
              kind: 'numeric',
              decimal: 'dot',
              percent: 'display',
              confidence: 'high',
              explanations: [
                issue('I_MISSING_VALUES', { count: 1, tokens: 'NA' }, { rows: rows(6), columnId: ID.colUV }),
              ],
            },
          }),
          column(
            ID.colP,
            { type: 'derived', spec: { op: 'product', left: ID.colI, right: ID.colV } },
            'P',
            'W',
            {
              unitSource: 'user',
            },
          ),
        ],
      },
      {
        id: ID.dsPend,
        name: 'pendulum · Timings',
        createdAt: '2026-10-02T09:31:47.002Z',
        example: null,
        origin: 'import',
        rawTableId: ID.rawPend,
        layout: { headerRow: 0, unitsRow: null, dataStartRow: 1, dataEndRow: 6 },
        notes: [],
        columns: [
          column(ID.colTrial, { type: 'raw', index: 0 }, 'trial', null, { role: 'identifier' }),
          column(ID.colObs, { type: 'raw', index: 1 }, 'observer', null, {
            role: 'group',
            detected: detectedText('categorical'),
          }),
          column(ID.colT, { type: 'raw', index: 2 }, 'T', 's', {
            detected: {
              kind: 'numeric',
              decimal: 'dot',
              percent: 'display',
              confidence: 'high',
              explanations: [issue('I_MISSING_VALUES', { count: 1, tokens: '(empty)' }, { rows: rows(3) })],
            },
          }),
        ],
      },
      {
        id: ID.dsSpring,
        name: 'Spring extension (typed)',
        createdAt: '2026-10-02T09:50:12.733Z',
        example: null,
        origin: 'notebook',
        notes: [],
        columns: [
          column(ID.colM, { type: 'notebook' }, 'm', 'kg', {
            unitSource: 'user',
            override: { kind: 'numeric', decimal: 'dot' },
          }),
          column(ID.colX, { type: 'notebook' }, 'x', 'cm', {
            unitSource: 'user',
            override: { kind: 'numeric', decimal: 'dot' },
          }),
        ],
        rowIds: rows(0, 1, 3),
        cells: { [ID.colM]: ['0.050', '0.100', '0.200'], [ID.colX]: ['2.1', '4.0', '8.3'] },
        nextRowId: 4,
      },
    ],
    plots: [
      {
        id: ID.plot,
        name: '',
        type: 'scatter',
        title: "Ohm's law — R1",
        xAxis: { ...DEFAULT_AXIS },
        yAxis: { ...DEFAULT_AXIS, label: 'Voltage', unit: 'V', range: { mode: 'fixed', min: 0, max: 5 } },
        legend: { visible: true, position: 'auto' },
        series: [
          {
            id: ID.serOhm,
            datasetId: ID.dsOhm,
            name: null,
            x: ID.colI,
            y: ID.colV,
            visible: true,
            style: { ...DEFAULT_SERIES_STYLE },
            errorBars: {
              x: {
                kind: 'measurement',
                origin: 'instrument',
                source: { type: 'absolute', value: 0.0005 },
                meaning: { type: 'expanded', k: 2 },
              },
              y: {
                kind: 'measurement',
                origin: 'user',
                source: { type: 'column', column: ID.colUV },
                meaning: { type: 'standard' },
              },
              visible: true,
            },
            split: null,
          },
          {
            id: ID.serPow,
            datasetId: ID.dsOhm,
            name: 'Dissipated power',
            x: ID.colI,
            y: ID.colP,
            visible: false,
            style: {
              ...DEFAULT_SERIES_STYLE,
              paletteIndex: 1,
              symbol: 'square',
              open: true,
              lineDash: 'dash',
            },
            errorBars: { x: { kind: 'none' }, y: { kind: 'none' }, visible: false },
            split: null,
          },
        ],
        scatter: { residualPanel: true, showExcluded: true },
        line: { markers: true, sortByX: true },
        bar: {
          aggregate: 'mean',
          datasetId: ID.dsPend,
          category: ID.colObs,
          value: ID.colT,
          showObservations: true,
          colorByCategory: false,
          spread: { kind: 'ci', level: 0.95, method: 't' },
        },
        histogram: {
          datasetId: ID.dsPend,
          value: ID.colT,
          bins: { mode: 'auto' },
          groupBy: null,
          groupMode: 'overlay',
        },
        box: {
          datasetId: ID.dsPend,
          value: ID.colT,
          groupBy: ID.colObs,
          points: 'outliers',
          showMean: true,
          colorByGroup: false,
        },
        export: { ...DEFAULT_EXPORT },
      },
    ],
    activePlotId: ID.plot,
    fits: [
      {
        id: ID.fitOhm,
        seriesId: ID.serOhm,
        model: { type: 'linear' },
        confidence: 0.95,
        show: { curve: true, confidenceBand: true, predictionBand: false, residuals: true },
        curveRange: { mode: 'data' },
        style: { color: { mode: 'series' }, dash: 'auto', width: 2 },
        perGroup: false,
      },
      {
        id: ID.fitPow,
        seriesId: ID.serPow,
        model: { type: 'polynomial', degree: 2 },
        confidence: 0.99,
        show: { curve: true, confidenceBand: false, predictionBand: false, residuals: false },
        curveRange: { mode: 'extend', min: 0, max: 0.12 },
        style: { color: { mode: 'series' }, dash: 'auto', width: 2 },
        perGroup: false,
      },
    ],
    exclusions: [
      {
        id: ID.excOhm,
        datasetId: ID.dsOhm,
        rowIds: rows(5),
        reason: 'measurement-problem',
        note: 'Probe contact lost during this reading',
        createdAt: '2026-10-02T09:40:02.311Z',
      },
      {
        id: ID.excSpring,
        datasetId: ID.dsSpring,
        rowIds: rows(3),
        reason: 'other',
        note: 'Spring slipped on the hook',
        createdAt: '2026-10-02T09:55:20.004Z',
      },
    ],
    filters: [
      {
        id: ID.fltRange,
        datasetId: ID.dsPend,
        enabled: false,
        type: 'range',
        column: ID.colT,
        min: 1.6,
        max: null,
      },
      {
        id: ID.fltObs,
        datasetId: ID.dsPend,
        enabled: true,
        type: 'category',
        column: ID.colObs,
        keep: ['A', 'B'],
      },
    ],
    numberFormat: { decimal: 'auto' },
  }
}

type LogArgs = [
  string,
  OperationLogEntry['op'],
  string,
  DatasetId | null,
  Record<string, string | number>?,
  PlotId?,
]

function referenceLog(extra: LogArgs[] = []): OperationLogEntry[] {
  const entry = (
    n: number,
    at: string,
    op: OperationLogEntry['op'],
    key: string,
    datasetId: DatasetId | null,
    params?: Record<string, string | number>,
    plotId: PlotId | null = null,
  ): OperationLogEntry => ({
    id: `op_${n}a7f3c${n}`,
    at,
    op,
    label: params ? { key, params } : { key },
    datasetId,
    plotId,
  })
  return [
    entry(1, '2026-10-02T09:14:05.120Z', 'dataset.import', 'ops.dataset.import', ID.dsOhm, {
      name: 'ohm-R1.csv',
    }),
    entry(2, '2026-10-02T09:15:30.441Z', 'plot.create', 'ops.plot.create', ID.dsOhm),
    entry(3, '2026-10-02T09:22:10.010Z', 'uncertainty.set', 'ops.uncertainty.set', ID.dsOhm, { axis: 'y' }),
    entry(4, '2026-10-02T09:24:58.700Z', 'fit.add', 'ops.fit.add', ID.dsOhm, { model: 'linear' }),
    entry(5, '2026-10-02T09:31:47.002Z', 'dataset.import', 'ops.dataset.import', ID.dsPend, {
      name: 'pendulum.xlsx',
    }),
    entry(6, '2026-10-02T09:40:02.311Z', 'exclusion.add', 'ops.exclusion.add', ID.dsOhm, { count: 1 }),
    entry(7, '2026-10-02T09:45:12.090Z', 'column.derive', 'ops.column.derive', ID.dsOhm, { op: 'product' }),
    entry(8, '2026-10-02T09:50:12.733Z', 'notebook.create', 'ops.notebook.create', ID.dsSpring),
    entry(9, '2026-10-02T09:58:40.512Z', 'filter.set', 'ops.filter.set', ID.dsPend),
    ...extra.map((e, i) => entry(10 + i, ...e)),
  ]
}

/**
 * The reference project with a second plot (schema 2 features): a series split by observer with an
 * override, a styled per-group fit, histogram / box / bar coloured by group, a named first plot, and
 * the provenance of a table cut out of a sheet.
 */
function multiplotDoc(): ProjectDoc {
  const doc = referenceDoc()
  doc.plots[0].name = 'Ohm R1'
  const pend: PlotSpec = {
    id: ID.plotPend,
    name: '',
    type: 'scatter',
    title: 'Pendulum period by trial',
    xAxis: { ...DEFAULT_AXIS },
    yAxis: { ...DEFAULT_AXIS, label: 'Period' },
    legend: { visible: true, position: 'top-right' },
    series: [
      {
        id: ID.serPend,
        datasetId: ID.dsPend,
        name: null,
        x: ID.colTrial,
        y: ID.colT,
        visible: true,
        style: { ...DEFAULT_SERIES_STYLE, paletteIndex: 2 },
        errorBars: { x: { kind: 'none' }, y: { kind: 'none' }, visible: true },
        split: { column: ID.colObs, overrides: [{ key: 'B', paletteIndex: 6, symbol: 'x' }] },
      },
    ],
    scatter: { residualPanel: false, showExcluded: true },
    line: { markers: true, sortByX: false },
    bar: {
      aggregate: 'none',
      datasetId: ID.dsPend,
      category: ID.colObs,
      value: ID.colT,
      showObservations: false,
      colorByCategory: true,
      uncertainty: { kind: 'none' },
    },
    histogram: {
      datasetId: ID.dsPend,
      value: ID.colT,
      bins: { mode: 'count', count: 4 },
      groupBy: ID.colObs,
      groupMode: 'stack',
    },
    box: {
      datasetId: ID.dsPend,
      value: ID.colT,
      groupBy: ID.colObs,
      points: 'all',
      showMean: false,
      colorByGroup: true,
    },
    export: { ...DEFAULT_EXPORT },
  }
  doc.plots.push(pend)
  doc.activePlotId = ID.plotPend
  doc.fits.push({
    id: ID.fitPend,
    seriesId: ID.serPend,
    model: { type: 'linear' },
    confidence: 0.95,
    show: { curve: true, confidenceBand: false, predictionBand: false, residuals: false },
    curveRange: { mode: 'data' },
    style: { color: { mode: 'palette', index: 6 }, dash: 'dot', width: 3 },
    perGroup: true,
  })
  return doc
}

function multiplotLog(): OperationLogEntry[] {
  return referenceLog([
    ['2026-10-02T10:00:01.000Z', 'plot.create', 'ops.plot.create', ID.dsPend, undefined, ID.plotPend],
    ['2026-10-02T10:00:20.000Z', 'series.split', 'ops.series.split', ID.dsPend, { name: 'T' }, ID.plotPend],
    ['2026-10-02T10:01:02.000Z', 'fit.add', 'ops.fit.add', ID.dsPend, { model: 'linear' }, ID.plotPend],
    ['2026-10-02T10:01:40.000Z', 'plot.rename', 'ops.plot.rename', null, { name: 'Ohm R1' }, ID.plot],
  ])
}

/** The pendulum table as if cut out of its sheet (A2:C8): one block, read by columns. */
function multiplotRawTables(): Record<string, RawTable> {
  const raws = referenceRawTables()
  const pend = raws[ID.rawPend]
  const region = {
    orientation: 'columns',
    blocks: [{ range: 'A2:C8', label: null, firstRow: 0, rowCount: pend.rowCount }],
    labelColumns: [],
  } as const
  return { ...raws, [ID.rawPend]: { ...pend, source: { ...pend.source, region } } }
}

const WORKSPACE: WorkspaceState = { layout: 'columns', panes: [ID.plot, ID.plotPend], focused: 1 }

/** The version 1 form of a file of the reference project: every schema 2 field removed. */
function toV1(text: string): Json {
  const j = JSON.parse(text)
  j.schemaVersion = 1
  delete j.workspace
  for (const p of j.project.plots) {
    delete p.name
    delete p.bar.colorByCategory
    delete p.histogram.groupBy
    delete p.histogram.groupMode
    delete p.box.colorByGroup
    for (const s of p.series) delete s.split
  }
  for (const f of j.project.fits) {
    delete f.style
    delete f.perGroup
  }
  for (const e of j.operationLog) delete e.plotId
  for (const t of j.rawTables) delete t.source.region
  return j
}

const APP_VERSION = '0.1.0'
const SAVED_AT = '2026-10-02T10:02:30.000Z'

/** Every kind of broken reference the loader must repair (11 repairs, see deserialize.test.ts). */
function brokenDoc(): ProjectDoc {
  const doc = referenceDoc()
  const [ohm, , spring] = doc.datasets
  const plot = doc.plots[0]
  doc.fits[0].seriesId = 'ser_deleted01' as SeriesId // fit removed
  doc.exclusions[0].datasetId = 'ds_deleted01' as DatasetId // exclusion removed
  plot.series[0].errorBars.y = {
    kind: 'measurement',
    origin: 'user',
    source: { type: 'column', column: 'col_deleted01' as ColumnId },
    meaning: { type: 'standard' },
  } // → none
  plot.box.groupBy = 'col_deleted02' as ColumnId // → null
  doc.activePlotId = 'plt_deleted01' as PlotId // → the remaining plot
  ohm.columns[2].uncertaintyOf = 'col_deleted03' as ColumnId // → null
  doc.filters[1].column = 'col_deleted04' as ColumnId // filter removed
  if (spring.origin === 'notebook') spring.nextRowId = 2 // below row id 3 → 4
  const p = ohm.columns[3]
  if (p.source.type === 'derived' && p.source.spec.op === 'product')
    p.source.spec.right = 'col_deleted05' as ColumnId
  // → derived P removed → series on P removed → its fit removed
  return doc
}

const FIXTURES = resolve('tests/fixtures/projects')
const UPDATE = process.env.UPDATE_PROJECT_FIXTURES === '1'

/** In update mode writes the fixture; otherwise checks that the serializer still writes it byte for byte. */
function expectFixture(name: string, text: string) {
  const path = resolve(FIXTURES, name)
  if (UPDATE) {
    mkdirSync(FIXTURES, { recursive: true })
    writeFileSync(path, text, 'utf8')
  }
  expect(readFileSync(path, 'utf8')).toBe(text)
}

const readFixture = (name: string) => readFileSync(resolve(FIXTURES, name), 'utf8')

/** Inserts prototype-polluting keys at three depths of an otherwise valid project file. */
function pollute(text: string): string {
  const inject = (s: string, after: string, what: string) => {
    expect(s.includes(after)).toBe(true)
    return s.replace(after, after + what)
  }
  let out = inject(text, '{\n "format": "sciplot",', '\n "__proto__": { "polluted": "yes" },')
  out = inject(
    out,
    '\n "project": {',
    '\n  "constructor": { "prototype": { "polluted": "yes" } },\n  "__proto__": { "isAdmin": true },',
  )
  // "constructor" matches the id pattern: only the key sanitizer keeps it out of the cells record.
  out = inject(out, '"cells": {', '\n     "__proto__": ["polluted"],\n     "constructor": ["a", "b", "c"],')
  return out
}

describe('serializeProject', () => {
  const text = serializeProject(referenceDoc(), referenceRawTables(), referenceLog(), APP_VERSION, SAVED_AT)
  const json = JSON.parse(text)

  it('writes the v2 header and the project', () => {
    expect(json.format).toBe('sciplot')
    expect(json.schemaVersion).toBe(2)
    expect(json.appVersion).toBe(APP_VERSION)
    expect(json.savedAt).toBe(SAVED_AT)
    expect(json.project).toEqual(JSON.parse(JSON.stringify(referenceDoc())))
    expect(json.operationLog).toHaveLength(9)
    expect(Object.hasOwn(json, 'workspace')).toBe(false)
  })

  it('converts typed arrays to arrays and NaN to explicit null', () => {
    const pend = json.rawTables[1]
    expect(pend.sourceRow).toEqual([2, 3, 4, 5, 6, 7, 8])
    expect(pend.columns[2].native.kind).toEqual([5, 1, 1, 0, 1, 1, 1])
    expect(pend.columns[2].native.num).toEqual([null, 1.7, 1.75, null, 1.66, 1.98, 1.79])
    expect(pend.columns[1].native.num.every((v: unknown) => v === null)).toBe(true)
    expect(json.rawTables[0].columns[0].native).toBeNull()
    expect(rawTableToJSON(referenceRawTables()[ID.rawPend]).columns[0].native?.num[0]).toBeNull()
  })

  it('keeps sourceRow and the token issues of each raw table', () => {
    expect(json.rawTables[0].sourceRow).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])
    expect(json.rawTables[0].tokenIssues[0]).toMatchObject({ code: 'W_RAGGED_ROWS', rows: [0, 8] })
  })

  it('writes only the raw tables referenced by imported datasets, once each', () => {
    const raws = referenceRawTables()
    const unused: RawTable = { ...raws[ID.rawOhm], id: 'raw_unused01' as RawTableId }
    const doc = referenceDoc()
    const copy = structuredClone(doc.datasets[0])
    copy.id = 'ds_copy01' as DatasetId // second dataset on the same raw table
    doc.datasets.push(copy)
    const out = JSON.parse(serializeProject(doc, { ...raws, [unused.id]: unused }, [], APP_VERSION, SAVED_AT))
    expect(out.rawTables.map((t: { id: string }) => t.id)).toEqual([ID.rawOhm, ID.rawPend])
  })

  it('is pretty-printed with a one-space indent, primitive arrays on one line', () => {
    expect(text.startsWith('{\n "format": "sciplot",\n "schemaVersion": 2,')).toBe(true)
    expect(text).toContain('"sourceRow": [2,3,4,5,6,7,8]')
    expect(text).toContain('"num": [null,1.7,1.75,null,1.66,1.98,1.79]')
    expect(text.endsWith('}\n')).toBe(true)
  })

  it('uses the current time when savedAt is not given', () => {
    const before = Date.now()
    const out = JSON.parse(serializeProject(referenceDoc(), referenceRawTables(), [], APP_VERSION))
    expect(Date.parse(out.savedAt)).toBeGreaterThanOrEqual(before - 1)
  })

  it('round-trips through deserializeProject (deep equality, typed arrays, NaN, log)', () => {
    const res = deserializeProject(text)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.warnings).toEqual([])
    expect(res.value.repaired).toEqual([])
    expect(res.value.doc).toEqual(referenceDoc())
    expect(res.value.log).toEqual(referenceLog())
    expect(res.value.meta).toEqual({ appVersion: APP_VERSION, savedAt: SAVED_AT })
    const raws = referenceRawTables()
    expect(Object.keys(res.value.rawTables)).toEqual([ID.rawOhm, ID.rawPend])
    for (const id of [ID.rawOhm, ID.rawPend]) {
      const got = res.value.rawTables[id]
      expect(got).toEqual(raws[id])
      expect(got.sourceRow).toBeInstanceOf(Int32Array)
      expect(Array.from(got.sourceRow)).toEqual(Array.from(raws[id].sourceRow))
    }
    const T = res.value.rawTables[ID.rawPend].columns[2].native!
    expect(T.kind).toBeInstanceOf(Uint8Array)
    expect(T.num).toBeInstanceOf(Float64Array)
    expect(Number.isNaN(T.num[0])).toBe(true)
    expect(Number.isNaN(T.num[3])).toBe(true)
    expect(T.num[5]).toBe(1.98)
    // Saving the opened project again gives the same content (key order follows the schema).
    const again = serializeProject(res.value.doc, res.value.rawTables, res.value.log, APP_VERSION, SAVED_AT)
    expect(JSON.parse(again)).toEqual(JSON.parse(text))
  })

  it('writes the workspace next to the project, never inside it, and reads it back', () => {
    const doc = multiplotDoc()
    const out = serializeProject(doc, multiplotRawTables(), [], APP_VERSION, SAVED_AT, {
      workspace: WORKSPACE,
    })
    const j = JSON.parse(out)
    expect(j.workspace).toEqual(WORKSPACE)
    expect(Object.hasOwn(j.project, 'workspace')).toBe(false)
    expect(j.project).toEqual(JSON.parse(JSON.stringify(doc)))
    const back = deserializeProject(out)
    expect(back.ok && back.value.workspace).toEqual(WORKSPACE)
    expect(back.ok && back.value.doc).toEqual(doc)
    // No workspace (or null): no key at all, and null when read back.
    for (const opts of [{}, { workspace: null }]) {
      const none = serializeProject(doc, multiplotRawTables(), [], APP_VERSION, SAVED_AT, opts)
      expect(Object.hasOwn(JSON.parse(none), 'workspace')).toBe(false)
      const r = deserializeProject(none)
      expect(r.ok && r.value.workspace).toBeNull()
    }
  })

  it('round-trips every schema 2 field (split, fit style, per-group options, plot ids, sheet region)', () => {
    const out = serializeProject(
      multiplotDoc(),
      multiplotRawTables(),
      multiplotLog(),
      APP_VERSION,
      SAVED_AT,
      { workspace: WORKSPACE },
    )
    const r = deserializeProject(out)
    if (!r.ok) throw new Error(JSON.stringify(r.error))
    expect(r.warnings).toEqual([])
    expect(r.value.doc).toEqual(multiplotDoc())
    expect(r.value.log).toEqual(multiplotLog())
    expect(r.value.rawTables[ID.rawPend].source.region).toEqual(
      multiplotRawTables()[ID.rawPend].source.region,
    )
    expect(r.value.rawTables[ID.rawOhm].source).not.toHaveProperty('region')
  })

  it('produces the committed v2 fixture (UPDATE_PROJECT_FIXTURES=1 regenerates it)', () => {
    expectFixture(
      'v2-multiplot.sciplot',
      serializeProject(multiplotDoc(), multiplotRawTables(), multiplotLog(), APP_VERSION, SAVED_AT, {
        workspace: WORKSPACE,
      }),
    )
  })

  // The v1 fixtures are frozen on purpose: they are what the app wrote with schema 1, and they test the
  // migration.
  // They are never regenerated; these checks prove they still describe the reference project.
  it('the v1 fixtures are the reference project without the schema 2 fields', () => {
    expect(JSON.parse(readFixture('v1-ok.sciplot'))).toEqual(toV1(text))
    expect(JSON.parse(readFixture('broken-refs.sciplot'))).toEqual(
      toV1(serializeProject(brokenDoc(), referenceRawTables(), referenceLog(), APP_VERSION, SAVED_AT)),
    )
    expect(readFixture('proto-pollution.sciplot')).toBe(pollute(readFixture('v1-ok.sciplot')))
  })

  it('migrating the v1 form gives back exactly the reference project (defaults = old behaviour)', () => {
    expect(migrateProjectJSON(toV1(text))).toEqual({ json, from: 1 })
    const v2 = serializeProject(multiplotDoc(), multiplotRawTables(), multiplotLog(), APP_VERSION, SAVED_AT)
    // The schema 2 values of the second plot are not defaults: the v1 form loses them.
    expect(migrateProjectJSON(toV1(v2)).json).not.toEqual(JSON.parse(v2))
  })
})

describe('utf8ByteLength / checkReopenSize', () => {
  it('counts UTF-8 bytes exactly, like TextEncoder', () => {
    const samples = [
      '',
      'abc',
      'Ω',
      '€',
      'aΩ€😀',
      String.fromCharCode(0xd800),
      'x' + String.fromCharCode(0xdc00) + 'y',
      "Ohm's law — R1 (47 Ω)",
    ]
    for (const s of samples) expect(utf8ByteLength(s)).toBe(new TextEncoder().encode(s).length)
    expect(utf8ByteLength('aΩ€😀')).toBe(10)
  })

  it('warns when a saved project would be too large to reopen', () => {
    const text = 'Ω'.repeat(600) // 1200 bytes
    expect(checkReopenSize(text, 2000)).toBeNull()
    const w = checkReopenSize(text, 1000)
    expect(w?.code).toBe('W_PROJECT_TOO_LARGE_TO_REOPEN')
    expect(w?.severity).toBe('warning')
    expect(checkReopenSize('x'.repeat(10))).toBeNull()
  })
})
