/**
 * The public API of the domain modules, checked mechanically by the typecheck (`tsc -p
 * tsconfig.domain.json`): a caller written against the expected signature must compile against the real
 * export. For functions (`honours`): the expected arguments must be accepted (so a wider input or an
 * extra OPTIONAL parameter passes, a dropped or narrowed parameter fails) and the real result must be
 * usable as the expected result (extra fields pass, a changed field fails). Result and context types are
 * checked with `toExtend`; input bags with `toEqualTypeOf`. Constants fixed by value are checked at run
 * time.
 */
import type * as XLSXNS from 'xlsx'
import type { Config } from 'plotly.js'
import { describe, expect, expectTypeOf, it } from 'vitest'
import type {
  AnalysisSample,
  CellStatus,
  ColumnSummary,
  DatasetView,
  ErrorBarArrays,
} from '@/domain/derive/types'
import type {
  FitOk,
  FitResult,
  GroupSummary,
  ParsedColumn,
  SelectionMap,
  SeriesData,
} from '@/domain/derive/types'
import type { Selection, UncertaintyDescriptor, FitErrorCode } from '@/domain/derive/types'
import { analysisSample } from '@/domain/derive/analysisSample'
import { buildDatasetView } from '@/domain/derive/datasetView'
import { parseColumn } from '@/domain/derive/parseColumn'
import { createDeriver, type DerivedProject, type DerivedSeries } from '@/domain/derive/pipeline'
import { seriesData } from '@/domain/derive/series'
import { applyTransform } from '@/domain/derive/transforms'
import { analysisCsv, CSV_PRESETS, originalCsv, toCsv, type CsvOptions } from '@/domain/export/csv'
import { safeFileName } from '@/domain/export/filename'
import { a11ySummary } from '@/domain/figure/a11ySummary'
import { buildFigure, type FigureContext, type FigureOut } from '@/domain/figure/buildFigure'
import { captionLines, sampleIndicator } from '@/domain/figure/caption'
import { plotConfig } from '@/domain/figure/config'
import { escapePlotText } from '@/domain/figure/escape'
import {
  NEUTRAL,
  SERIES_COLORS,
  SERIES_DASHES,
  SERIES_SYMBOLS,
  seriesAppearance,
} from '@/domain/figure/palette'
import { resolvePlot } from '@/domain/figure/resolvePlot'
import {
  buildSelectionMap,
  rowsFromPlotlyPoints,
  selectedIndicesForTrace,
} from '@/domain/figure/selectionMap'
import { band, predict } from '@/domain/fit/band'
import { linearCombination } from '@/domain/fit/derived'
import { fitPreconditions } from '@/domain/fit/gates'
import { fitLinear, type LinearCore } from '@/domain/fit/linear'
import { fitPolynomial, type PolyCore } from '@/domain/fit/polyQR'
import { runFit } from '@/domain/fit/runFit'
import {
  formatNumber,
  formatR2,
  formatStat,
  formatWithUncertainty,
  roundUncertainty,
  type NumberFormatLocale,
} from '@/domain/format/number'
import { inferColumn, type ColumnInference } from '@/domain/import/columnInfer'
import { decodeBytes } from '@/domain/import/decode'
import { detectDelimiter } from '@/domain/import/delimiter'
import {
  importBytes,
  importText,
  type ImportDraft,
  type ImportOverrides,
} from '@/domain/import/importPipeline'
import { detectLayout, splitNameUnit, type LayoutDetection } from '@/domain/import/layout'
import { LIMITS } from '@/domain/import/limits'
import { isMissingToken, isSheetErrorToken, MISSING_TOKENS } from '@/domain/import/missing'
import {
  classifyNumberToken,
  parseNumber,
  type NumberToken,
  type TokenClass,
} from '@/domain/import/numberToken'
import { suggestRoles } from '@/domain/import/semanticRoles'
import { sniffFormat, type SniffedFormat } from '@/domain/import/sniff'
import { readWorkbook } from '@/domain/import/spreadsheet'
import { tokenize, type TokenizedGrid } from '@/domain/import/tokenize'
import type {
  ColumnId,
  ColumnKind,
  ColumnMeta,
  ColumnParseSettings,
  ColumnRole,
  ConfidenceLevel,
  Dataset,
  DatasetLayout,
  DecimalMode,
  Delimiter,
  Exclusion,
  Filter,
  FitModel,
  FitSpec,
  HistogramOptions,
  Issue,
  LineDash,
  MarkerSymbol,
  OperationLogEntry,
  PlotId,
  PlotSpec,
  PlotType,
  PlotView,
  ProjectDoc,
  RawTable,
  Result,
  SeriesId,
  SeriesStyle,
  SourceKind,
  TextEncoding,
  TransformSpec,
  UncertaintySpec,
  XYSeriesSpec,
} from '@/domain/model'
import {
  checkRefs,
  cascadeRemoval,
  repairRefs,
  wouldCreateCycle,
  type Removal,
} from '@/domain/model/integrity'
import { deserializeProject } from '@/domain/project/deserialize'
import { serializeProject } from '@/domain/project/serialize'
import { defaultPlotSpec, initialPlot, recommend, type Recommendation } from '@/domain/recommend/recommend'
import { groupSummaries } from '@/domain/stats/groups'
import { histogram } from '@/domain/stats/histogram'
import { mean, sampleSD, summarizeColumn } from '@/domain/stats/descriptive'
import { quantile7, tukey } from '@/domain/stats/quantile'
import { tCritical } from '@/domain/stats/tCritical'
import { describeUncertainty } from '@/domain/uncertainty/describe'
import { resolveMeasurementBars, resolveReplicateBars } from '@/domain/uncertainty/resolve'

type Native = { kind: Uint8Array; num: Float64Array }
type MeasurementOrNone = Extract<UncertaintySpec, { kind: 'none' | 'measurement' }>
type Replicate = Extract<UncertaintySpec, { kind: 'sd' | 'sem' | 'ci' }>

type Fn = (...args: never[]) => unknown
/** true when every call written against the expected signature C type-checks against the actual function A. */
type Honours<A extends Fn, C extends Fn> = [Parameters<C>] extends [Parameters<A>]
  ? [ReturnType<A>] extends [ReturnType<C>]
    ? true
    : false
  : false
/** `honours<Expected>()(actual, true)` compiles only when Honours<typeof actual, Expected> is true. */
const honours =
  <C extends Fn>() =>
  <A extends Fn>(_actual: A, _ok: Honours<A, C>): void => {}

describe('API: import, text level', () => {
  it('signatures', () => {
    honours<(bytes: Uint8Array, fileName: string) => SniffedFormat>()(sniffFormat, true)
    expectTypeOf<SniffedFormat>().toEqualTypeOf<'text' | 'xlsx' | 'ods' | 'xls' | 'sciplot' | 'unknown'>()
    honours<
      (bytes: Uint8Array, forced?: TextEncoding) => { text: string; encoding: TextEncoding; issues: Issue[] }
    >()(decodeBytes, true)
    honours<
      (text: string) => {
        delimiter: Delimiter
        confidence: 'high' | 'low'
        alternatives: Delimiter[]
        sepLine: Delimiter | null
        issues: Issue[]
      }
    >()(detectDelimiter, true)
    honours<
      (
        text: string,
        delimiter: Delimiter,
        opts: { maxCells: number; ignoreQuotes?: boolean },
      ) => Result<TokenizedGrid>
    >()(tokenize, true)
    expectTypeOf<TokenizedGrid>().toExtend<{ rows: string[][]; sourceRow: Int32Array; issues: Issue[] }>()
    expectTypeOf<LayoutDetection>().toExtend<{
      layout: DatasetLayout
      names: string[]
      units: (string | null)[]
      unitSources: ('header' | 'unitsRow' | null)[]
      notes: string[]
      headerConfidence: 'high' | 'low'
      issues: Issue[]
    }>()
    honours<
      (
        rows: string[][],
        opts?: {
          headerRow?: number | null
          unitsRow?: number | null
          dataStartRow?: number
          sepLineRow?: number | null
          isNumericLike?: (s: string) => boolean
        },
      ) => LayoutDetection
    >()(detectLayout, true)
    honours<(header: string) => { name: string; unit: string | null }>()(splitNameUnit, true)
    expectTypeOf<ImportOverrides>().toEqualTypeOf<{
      encoding?: TextEncoding
      delimiter?: Delimiter
      ignoreQuotes?: boolean
      headerRow?: number | null
      unitsRow?: number | null
      dataStartRow?: number
      sheetName?: string
    }>()
    expectTypeOf<ImportDraft>().toExtend<{
      rawTable: RawTable
      columns: ColumnMeta[]
      layout: DatasetLayout
      notes: string[]
      detection: {
        encoding: TextEncoding | null
        delimiter: Delimiter | null
        delimiterConfidence: 'high' | 'low'
        alternatives: Delimiter[]
        headerConfidence: 'high' | 'low'
        sheetName: string | null
        sheets: { name: string; rows: number; cols: number }[] | null
      }
      issues: Issue[]
      fastPath: boolean
      suggestedName: string
    }>()
    honours<
      (
        text: string,
        source: {
          kind: SourceKind
          fileName: string | null
          byteSize?: number | null
          encoding?: TextEncoding | null
        },
        overrides?: ImportOverrides,
      ) => Result<ImportDraft>
    >()(importText, true)
    honours<
      (
        bytes: Uint8Array,
        fileName: string,
        overrides?: ImportOverrides,
        deps?: { xlsx?: typeof XLSXNS },
      ) => Result<ImportDraft>
    >()(importBytes, true)
  })

  it('LIMITS has the expected values', () => {
    expect(LIMITS).toMatchObject({
      warnBytes: 5 * 2 ** 20,
      maxTextBytes: 25 * 2 ** 20,
      maxSheetBytes: 20 * 2 ** 20,
      maxProjectBytes: 100 * 2 ** 20,
      maxCells: 2_000_000,
      previewRows: 20,
    })
  })
})

describe('API: import, cell level', () => {
  it('signatures', () => {
    expectTypeOf(MISSING_TOKENS).toExtend<readonly string[]>()
    honours<(text: string) => boolean>()(isMissingToken, true)
    honours<(text: string) => boolean>()(isSheetErrorToken, true)
    expectTypeOf<TokenClass>().toEqualTypeOf<'neutral' | 'dot' | 'comma' | 'ambiguous' | 'invalid'>()
    expectTypeOf<NumberToken>().toExtend<{
      cls: TokenClass
      dotValue: number
      commaValue: number
      unit: string | null
      percent: boolean
    }>()
    honours<(text: string) => NumberToken>()(classifyNumberToken, true)
    honours<
      (
        text: string,
        decimal: DecimalMode,
      ) => { status: CellStatus; value: number; unit: string | null; percent: boolean }
    >()(parseNumber, true)
    expectTypeOf<ColumnInference>().toExtend<{
      detection: ColumnParseSettings & { confidence: 'high' | 'low'; explanations: readonly Issue[] }
      unit: string | null
      issues: Issue[]
    }>()
    honours<
      (
        texts: readonly string[],
        rowIds: readonly number[],
        opts: { columnId: ColumnId; delimiter: Delimiter | null; native?: Native | null },
      ) => ColumnInference
    >()(inferColumn, true)
    honours<
      (
        columns: { name: string; unit: string | null; kind: ColumnKind }[],
      ) => { role: ColumnRole; uncertaintyOf: number | null }[]
    >()(suggestRoles, true)
    honours<
      (
        XLSX: typeof XLSXNS,
        bytes: Uint8Array,
        opts: { sheetName?: string; maxCells: number },
      ) => Result<{
        sheets: { name: string; rows: number; cols: number }[]
        sheetName: string
        grid: string[][]
        native: Native[]
        sourceRow: Int32Array
        issues: Issue[]
      }>
    >()(readWorkbook, true)
  })

  it('MISSING_TOKENS holds at least the expected list', () => {
    const expected = [
      '',
      'NA',
      'N/A',
      'n/a',
      'NaN',
      'nan',
      'null',
      'NULL',
      'none',
      '-',
      '—',
      '–',
      '?',
      'n.d.',
      'nd',
    ]
    for (const t of [...expected, 'missing', '.']) expect(isMissingToken(t), JSON.stringify(t)).toBe(true)
    for (const t of ['#DIV/0!', '#N/A', '#N/D', '#VALUE!', '#VALORE!', '#REF!', '#RIF!', '#NAME?', '#NOME?'])
      expect(isSheetErrorToken(t), t).toBe(true)
    for (const t of ['#NUM!', '#NULL!', '#NULLO!', '#SPILL!', '#CALC!'])
      expect(isSheetErrorToken(t), t).toBe(true)
  })
})

describe('API: derive, stats, uncertainty', () => {
  it('signatures', () => {
    honours<
      (
        columnId: ColumnId,
        texts: readonly string[],
        settings: ColumnParseSettings,
        native?: Native | null,
      ) => ParsedColumn
    >()(parseColumn, true)
    honours<
      (
        spec: TransformSpec,
        inputs: (id: ColumnId) => ParsedColumn | undefined,
        columnId: ColumnId,
      ) => ParsedColumn
    >()(applyTransform, true)
    honours<(dataset: Dataset, raw: RawTable | null) => DatasetView>()(buildDatasetView, true)
    honours<
      (
        view: DatasetView,
        columns: readonly ColumnId[],
        exclusions: readonly Exclusion[],
        filters: readonly Filter[],
      ) => AnalysisSample
    >()(analysisSample, true)
    honours<
      (
        spec: XYSeriesSpec,
        view: DatasetView,
        exclusions: readonly Exclusion[],
        filters: readonly Filter[],
        scales: { x: 'linear' | 'log'; y: 'linear' | 'log' },
      ) => SeriesData
    >()(seriesData, true)
    honours<(sorted: ArrayLike<number>, p: number) => number>()(quantile7, true)
    honours<
      (sorted: ArrayLike<number>) => {
        q1: number
        median: number
        q3: number
        iqr: number
        fences: [number, number]
        whiskers: [number, number]
      } | null
    >()(tukey, true)
    honours<(v: ArrayLike<number>) => number>()(mean, true)
    honours<(v: ArrayLike<number>) => number>()(sampleSD, true)
    honours<
      (
        view: DatasetView,
        columnId: ColumnId,
        sample: AnalysisSample,
        confidence?: ConfidenceLevel,
      ) => ColumnSummary
    >()(summarizeColumn, true)
    honours<
      (
        keys: readonly (string | number)[],
        values: Float64Array,
        rowIds: ArrayLike<number>,
        include: (i: number) => boolean,
        opts: { level: ConfidenceLevel; numericKey: boolean },
      ) => GroupSummary[]
    >()(groupSummaries, true)
    honours<
      (
        values: readonly number[],
        rowIds: readonly number[],
        bins: HistogramOptions['bins'],
      ) => { edges: number[]; counts: number[]; members: number[][]; binWidth: number }
    >()(histogram, true)
    honours<
      (
        spec: MeasurementOrNone,
        values: Float64Array,
        view: DatasetView,
        valueColumn: ColumnMeta,
        columnsById: (id: ColumnId) => ColumnMeta | undefined,
      ) => ErrorBarArrays | null
    >()(resolveMeasurementBars, true)
    honours<
      (
        spec: Replicate,
        series: SeriesData,
        view: DatasetView,
      ) => { groups: GroupSummary[]; bars: ErrorBarArrays }
    >()(resolveReplicateBars, true)
    honours<(spec: UncertaintySpec, ctx?: { groupN?: number[] }) => UncertaintyDescriptor>()(
      describeUncertainty,
      true,
    )
    honours<(confidence: number, df: number) => number>()(tCritical, true)
  })
})

describe('API: fit, format', () => {
  it('signatures', () => {
    honours<
      (
        model: FitModel,
        x: Float64Array,
        y: Float64Array,
        rowIds: Int32Array,
      ) => (Issue & { code: FitErrorCode }) | null
    >()(fitPreconditions, true)
    honours<
      (x: Float64Array, y: Float64Array, rowIds: Int32Array, confidence: ConfidenceLevel) => LinearCore
    >()(fitLinear, true)
    honours<
      (
        x: Float64Array,
        y: Float64Array,
        rowIds: Int32Array,
        degree: number,
        confidence: ConfidenceLevel,
      ) => PolyCore | (Issue & { code: FitErrorCode })
    >()(fitPolynomial, true)
    honours<(fit: FitOk, x: number) => number>()(predict, true)
    honours<
      (
        fit: FitOk,
        xs: readonly number[],
        kind: 'confidence' | 'prediction',
      ) => { x: number[]; yhat: number[]; lower: number[]; upper: number[] }
    >()(band, true)
    honours<(fit: FitOk, weights: readonly number[]) => { value: number; se: number | null }>()(
      linearCombination,
      true,
    )
    honours<
      (
        spec: FitSpec,
        data: SeriesData,
        opts: { xUnit: string | null; yUnit: string | null; yUncertainty?: ErrorBarArrays | null },
      ) => FitResult
    >()(runFit, true)
    expectTypeOf<NumberFormatLocale>().toEqualTypeOf<{ decimal: '.' | ',' }>()
    honours<(u: number) => { value: number; sig: 1 | 2; decimals: number; exponent: number }>()(
      roundUncertainty,
      true,
    )
    honours<
      (
        value: number,
        u: number,
        loc: NumberFormatLocale,
      ) => { value: string; u: string; text: string; sharedExponent: number | null }
    >()(formatWithUncertainty, true)
    honours<(value: number, opts: { sig?: number; decimals?: number; loc: NumberFormatLocale }) => string>()(
      formatNumber,
      true,
    )
    honours<(r2: number | null, loc: NumberFormatLocale, advanced?: boolean) => string>()(formatR2, true)
    honours<
      (
        kind: 'n' | 'mean' | 'median' | 'sd' | 'sem' | 'min' | 'max' | 'range' | 'quartile' | 'ci',
        value: number | null,
        ctx: { sem?: number | null; rawText?: string; loc: NumberFormatLocale },
      ) => string
    >()(formatStat, true)
  })
})

describe('API: project file, CSV export, integrity', () => {
  it('signatures', () => {
    honours<
      (
        doc: ProjectDoc,
        rawTables: Record<string, RawTable>,
        log: readonly OperationLogEntry[],
        appVersion: string,
        savedAt?: string,
      ) => string
    >()(serializeProject, true)
    honours<
      (
        text: string,
        opts?: { maxBytes?: number },
      ) => Result<{
        doc: ProjectDoc
        rawTables: Record<string, RawTable>
        log: OperationLogEntry[]
        repaired: Issue[]
      }>
    >()(deserializeProject, true)
    honours<(doc: ProjectDoc) => Issue[]>()(checkRefs, true)
    // Returns the number of items changed rather than nothing. Safe as used: the store's commit() wraps recipes as `(d) => { recipe(d); … }`, so immer never sees the count
    // (an immer producer that returned it would replace or reject the document).
    honours<(doc: ProjectDoc, removal: Removal) => number>()(cascadeRemoval, true)
    honours<(doc: ProjectDoc) => number>()(repairRefs, true)
    honours<(dataset: Dataset, columnId: ColumnId, spec: TransformSpec) => boolean>()(wouldCreateCycle, true)
    expectTypeOf<CsvOptions>().toEqualTypeOf<{
      delimiter: ',' | ';' | '\t'
      decimal: '.' | ','
      bom: boolean
    }>()
    honours<(rows: readonly (readonly string[])[], opts: CsvOptions) => string>()(toCsv, true)
    honours<(dataset: Dataset, raw: RawTable | null, opts: CsvOptions) => string>()(originalCsv, true)
    honours<
      (
        input: {
          view: DatasetView
          columns: ColumnMeta[]
          sample: AnalysisSample
          fit?: FitOk | null
          fitXColumn?: ColumnId
          predict?: (x: number) => number
        },
        opts: CsvOptions,
      ) => string
    >()(analysisCsv, true)
    honours<(name: string, ext: string) => string>()(safeFileName, true)
  })

  it('CSV presets have the expected values', () => {
    expect(CSV_PRESETS.standard).toEqual({ delimiter: ',', decimal: '.', bom: false })
    expect(CSV_PRESETS.excelItalian).toEqual({ delimiter: ';', decimal: ',', bom: true })
  })
})

describe('API: pipeline, recommend, figure', () => {
  it('signatures', () => {
    honours<() => (doc: ProjectDoc, rawTables: Readonly<Record<string, RawTable>>) => DerivedProject>()(
      createDeriver,
      true,
    )
    expectTypeOf<DerivedSeries>().toExtend<{
      spec: XYSeriesSpec
      index: number
      view: DatasetView
      xColumn: ColumnMeta
      yColumn: ColumnMeta
      data: SeriesData
      xBars: ErrorBarArrays | null
      yBars: ErrorBarArrays | null
      replicate: { groups: GroupSummary[]; bars: ErrorBarArrays } | null
      fitSpec: FitSpec | null
      fit: FitResult | null
      issues: Issue[]
    }>()
    expectTypeOf<DerivedProject>().toExtend<{
      doc: ProjectDoc
      views: ReadonlyMap<string, DatasetView>
      plot: PlotSpec | null
      plotView: PlotView | null
      series: readonly DerivedSeries[]
      columnSummary(datasetId: Dataset['id'], columnId: ColumnId): ColumnSummary | null
      columnSample(datasetId: Dataset['id'], columnIds: readonly ColumnId[]): AnalysisSample | null
      issues: readonly Issue[]
    }>()
    expectTypeOf<Recommendation>().toExtend<{
      plotType: PlotType
      messageKey: string
      params: Record<string, string | number>
      alternatives: { plotType: PlotType; messageKey: string }[]
      suggestFit: boolean
      uncertaintyColumn: ColumnId | null
    }>()
    honours<(id: PlotId) => PlotSpec>()(defaultPlotSpec, true)
    honours<(dataset: Dataset, view: DatasetView) => Recommendation>()(recommend, true)
    honours<
      (
        dataset: Dataset,
        view: DatasetView,
        plotId: PlotId,
        seriesId: SeriesId,
      ) => { plot: PlotSpec; recommendation: Recommendation }
    >()(initialPlot, true)
    expectTypeOf(SERIES_COLORS).toExtend<readonly string[]>()
    expectTypeOf(SERIES_SYMBOLS).toExtend<readonly MarkerSymbol[]>()
    expectTypeOf(SERIES_DASHES).toExtend<readonly LineDash[]>()
    expectTypeOf(NEUTRAL).toExtend<{
      text: string
      mutedText: string
      grid: string
      axis: string
      zero: string
      excluded: string
      background: string
    }>()
    honours<(index: number, style: SeriesStyle) => { color: string; symbol: MarkerSymbol; dash: LineDash }>()(
      seriesAppearance,
      true,
    )
    honours<(lang: 'en' | 'it') => Partial<Config>>()(plotConfig, true)
    honours<(s: string) => string>()(escapePlotText, true)
    honours<(spec: PlotSpec) => PlotView>()(resolvePlot, true)
    expectTypeOf<FigureContext>().toExtend<{
      mode: 'screen' | 'export'
      lang: 'en' | 'it'
      loc: NumberFormatLocale
      t: (key: string, params?: Record<string, string | number>) => string
      selection: Selection | null
      dragmode: 'zoom' | 'pan' | 'select' | 'lasso'
      viewResetCounter: number
      fontFamily: string
      advanced: boolean
      size?: { width: number; height: number }
    }>()
    expectTypeOf<FigureOut>().toExtend<{
      selectionMap: SelectionMap
      caption: string[]
      indicator: string | null
      issues: Issue[]
      a11y: string
    }>()
    honours<(derived: DerivedProject, ctx: FigureContext) => FigureOut>()(buildFigure, true)
    honours<(traces: { uid: string; rowIds: ArrayLike<number> }[]) => SelectionMap>()(buildSelectionMap, true)
    honours<
      (
        points: readonly {
          data?: { uid?: string }
          pointIndex?: number
          pointNumber?: number
          customdata?: unknown
        }[],
        map: SelectionMap,
      ) => number[]
    >()(rowsFromPlotlyPoints, true)
    honours<(uid: string, selection: Selection | null, map: SelectionMap) => number[] | null>()(
      selectedIndicesForTrace,
      true,
    )
    honours<(derived: DerivedProject, ctx: FigureContext) => string | null>()(sampleIndicator, true)
    honours<(derived: DerivedProject, ctx: FigureContext) => string[]>()(captionLines, true)
    honours<(derived: DerivedProject, ctx: FigureContext) => string>()(a11ySummary, true)
  })

  it('plot config and palette hold the expected values', () => {
    expect(plotConfig('it')).toMatchObject({
      displaylogo: false,
      showSendToCloud: false,
      displayModeBar: false,
      responsive: true,
      scrollZoom: false,
      doubleClick: 'reset',
      locale: 'it',
      showTips: false,
    })
    expect([...SERIES_SYMBOLS].slice(0, 6)).toEqual([
      'circle',
      'square',
      'diamond',
      'triangle-up',
      'triangle-down',
      'cross',
    ])
    expect(escapePlotText('<b>&%{x}')).toBe('&lt;b&gt;&amp;%&#123;x}')
  })
})
