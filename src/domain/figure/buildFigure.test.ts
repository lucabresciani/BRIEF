import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createDeriver, type DerivedProject } from '@/domain/derive/pipeline'
import type { FitOk, Selection } from '@/domain/derive/types'
import { band, predict } from '@/domain/fit/band'
import { formatStat, formatWithUncertainty } from '@/domain/format/number'
import { DEFAULT_SERIES_STYLE } from '@/domain/model'
import type {
  ColumnId,
  ColumnMeta,
  DatasetId,
  FitSpec,
  PlotId,
  PlotSpec,
  SeriesStyle,
  XYSeriesSpec,
} from '@/domain/model'
import { quantile7, sortedCopy } from '@/domain/stats/quantile'
import { makeTranslator } from '@/i18n/translate'
import { buildFigure, MANY_POINTS } from './buildFigure'
import type { FigureContext, FigureOut } from './context'
import { FIT_WIDTH_ALONE, SERIES_COLORS, withAlpha } from './palette'
import { CURVE_POINTS } from './traces/fit'
import {
  deriveOnce,
  docOf,
  exclusionOf,
  figureContext,
  fitOf,
  type Imported,
  importCsv,
  plotOf,
  rawTablesOf,
  series,
} from './testing'

const example = (f: string) => readFileSync(resolve('src/examples', f), 'utf8')
const ref = (f: string) => JSON.parse(readFileSync(resolve('tests/fixtures/reference', f), 'utf8'))

type AnyTrace = Record<string, unknown> & {
  uid: string
  type: string
  x: number[]
  y: number[]
  customdata?: unknown[][]
  mode?: string
  name?: string
  visible?: unknown
  selectedpoints?: number[] | null
  hovertemplate?: string | string[]
}
const traces = (f: FigureOut) => f.data as unknown as AnyTrace[]
const trace = (f: FigureOut, uid: string) => {
  const t = traces(f).find((x) => x.uid === uid)
  if (!t)
    throw new Error(
      `no trace ${uid} in ${traces(f)
        .map((x) => x.uid)
        .join(', ')}`,
    )
  return t
}
const codes = (f: FigureOut) => f.issues.map((i) => i.code)

const ohm = importCsv(example('ohm.csv'), 'ds_ohm')
const freeFall = importCsv(example('freeFall.csv'), 'ds_ff')
const pendulum = importCsv(example('pendulum.csv'), 'ds_pend')
const beer = importCsv(example('beerLambert.csv'), 'ds_beer')
const cooling = importCsv(example('cooling.csv'), 'ds_cool')

const ohmSeries = (over: Partial<XYSeriesSpec> = {}) => series('ser_ohm', ohm, 'I', 'V', over)
const ohmFit = fitOf('fit_ohm', 'ser_ohm')
function ohmDerived(
  plotOver: Partial<PlotSpec> = {},
  extra: Parameters<typeof deriveOnce>[2] = { fits: [ohmFit] },
) {
  return deriveOnce([ohm], plotOf({ series: [ohmSeries()], ...plotOver }), extra)
}

/**
 * The same table as if cut out of a sheet with its variables in rows (transposed on import): the
 * header record is sheet column `firstColumn` (1 = A) and each data record the next column.
 */
function transpose(ds: Imported, firstColumn: number): Imported {
  const n = ds.raw.rowCount
  return {
    ...ds,
    raw: {
      ...ds.raw,
      source: {
        ...ds.raw.source,
        region: {
          orientation: 'rows',
          blocks: [{ range: 'C2:M3', label: null, firstRow: 0, rowCount: n }],
          labelColumns: [],
        },
      },
      sourceRow: Int32Array.from({ length: n }, (_, i) => i + firstColumn),
    },
  }
}

const freeFallBars = (visible = true): XYSeriesSpec['errorBars'] => ({
  x: { kind: 'none' },
  y: {
    kind: 'measurement',
    origin: 'instrument',
    source: { type: 'column', column: freeFall.col('u(y)') },
    meaning: { type: 'standard' },
  },
  visible,
})

describe('Plotly contract', () => {
  const fig = buildFigure(ohmDerived(), figureContext())

  it('config never shows the cloud button or the logo', () => {
    expect(fig.config).toMatchObject({
      showSendToCloud: false,
      displaylogo: false,
      displayModeBar: false,
      locale: 'en',
    })
    expect(buildFigure(ohmDerived(), figureContext({ lang: 'it' })).config.locale).toBe('it')
  })

  it('mode is always explicit, uids are `${series}__${role}` and stable across calls', () => {
    const pts = trace(fig, 'ser_ohm__points')
    expect(pts.type).toBe('scatter')
    expect(pts.mode).toBe('markers')
    expect(trace(fig, 'ser_ohm__fit').mode).toBe('lines')
    for (const t of traces(fig)) expect(typeof t.mode).toBe('string')
    const again = buildFigure(ohmDerived(), figureContext())
    expect(traces(again).map((t) => t.uid)).toEqual(traces(fig).map((t) => t.uid))
    expect(traces(fig).find((t) => t.uid === 'ser_ohm__fit')?.showlegend).toBe(true)
  })

  it('customdata = [RowId, source row, x text, y text, …]; values keep their recorded decimals', () => {
    const pts = trace(fig, 'ser_ohm__points')
    expect(pts.customdata!.map((c) => c[0])).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(pts.customdata!.map((c) => c[1])).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    expect(pts.customdata![0].slice(2, 4)).toEqual(['0.010', '0.464'])
    // Italian decimal mark: same digits, comma.
    const it = buildFigure(ohmDerived(), figureContext({ loc: { decimal: ',' } }))
    expect(trace(it, 'ser_ohm__points').customdata![0].slice(2, 4)).toEqual(['0,010', '0,464'])
    expect(pts.hovertemplate).toContain('%{customdata[1]}')
    expect(pts.hovertemplate).toContain('<extra></extra>')
  })

  it('titles are {text} objects, exponentformat is power, separators follow the number locale', () => {
    expect(fig.layout.xaxis?.title).toMatchObject({ text: 'I (A)' })
    expect(fig.layout.yaxis?.title).toMatchObject({ text: 'V (V)' })
    expect(fig.layout.xaxis?.exponentformat).toBe('power')
    expect(fig.layout.yaxis?.exponentformat).toBe('power')
    expect(fig.layout.separators).toBe('.,')
    expect(buildFigure(ohmDerived(), figureContext({ loc: { decimal: ',' } })).layout.separators).toBe(',.')
    expect(fig.layout.font?.family).toBe('Test Sans')
    const titled = buildFigure(ohmDerived({ title: 'Ohm' }), figureContext())
    expect(titled.layout.title).toMatchObject({ text: 'Ohm' })
    expect(fig.layout.title).toBeUndefined()
  })

  it('outputs are fresh and never frozen (Plotly mutates them)', () => {
    const d = ohmDerived()
    const a = buildFigure(d, figureContext())
    const b = buildFigure(d, figureContext())
    expect(Object.isFrozen(a.data)).toBe(false)
    expect(Object.isFrozen(a.layout)).toBe(false)
    expect(Object.isFrozen(a.layout.xaxis)).toBe(false)
    for (const t of a.data) expect(Object.isFrozen(t)).toBe(false)
    expect(a.data[0]).not.toBe(b.data[0])
    expect(a.layout).not.toBe(b.layout)
    expect((a.data[1] as AnyTrace).x).not.toBe((b.data[1] as AnyTrace).x)
    // Mutating one figure (as Plotly does) does not leak into the next one.
    ;(a.data[1] as AnyTrace).selectedpoints = [0, 1]
    a.layout.xaxis!.range = [0, 1]
    const c = buildFigure(d, figureContext())
    expect((c.data[1] as AnyTrace).selectedpoints).toBeNull()
    expect(c.layout.xaxis?.range).toBeUndefined()
  })
})

describe('figure input', () => {
  it('the two stages of a derivation are enough: the same figure as from the DerivedProject', () => {
    const doc = docOf([ohm, pendulum], plotOf({ series: [ohmSeries()] }), {
      fits: [ohmFit],
      exclusions: [exclusionOf('e', ohm, [3], { note: 'loose contact' })],
    })
    const d = createDeriver()(doc, rawTablesOf([ohm, pendulum]))
    const ctx = figureContext()
    const whole = buildFigure(d, ctx)
    const parts = buildFigure({ ...d.parts.data, ...d.parts.plot }, ctx)
    expect(JSON.stringify(parts.data)).toBe(JSON.stringify(whole.data))
    expect(JSON.stringify(parts.layout)).toBe(JSON.stringify(whole.layout))
    expect(parts.caption).toEqual(whole.caption)
    expect(parts.caption.some((l) => l.startsWith('figure.caption.excluded|'))).toBe(true)
    expect(parts.indicator).toBe(whole.indicator)
    expect(parts.a11y).toBe(whole.a11y)
    expect(parts.issues).toEqual(whole.issues)
  })
})

describe('uirevision per axis', () => {
  const rev = (d: DerivedProject, ctx: Partial<FigureContext> = {}) => {
    const f = buildFigure(d, figureContext(ctx))
    return { x: f.layout.xaxis?.uirevision, y: f.layout.yaxis?.uirevision, all: f.layout.uirevision }
  }
  const base = rev(ohmDerived())

  it('changes with the column, the scale and "Reset view"', () => {
    const swapped = deriveOnce([ohm], plotOf({ series: [series('ser_ohm', ohm, 'V', 'I')] }))
    expect(rev(swapped).x).not.toBe(base.x)
    expect(rev(swapped).y).not.toBe(base.y)
    const p = plotOf({ series: [ohmSeries()] })
    const logX = rev(deriveOnce([ohm], { ...p, xAxis: { ...p.xAxis, scale: 'log' } }, { fits: [ohmFit] }))
    expect(logX.x).not.toBe(base.x)
    expect(logX.y).toBe(base.y)
    const reset = rev(ohmDerived(), { viewResetCounter: 1 })
    expect(reset.x).not.toBe(base.x)
    expect(reset.y).not.toBe(base.y)
    expect(reset.all).not.toBe(base.all)
  })

  it('contains the plot id: another plot of the same columns keeps its own zoom', () => {
    const other = rev(
      deriveOnce([ohm], plotOf({ id: 'plot_2' as PlotId, series: [ohmSeries()] }), { fits: [ohmFit] }),
    )
    for (const k of ['x', 'y', 'all'] as const) {
      expect(other[k]).not.toBe(base[k])
      expect(String(base[k])).toContain('plot_1')
      expect(String(other[k])).toContain('plot_2')
    }
    const histogram = (id: string) =>
      buildFigure(
        deriveOnce(
          [ohm],
          plotOf({
            id: id as PlotId,
            type: 'histogram',
            histogram: { ...plotOf().histogram, datasetId: ohm.dataset.id, value: ohm.col('V') },
          }),
        ),
        figureContext(),
      ).layout
    expect(histogram('plot_1').xaxis?.uirevision).not.toBe(histogram('plot_2').xaxis?.uirevision)
    expect(histogram('plot_1').uirevision).not.toBe(histogram('plot_2').uirevision)
  })

  it('does not change with the style, the title, the legend or the selection', () => {
    const styled = deriveOnce(
      [ohm],
      plotOf({
        title: 'New',
        legend: { visible: false, position: 'top-left' },
        series: [
          ohmSeries({ style: { ...ohmSeries().style, markerSize: 12, paletteIndex: 3, symbol: 'diamond' } }),
        ],
      }),
      { fits: [ohmFit] },
    )
    expect(rev(styled)).toEqual(base)
    const selected = rev(ohmDerived(), {
      selection: { datasetId: ohm.dataset.id, rowIds: new Set([1]), origin: 'plot', anchor: null },
    })
    expect(selected).toEqual(base)
  })
})

describe('selection', () => {
  const d = ohmDerived(
    { scatter: { residualPanel: true, showExcluded: true } },
    { fits: [ohmFit], exclusions: [exclusionOf('e', ohm, [3])] },
  )
  const tableSel = (rows: number[], datasetId: DatasetId = ohm.dataset.id): Selection => ({
    datasetId,
    rowIds: new Set(rows),
    origin: 'table',
    anchor: null,
  })

  it('selectedpoints is null without a selection (never [])', () => {
    const f = buildFigure(d, figureContext())
    for (const uid of ['ser_ohm__points', 'ser_ohm__excluded', 'ser_ohm__residuals'])
      expect(trace(f, uid).selectedpoints).toBeNull()
    expect(f.layout.selectionrevision).toBe('none')
    expect(f.layout.selections).toEqual([])
  })

  it('a table selection gives indices per trace, clears Plotly outlines and bumps selectionrevision', () => {
    const s1 = tableSel([2, 3, 4])
    const f = buildFigure(d, figureContext({ selection: s1 }))
    expect(trace(f, 'ser_ohm__points').selectedpoints).toEqual([1, 2]) // rows 2 and 4 (row 3 is excluded)
    expect(trace(f, 'ser_ohm__excluded').selectedpoints).toEqual([0])
    expect(trace(f, 'ser_ohm__residuals').selectedpoints).toEqual([1, 2])
    expect(trace(f, 'ser_ohm__fit').selectedpoints).toBeUndefined()
    expect(f.layout.selections).toEqual([])
    // Same Selection object (zoom, re-render): same revision; a new selection: a new revision.
    const again = buildFigure(d, figureContext({ selection: s1 }))
    expect(again.layout.selectionrevision).toBe(f.layout.selectionrevision)
    const f2 = buildFigure(d, figureContext({ selection: tableSel([5]) }))
    expect(f2.layout.selectionrevision).not.toBe(f.layout.selectionrevision)
    expect(trace(f2, 'ser_ohm__excluded').selectedpoints).toEqual([]) // nothing of this trace selected: dimmed
    // Clearing the selection (e.g. from the table) changes the revision too: no stale outline survives.
    expect(buildFigure(d, figureContext()).layout.selectionrevision).not.toBe(f2.layout.selectionrevision)
  })

  it('a plot selection is mirrored from the store; a selection in another dataset does not dim this one', () => {
    const plotSel: Selection = {
      datasetId: ohm.dataset.id,
      rowIds: new Set([1]),
      origin: 'plot',
      anchor: null,
    }
    const f = buildFigure(d, figureContext({ selection: plotSel }))
    expect(trace(f, 'ser_ohm__points').selectedpoints).toEqual([0])
    expect(f.layout.selectionrevision).not.toBe('none')
    expect(f.layout.selections).toEqual([])
    const other = buildFigure(d, figureContext({ selection: tableSel([1], 'ds_other' as DatasetId) }))
    expect(trace(other, 'ser_ohm__points').selectedpoints).toBeNull()
  })

  it('the export figure is never dimmed by a selection', () => {
    const f = buildFigure(
      d,
      figureContext({ mode: 'export', selection: tableSel([1]), size: { width: 800, height: 600 } }),
    )
    expect(trace(f, 'ser_ohm__points').selectedpoints).toBeNull()
  })
})

describe('error bars', () => {
  const uy = ref('freeFall.json')
  const rawU = example('freeFall.csv')
    .trim()
    .split('\n')
    .slice(1)
    .map((l) => Number(l.split(',')[2]))

  it("error_y is type 'data' with exactly the u(y) column (free fall)", () => {
    expect(uy.source).toContain('freeFall')
    const d = deriveOnce(
      [freeFall],
      plotOf({ series: [series('ser_ff', freeFall, 't', 'y', { errorBars: freeFallBars() })] }),
    )
    const f = buildFigure(d, figureContext())
    const ey = trace(f, 'ser_ff__points').error_y as {
      type: string
      array: number[]
      symmetric: boolean
      visible: boolean
    }
    expect(ey).toMatchObject({ type: 'data', symmetric: true, visible: true })
    expect(ey.array).toEqual(rawU)
    expect(trace(f, 'ser_ff__points').error_x).toBeUndefined()
    // The hover states the uncertainty and its meaning.
    expect(trace(f, 'ser_ff__points').customdata![0][4]).toBe(' ± 0.002')
    expect(trace(f, 'ser_ff__points').hovertemplate).toContain('uncertainty.label.measurement.standard')
  })

  it('hiding the bars keeps the arrays unchanged', () => {
    const shown = buildFigure(
      deriveOnce(
        [freeFall],
        plotOf({ series: [series('ser_ff', freeFall, 't', 'y', { errorBars: freeFallBars(true) })] }),
      ),
      figureContext(),
    )
    const hidden = buildFigure(
      deriveOnce(
        [freeFall],
        plotOf({ series: [series('ser_ff', freeFall, 't', 'y', { errorBars: freeFallBars(false) })] }),
      ),
      figureContext(),
    )
    const a = trace(shown, 'ser_ff__points').error_y as { array: number[]; visible: boolean }
    const b = trace(hidden, 'ser_ff__points').error_y as { array: number[]; visible: boolean }
    expect(b.visible).toBe(false)
    expect(b.array).toEqual(a.array)
  })

  it('asymmetric bars pass both arrays; a missing uncertainty is NaN (no bar), never 0', () => {
    const ds = importCsv('x (s),y (m),up (m),down (m)\n1,10,1,0.5\n2,20,,\n3,30,2,1\n', 'ds_asym')
    const s = series('ser_a', ds, 'x', 'y', {
      errorBars: {
        x: {
          kind: 'measurement',
          origin: 'user',
          source: { type: 'absolute', value: 0.1 },
          meaning: { type: 'standard' },
        },
        y: {
          kind: 'measurement',
          origin: 'user',
          source: { type: 'columnAsymmetric', plus: ds.col('up'), minus: ds.col('down') },
          meaning: { type: 'unspecified' },
        },
        visible: true,
      },
    })
    const f = buildFigure(deriveOnce([ds], plotOf({ series: [s] })), figureContext())
    const p = trace(f, 'ser_a__points')
    const ey = p.error_y as { array: number[]; arrayminus: number[]; symmetric: boolean }
    expect(ey.symmetric).toBe(false)
    expect(ey.array).toEqual([1, NaN, 2])
    expect(ey.arrayminus).toEqual([0.5, NaN, 1])
    expect(Number.isNaN(ey.array[1])).toBe(true)
    expect((p.error_x as { array: number[] }).array).toEqual([0.1, 0.1, 0.1])
    expect(p.customdata![0][4]).toBe(' +1 / −0.5')
    expect(p.customdata![1][4]).toBe('')
  })
})

describe('excluded observations', () => {
  const d = ohmDerived(
    {},
    {
      fits: [ohmFit],
      exclusions: [exclusionOf('e', ohm, [3], { reason: 'measurement-problem', note: 'loose contact' })],
    },
  )
  const f = buildFigure(d, figureContext())

  it('are a separate hollow grey trace with a legend entry, never part of the points or the fit', () => {
    const ex = trace(f, 'ser_ohm__excluded')
    expect(ex.x).toEqual([0.03])
    expect(ex.customdata!.map((c) => c[0])).toEqual([3])
    expect((ex.marker as { symbol: string; color: string }).symbol).toBe('circle-open')
    expect(ex.name).toBe('legend.excluded|{"n":1}')
    expect(ex.showlegend).toBe(true)
    expect(trace(f, 'ser_ohm__points').x).toHaveLength(9)
    expect((d.series[0].fit as FitOk).provenance.nUsed).toBe(9)
  })

  it('can be hidden from the plot (showExcluded false) while the indicator still states them', () => {
    const hidden = buildFigure(
      ohmDerived(
        { scatter: { residualPanel: false, showExcluded: false } },
        { exclusions: [exclusionOf('e', ohm, [3])] },
      ),
      figureContext(),
    )
    expect(traces(hidden).some((t) => t.uid === 'ser_ohm__excluded')).toBe(false)
    expect(hidden.indicator).toBe('figure.indicator.n|{"n":9,"total":10}, figure.indicator.excluded|{"n":1}')
  })

  it('the indicator and the caption state n, the exclusion with its reason and row, and the fit', () => {
    expect(f.indicator).toBe(
      'figure.indicator.n|{"n":9,"total":10}, figure.indicator.excluded|{"n":1}, figure.indicator.fit|{"model":"fit.modelShort.linear"}',
    )
    expect(f.caption).toContain(
      'figure.caption.excluded|{"rows":"4","reason":"exclusion.reasons.measurement-problem: loose contact"}',
    )
    const pts = trace(f, 'ser_ohm__points')
    expect(pts.hovertemplate).toContain('figure.hover.row')
    expect(pts.hovertemplate).not.toContain('figure.hover.column')
  })

  it('a block transposed on import names sheet columns, never rows, in the hover and the caption', () => {
    // Ohm as if read from a sheet with the variables in rows: header in column C, records in D..M.
    const transposed = transpose(ohm, 3)
    const t = buildFigure(
      deriveOnce(
        [transposed],
        plotOf({ series: [ohmSeries()], scatter: { residualPanel: true, showExcluded: true } }),
        {
          fits: [ohmFit],
          exclusions: [exclusionOf('e', transposed, [3], { note: 'loose contact' })],
        },
      ),
      figureContext(),
    )
    const pts = trace(t, 'ser_ohm__points')
    expect(pts.customdata!.map((c) => c[1])).toEqual(['D', 'E', 'G', 'H', 'I', 'J', 'K', 'L', 'M'])
    expect(pts.hovertemplate).toContain('figure.hover.column')
    expect(pts.hovertemplate).not.toContain('figure.hover.row')
    expect(trace(t, 'ser_ohm__excluded').customdata!.map((c) => c[1])).toEqual(['F'])
    expect(trace(t, 'ser_ohm__residuals').hovertemplate).toContain('figure.hover.column')
    expect(t.caption).toContain(
      'figure.caption.excludedColumns|{"columns":"F","reason":"exclusion.reasons.measurement-problem: loose contact"}',
    )
    expect(t.caption.some((l) => l.startsWith('figure.caption.excluded|'))).toBe(false)
  })
})

describe('fit curve, bands and residual panel', () => {
  const fitSpec = fitOf('fit_ohm', 'ser_ohm', {
    show: { curve: true, confidenceBand: true, predictionBand: true, residuals: true },
  })
  const d = ohmDerived({ scatter: { residualPanel: true, showExcluded: true } }, { fits: [fitSpec] })
  const fit = d.series[0].fit as FitOk
  const f = buildFigure(d, figureContext())

  it('the curve is sampled at 200 x over the fitted x range and evaluated with predict()', () => {
    const c = trace(f, 'ser_ohm__fit')
    expect(c.x).toHaveLength(CURVE_POINTS)
    expect(c.x[0]).toBe(0.01)
    expect(c.x[CURVE_POINTS - 1]).toBe(0.1)
    c.x.forEach((x, k) => expect(c.y[k]).toBe(predict(fit, x)))
    expect((c.line as { dash: string }).dash).toBe('solid')
    expect(codes(f)).not.toContain('W_EXTRAPOLATION')
  })

  it('pointwise bands: lower then upper filled tonexty, equal to fit/band.ts; prediction band wider', () => {
    const uids = traces(f).map((t) => t.uid)
    expect(uids.slice(0, 4)).toEqual([
      'ser_ohm__predictionBandLower',
      'ser_ohm__predictionBand',
      'ser_ohm__bandLower',
      'ser_ohm__band',
    ])
    const lo = trace(f, 'ser_ohm__bandLower')
    const hi = trace(f, 'ser_ohm__band')
    const ref95 = band(fit, lo.x, 'confidence')
    expect(lo.y).toEqual(ref95.lower)
    expect(hi.y).toEqual(ref95.upper)
    expect(hi.fill).toBe('tonexty')
    expect(lo.fill).toBeUndefined()
    expect(hi.name).toBe('legend.band.confidence|{"level":95}')
    expect(hi.showlegend).toBe(true)
    expect(lo.showlegend).toBe(false)
    const plo = trace(f, 'ser_ohm__predictionBandLower')
    plo.y.forEach((v, k) => expect(v).toBeLessThan(lo.y[k]))
    expect(f.caption).toContain('figure.caption.band.confidence|{"level":95}')
    expect(f.caption).toContain('figure.caption.band.prediction|{"level":95}')
  })

  it('a centred equation with a negative centre reads (x + 1.8) in the caption, never (x − −1.8)', () => {
    const ds = importCsv('x,y\n-2.1,4.1\n-2.0,3.2\n-1.9,2.9\n-1.8,2.6\n-1.7,2.8\n-1.6,3.3\n', 'ds_negc')
    const p = plotOf({ series: [series('ser_c', ds, 'x', 'y')] })
    const fits = [fitOf('fit_c', 'ser_c', { model: { type: 'polynomial', degree: 2 } })]
    const d = deriveOnce([ds], p, { fits })
    const fit = d.series[0].fit as FitOk
    expect(fit.equation).toMatchObject({ form: 'centred', x0: -1.8 })
    const f = buildFigure(d, figureContext({ mode: 'export' }))
    const line = f.caption.find((l) => l.startsWith('figure.caption.fit'))
    expect(line).toContain('(x + 1.8)²')
    expect(line).not.toContain('− −')
  })

  it('on a log y axis a band limit ≤ 0 is kept (filled to the bottom edge), never a NaN gap', () => {
    // The lower 95 % limit is ≤ 0 near x = 1: a NaN there made Plotly close the 'tonexty' fill with an
    // invented diagonal edge. Plotly draws a non-positive value far below a log axis instead.
    const ds = importCsv('x,y\n1,0.2\n2,1.5\n3,1.8\n4,3.6\n5,3.9\n6,5.5\n', 'ds_logband')
    const show = { curve: true, confidenceBand: true, predictionBand: false, residuals: false }
    const plot = (scale: 'linear' | 'log') =>
      plotOf({ series: [series('ser_b', ds, 'x', 'y')], yAxis: { ...plotOf().yAxis, scale } })
    const fits = [fitOf('fit_b', 'ser_b', { show })]
    const d = deriveOnce([ds], plot('log'), { fits })
    const fb = buildFigure(d, figureContext())
    const lo = trace(fb, 'ser_b__bandLower')
    const hi = trace(fb, 'ser_b__band')
    const ref95 = band(d.series[0].fit as FitOk, lo.x, 'confidence')
    expect(ref95.lower.some((v) => v <= 0)).toBe(true)
    expect(lo.y).toEqual(ref95.lower)
    expect(hi.y).toEqual(ref95.upper)
    expect([...lo.y, ...hi.y].every(Number.isFinite)).toBe(true)
    // The same band as on a linear axis: the axis only changes how it is drawn.
    const linear = buildFigure(deriveOnce([ds], plot('linear'), { fits }), figureContext())
    expect(trace(linear, 'ser_b__bandLower').y).toEqual(lo.y)

    // A band entirely ≤ 0 cannot be seen on a log axis: no band and no legend entry for it.
    const neg = importCsv('x,y\n1,-5\n2,-6.2\n3,-6.9\n4,-8.1\n', 'ds_negband')
    const negPlot = plotOf({
      series: [series('ser_n', neg, 'x', 'y')],
      yAxis: { ...plotOf().yAxis, scale: 'log' },
    })
    const fn = buildFigure(
      deriveOnce([neg], negPlot, { fits: [fitOf('fit_n', 'ser_n', { show })] }),
      figureContext(),
    )
    expect(traces(fn).some((t) => t.uid.startsWith('ser_n__band'))).toBe(false)
  })

  it('the residual subplot shares x (xaxis2 matches x) below the main panel, with a zero line', () => {
    const r = trace(f, 'ser_ohm__residuals')
    expect(r).toMatchObject({ xaxis: 'x2', yaxis: 'y2', mode: 'markers' })
    expect(r.y).toEqual(Array.from(fit.residuals))
    expect(r.customdata!.map((c) => c[0])).toEqual([...fit.provenance.rowIdsUsed])
    expect(f.layout.xaxis2).toMatchObject({ matches: 'x', anchor: 'y2', title: { text: 'I (A)' } })
    expect(f.layout.xaxis2?.autorange).toBeUndefined()
    expect(f.layout.yaxis?.domain).toEqual([0.34, 1])
    expect(f.layout.yaxis2).toMatchObject({
      domain: [0, 0.24],
      anchor: 'x2',
      title: { text: 'figure.residual (V)' },
    })
    expect(f.layout.xaxis?.showticklabels).toBe(false)
    expect(f.layout.shapes).toEqual([
      expect.objectContaining({ type: 'line', yref: 'y2', y0: 0, y1: 0, xref: 'x2 domain' }),
    ])
  })

  it('no residual panel without the option or without an ok fit', () => {
    const off = buildFigure(
      ohmDerived({ scatter: { residualPanel: false, showExcluded: true } }, { fits: [fitSpec] }),
      figureContext(),
    )
    expect(off.layout.xaxis2).toBeUndefined()
    expect(traces(off).some((t) => t.uid === 'ser_ohm__residuals')).toBe(false)
    const tooFew = importCsv('x (s),y (m)\n1,2\n', 'ds_one')
    const bad = deriveOnce(
      [tooFew],
      plotOf({
        series: [series('ser_1', tooFew, 'x', 'y')],
        scatter: { residualPanel: true, showExcluded: true },
      }),
      { fits: [fitOf('f', 'ser_1')] },
    )
    expect(bad.series[0].fit?.status).toBe('error')
    const fb = buildFigure(bad, figureContext())
    expect(fb.layout.xaxis2).toBeUndefined()
    expect(traces(fb).map((t) => t.uid)).toEqual(['ser_1__points'])
  })

  it('an extended curve range is drawn dotted beyond the data and warned (W_EXTRAPOLATION)', () => {
    const ext = fitOf('fit_ohm', 'ser_ohm', { curveRange: { mode: 'extend', min: 0, max: 0.15 } })
    const fe = buildFigure(ohmDerived({}, { fits: [ext] }), figureContext())
    const solid = trace(fe, 'ser_ohm__fit')
    expect(solid.x[0]).toBe(0.01)
    expect(solid.x[solid.x.length - 1]).toBe(0.1)
    const dashed = trace(fe, 'ser_ohm__fitExtrapolation')
    expect((solid.line as { dash: string }).dash).toBe('solid')
    expect((dashed.line as { dash: string }).dash).toBe('dot')
    expect(dashed.x[0]).toBe(0)
    expect(dashed.x[dashed.x.length - 1]).toBe(0.15)
    expect(dashed.x.some(Number.isNaN)).toBe(true) // the two sides are separate segments
    expect(dashed.showlegend).toBe(false)
    expect(codes(fe)).toContain('W_EXTRAPOLATION')
    expect(fe.caption).toContain('figure.caption.extrapolation|{"pattern":"dot"}')
    expect(fe.issues.find((i) => i.code === 'W_EXTRAPOLATION')?.params).toEqual({
      series: 'V',
      pattern: 'dot',
    })
  })

  it('log-linear fits: the curve uses the basis (median curve) and residuals are in ln y', () => {
    const s = series('ser_c', cooling, 't', 'ΔT')
    const exp = fitOf('fit_c', 'ser_c', { model: { type: 'exponential' } })
    const dc = deriveOnce(
      [cooling],
      plotOf({ series: [s], scatter: { residualPanel: true, showExcluded: true } }),
      { fits: [exp] },
    )
    const fc = dc.series[0].fit as FitOk
    expect(fc.status).toBe('ok')
    const figC = buildFigure(dc, figureContext())
    const curve = trace(figC, 'ser_c__fit')
    curve.x.forEach((x, k) =>
      expect(curve.y[k]).toBeCloseTo(
        Math.exp(fc.basis.kind === 'logLinear' ? fc.basis.lnA + fc.basis.b * x : NaN),
        10,
      ),
    )
    expect(figC.layout.yaxis2?.title).toMatchObject({ text: 'figure.residualLn' })
    expect(
      figC.caption.some((l) => l.startsWith('figure.caption.fit|') && l.includes('ΔT = a·e^(b·t)')),
    ).toBe(true)
    expect(figC.caption).toContain('fit.logNote')
  })
})

describe('escaping of user text', () => {
  const ds = importCsv('<script>x</script> & %{y} (s),y (A&B)\n1,<b>2</b>\n2,4\n3,6\n', 'ds_esc')
  const s = series('ser_e', ds, '<script>x</script> & %{y}', 'y', { name: '<img src=x onerror=alert(1)>' })
  const f = buildFigure(deriveOnce([ds], plotOf({ title: '<i>T</i> %{x}', series: [s] })), figureContext())
  // What Plotly receives (a11y / caption / indicator are plain text for React, which escapes them itself).
  const all = JSON.stringify({ data: f.data, layout: f.layout })

  it('names, units, titles and hover text never reach Plotly as markup or template fields', () => {
    expect(f.a11y).toContain('<script>x</script>') // plain text, verbatim
    expect(all).not.toContain('<script>')
    expect(all).not.toContain('<img')
    expect(all).not.toContain('<i>T')
    expect(all).not.toContain('%{y}')
    expect(all).not.toContain('%{x} ')
    expect(f.layout.xaxis?.title).toMatchObject({
      text: '&lt;script&gt;x&lt;/script&gt; &amp; %&#123;y} (s)',
    })
    expect(f.layout.yaxis?.title).toMatchObject({ text: 'y (A&amp;B)' })
    expect(f.layout.title).toMatchObject({ text: '&lt;i&gt;T&lt;/i&gt; %&#123;x}' })
    const p = trace(f, 'ser_e__points')
    expect(p.name).toBe('&lt;img src=x onerror=alert(1)&gt;')
    expect(p.hovertemplate).toContain('&lt;script&gt;x&lt;/script&gt; &amp; %&#123;y} = %{customdata[2]}')
    expect(p.hovertemplate).toContain(' A&amp;B<br>')
  })
})

describe('histogram', () => {
  const plot = plotOf({
    type: 'histogram',
    histogram: {
      datasetId: pendulum.dataset.id,
      value: pendulum.col('T'),
      bins: { mode: 'auto' },
      groupBy: null,
      groupMode: 'overlay',
    },
  })
  const f = buildFigure(deriveOnce([pendulum], plot), figureContext())
  const h = trace(f, 'plot_1__histogram')

  it("is a 'bar' trace drawn from our counts (never Plotly binning); Σ counts = n and the maximum counts", () => {
    expect(h.type).toBe('bar')
    expect(h.xbins).toBeUndefined()
    expect(h.nbinsx).toBeUndefined()
    expect(h.y.reduce((a, b) => a + b, 0)).toBe(24)
    const widths = h.width as number[]
    const lastRight = h.x[h.x.length - 1] + widths[widths.length - 1] / 2
    expect(lastRight).toBeGreaterThanOrEqual(1.98)
    expect(h.y[h.y.length - 1]).toBeGreaterThan(0) // the bin holding 1.98
    expect(f.layout.bargap).toBe(0)
    expect(f.layout.yaxis?.title).toMatchObject({ text: 'figure.axis.count' })
    expect(f.caption.some((l) => l.startsWith('figure.caption.histogram|'))).toBe(true)
    expect(f.a11y).toContain('figure.a11y.histogram')
  })

  it('a maximum exactly on the last edge is counted (bins [a, b) and the last one [a, b])', () => {
    const ds = importCsv('v (m)\n0\n1\n2\n3\n4\n', 'ds_edge')
    const ph = plotOf({
      type: 'histogram',
      histogram: {
        datasetId: ds.dataset.id,
        value: ds.col('v'),
        bins: { mode: 'width', width: 1, start: 0 },
        groupBy: null,
        groupMode: 'overlay',
      },
    })
    const fh = buildFigure(deriveOnce([ds], ph), figureContext())
    const t = trace(fh, 'plot_1__histogram')
    expect(t.y).toEqual([1, 1, 1, 2])
    expect(t.hovertemplate![3]).toContain('[3, 4]')
    expect(t.hovertemplate![0]).toContain('[0, 1)')
  })

  it('log scales are refused for bars (I_BAR_LINEAR_ONLY); no data → E_HISTOGRAM_NO_DATA; no column → E_PLOT_NOT_CONFIGURED', () => {
    const log = buildFigure(
      deriveOnce([pendulum], { ...plot, yAxis: { ...plot.yAxis, scale: 'log' } }),
      figureContext(),
    )
    expect(codes(log)).toContain('I_BAR_LINEAR_ONLY')
    expect(log.layout.yaxis?.type).toBe('linear')
    const empty = importCsv('v (m),w (m)\nNA,1\n,2\n', 'ds_empty')
    const fe = buildFigure(
      deriveOnce(
        [empty],
        plotOf({
          type: 'histogram',
          histogram: {
            datasetId: empty.dataset.id,
            value: empty.col('v'),
            bins: { mode: 'auto' },
            groupBy: null,
            groupMode: 'overlay',
          },
        }),
      ),
      figureContext(),
    )
    expect(fe.data).toEqual([])
    expect(codes(fe)).toEqual(['E_HISTOGRAM_NO_DATA'])
    const unconf = buildFigure(deriveOnce([pendulum], plotOf({ type: 'histogram' })), figureContext())
    expect(unconf.data).toEqual([])
    expect(codes(unconf)).toEqual(['E_PLOT_NOT_CONFIGURED'])
  })
})

describe('box plot (pendulum, by observer)', () => {
  const B = ref('pendulum.json').observerB
  const boxPlot = (points: 'all' | 'outliers' | 'none' = 'all', showMean = false) =>
    plotOf({
      type: 'box',
      box: {
        datasetId: pendulum.dataset.id,
        value: pendulum.col('T'),
        groupBy: pendulum.col('observer'),
        points,
        showMean,
        colorByGroup: false,
      },
    })
  const f = buildFigure(deriveOnce([pendulum], boxPlot()), figureContext())
  const box = trace(f, 'plot_1__box')

  it('uses our type-7 quartiles and whiskers = adjacent observed values (never the fences)', () => {
    expect(box.type).toBe('box')
    expect(box.boxpoints).toBe(false)
    expect(box.x).toEqual([0, 1])
    expect(box.q3).toEqual([
      quantile7(sortedCopy([1.7, 1.75, 1.76, 1.7, 1.72, 1.7, 1.78, 1.72, 1.76, 1.74, 1.75, 1.7]), 0.75),
      expect.any(Number),
    ])
    expect((box.q1 as number[])[1]).toBeCloseTo(Number(B.q1), 12)
    expect((box.median as number[])[1]).toBeCloseTo(Number(B.median), 12)
    expect((box.q3 as number[])[1]).toBeCloseTo(Number(B.q3), 12)
    expect((box.lowerfence as number[])[1]).toBe(1.61)
    expect((box.upperfence as number[])[1]).toBe(1.83)
    expect((box.upperfence as number[])[1]).not.toBeCloseTo(Number(B.fences[1]), 3)
    expect(box.hoverinfo).toBe('skip')
    expect(box.mean).toBeUndefined()
    expect(f.layout.xaxis).toMatchObject({ tickvals: [0, 1], ticktext: ['A', 'B'] })
  })

  it('observations are an overlaid scatter with deterministic jitter; the outlier 1.98 is a point', () => {
    const pts = trace(f, 'plot_1__boxPoints')
    expect(pts.mode).toBe('markers')
    expect(pts.y).toHaveLength(24)
    expect(pts.y).toContain(1.98)
    const k = pts.y.indexOf(1.98)
    expect(Math.abs(pts.x[k] - 1)).toBeLessThanOrEqual(0.15)
    expect(pts.customdata![k][4]).toContain('table.outlierCandidate')
    const again = trace(buildFigure(deriveOnce([pendulum], boxPlot()), figureContext()), 'plot_1__boxPoints')
    expect(again.x).toEqual(pts.x)
    const outliers = trace(
      buildFigure(deriveOnce([pendulum], boxPlot('outliers')), figureContext()),
      'plot_1__boxPoints',
    )
    expect(outliers.y).toEqual([1.98])
    const none = buildFigure(deriveOnce([pendulum], boxPlot('none')), figureContext())
    expect(traces(none).some((t) => t.uid === 'plot_1__boxPoints')).toBe(false)
  })

  it('the hover uses the panel terms (whisker ends vs Tukey fences); the mean is optional', () => {
    const stats = trace(f, 'plot_1__boxStats')
    const q = (v: number) => formatStat('quartile', v, { dataDecimals: 2, loc: { decimal: '.' } })
    const fences = [1.7125 - 1.5 * (1.8025 - 1.7125), 1.8025 + 1.5 * (1.8025 - 1.7125)]
    expect(stats.hovertemplate![1]).toContain('figure.hover.whiskers = [1.61; 1.83] s')
    // Whisker ends are observations, written as recorded: observer A's lowest time is "1.70", not "1.7".
    expect(stats.hovertemplate![0]).toContain('figure.hover.whiskers = [1.70; 1.78] s')
    const comma = figureContext({ loc: { decimal: ',' } })
    const statsIt = trace(buildFigure(deriveOnce([pendulum], boxPlot()), comma), 'plot_1__boxStats')
    expect(statsIt.hovertemplate![0]).toContain('figure.hover.whiskers = [1,70; 1,78] s')
    // The same formatting as the statistics panel (formatStat 'quartile', one digit more than the data).
    expect(stats.hovertemplate![1]).toContain(`stats.fences = [${q(fences[0])}; ${q(fences[1])}] s`)
    expect(stats.hovertemplate![1]).toContain('stats.q3 = 1.803')
    const withMean = trace(
      buildFigure(deriveOnce([pendulum], boxPlot('all', true)), figureContext()),
      'plot_1__box',
    )
    expect(withMean.boxmean).toBe(true)
    expect((withMean.mean as number[])[1]).toBeCloseTo(Number(B.mean), 12)
  })

  it('a group with fewer than 4 values has no box but keeps its points (I_QUARTILES_NEED_4)', () => {
    const ds = importCsv('g,v (m)\na,1\na,2\na,3\na,4\nb,5\nb,6\n', 'ds_small')
    const fs = buildFigure(
      deriveOnce(
        [ds],
        plotOf({
          type: 'box',
          box: {
            datasetId: ds.dataset.id,
            value: ds.col('v'),
            groupBy: ds.col('g'),
            points: 'none',
            showMean: false,
            colorByGroup: false,
          },
        }),
      ),
      figureContext(),
    )
    expect(trace(fs, 'plot_1__box').x).toEqual([0])
    expect(trace(fs, 'plot_1__boxPoints').y).toEqual([5, 6])
    expect(fs.issues.find((i) => i.code === 'I_QUARTILES_NEED_4')).toMatchObject({
      params: { n: 2, group: 'b' },
    })
  })
})

describe('bar plots', () => {
  const meanPlot = (spread: 'none' | 'sd' | 'sem' = 'sd') =>
    plotOf({
      type: 'bar',
      bar: {
        datasetId: pendulum.dataset.id,
        category: pendulum.col('observer'),
        value: pendulum.col('T'),
        showObservations: true,
        colorByCategory: false,
        aggregate: 'mean',
        spread: { kind: spread },
      },
    })

  it('mean per category with SD bars (n − 1) from 0, and the observations overlaid', () => {
    const A = ref('pendulum.json').observerA
    const f = buildFigure(deriveOnce([pendulum], meanPlot()), figureContext())
    const b = trace(f, 'plot_1__bar')
    expect(b).toMatchObject({ type: 'bar', base: 0 })
    expect(b.y[0]).toBeCloseTo(Number(A.mean), 12)
    expect((b.error_y as { array: number[] }).array[0]).toBeCloseTo(Number(A.sd), 12)
    expect(b.name).toBe('style.aggregates.mean, uncertainty.label.sd|{"grouping":"column","n":12}')
    expect(trace(f, 'plot_1__barPoints').y).toHaveLength(24)
    expect(f.selectionMap.byRow.get(1)).toEqual([
      { uid: 'plot_1__bar', pointIndex: 0 },
      { uid: 'plot_1__barPoints', pointIndex: 0 },
    ])
    const none = trace(buildFigure(deriveOnce([pendulum], meanPlot('none')), figureContext()), 'plot_1__bar')
    expect(none.error_y).toBeUndefined()
  })

  it('one value per category: each bar names its source row, or its sheet column when transposed', () => {
    const ds = importCsv('g,m (g)\nA,2.5\nB,1.0\n', 'ds_rows')
    const plot = (d: Imported) =>
      plotOf({
        type: 'bar',
        bar: {
          datasetId: d.dataset.id,
          category: d.col('g'),
          value: d.col('m'),
          showObservations: false,
          colorByCategory: false,
          aggregate: 'none',
          uncertainty: { kind: 'none' },
        },
      })
    const hover = (d: Imported) =>
      trace(buildFigure(deriveOnce([d], plot(d)), figureContext()), 'plot_1__bar').hovertemplate as string[]
    expect(hover(ds)[1]).toContain('figure.hover.row|{"row":3}')
    const sheet = transpose(ds, 2) // header in column B, values in C and D
    expect(hover(sheet)[0]).toContain('figure.hover.column|{"column":"C"}')
    expect(hover(sheet)[1]).toContain('figure.hover.column|{"column":"D"}')
  })

  it('spread bars: identical values → zero-length bar + I_ZERO_SPREAD; pairs with a CI → W_GROUP_PAIR_CI with t as shown', () => {
    const ds = importCsv('g,m (g)\nA,2.5\nA,2.5\nA,2.5\nB,1.0\nB,1.4\nC,3.0\nC,3.6\nC,3.3\n', 'ds_spread')
    const plot = (spread: { kind: 'sd' } | { kind: 'ci'; level: 0.9 | 0.95 | 0.99; method: 't' }) =>
      plotOf({
        type: 'bar',
        bar: {
          datasetId: ds.dataset.id,
          category: ds.col('g'),
          value: ds.col('m'),
          showObservations: false,
          colorByCategory: false,
          aggregate: 'mean',
          spread,
        },
      })
    const sd = buildFigure(deriveOnce([ds], plot({ kind: 'sd' })), figureContext())
    expect((trace(sd, 'plot_1__bar').error_y as { array: number[] }).array[0]).toBe(0)
    expect(sd.issues.find((i) => i.code === 'I_ZERO_SPREAD')).toEqual({
      code: 'I_ZERO_SPREAD',
      severity: 'info',
      params: { scope: 'groups', count: 1, n: 3 },
      rows: [1, 2, 3],
    })
    const ci = buildFigure(deriveOnce([ds], plot({ kind: 'ci', level: 0.9, method: 't' })), figureContext())
    expect(ci.issues.find((i) => i.code === 'W_GROUP_PAIR_CI')).toMatchObject({
      params: { count: 1, t: 6.314, level: 90 },
      rows: [4, 5],
    })
    // The pendulum observers both have a real spread.
    expect(codes(buildFigure(deriveOnce([pendulum], meanPlot()), figureContext()))).not.toContain(
      'I_ZERO_SPREAD',
    )
    // A category of two identical values has a zero-width CI: I_ZERO_SPREAD, not "very wide".
    const twin = importCsv('g,m (g)\nA,2.5\nA,2.5\nC,3.0\nC,3.6\nC,3.3\n', 'ds_twin')
    const twinCi = buildFigure(
      deriveOnce(
        [twin],
        plotOf({
          type: 'bar',
          bar: {
            datasetId: twin.dataset.id,
            category: twin.col('g'),
            value: twin.col('m'),
            showObservations: false,
            colorByCategory: false,
            aggregate: 'mean',
            spread: { kind: 'ci', level: 0.95, method: 't' },
          },
        }),
      ),
      figureContext(),
    )
    expect(codes(twinCi)).toContain('I_ZERO_SPREAD')
    expect(codes(twinCi)).not.toContain('W_GROUP_PAIR_CI')
  })

  it('a log value axis is not available (I_BAR_LINEAR_ONLY)', () => {
    const p = meanPlot()
    const f = buildFigure(
      deriveOnce([pendulum], { ...p, yAxis: { ...p.yAxis, scale: 'log' } }),
      figureContext(),
    )
    expect(codes(f)).toContain('I_BAR_LINEAR_ONLY')
    expect(f.layout.yaxis?.type).toBe('linear')
    // A log left on the categorical x axis (from a scatter plot, no control here) is not reported.
    const logX = buildFigure(
      deriveOnce([pendulum], { ...p, xAxis: { ...p.xAxis, scale: 'log' } }),
      figureContext(),
    )
    expect(codes(logX)).not.toContain('I_BAR_LINEAR_ONLY')
    expect(logX.layout.xaxis?.type).toBe('linear')
  })

  it("aggregate 'none' refuses repeated categories (E_DUPLICATE_CATEGORY), one bar per row otherwise", () => {
    const p = meanPlot()
    const dup = buildFigure(
      deriveOnce([pendulum], {
        ...p,
        bar: {
          datasetId: pendulum.dataset.id,
          category: pendulum.col('observer'),
          value: pendulum.col('T'),
          showObservations: false,
          colorByCategory: false,
          aggregate: 'none',
          uncertainty: { kind: 'none' },
        },
      }),
      figureContext(),
    )
    expect(dup.data).toEqual([])
    expect(codes(dup)).toContain('E_DUPLICATE_CATEGORY')
    const ds = importCsv('sample,m (g),u (g)\nA,1.5,0.1\nB,2.5,0.2\nC,0.5,0.1\n', 'ds_bars')
    const ok = buildFigure(
      deriveOnce([ds], {
        ...p,
        bar: {
          datasetId: ds.dataset.id,
          category: ds.col('sample'),
          value: ds.col('m'),
          showObservations: false,
          colorByCategory: false,
          aggregate: 'none',
          uncertainty: {
            kind: 'measurement',
            origin: 'user',
            source: { type: 'column', column: ds.col('u') },
            meaning: { type: 'standard' },
          },
        },
      }),
      figureContext(),
    )
    const b = trace(ok, 'plot_1__bar')
    expect(b.y).toEqual([1.5, 2.5, 0.5])
    expect((b.error_y as { array: number[] }).array).toEqual([0.1, 0.2, 0.1])
    expect(b.customdata!.map((c) => c[0])).toEqual([1, 2, 3])
    expect(ok.layout.xaxis).toMatchObject({ ticktext: ['A', 'B', 'C'] })
  })
})

describe('replicate group means (Beer–Lambert, SD by identical x)', () => {
  const groupsRef = ref('beerLambert.json').groups as { c: string; n: number; mean: string; sd: string }[]
  const s = series('ser_b', beer, 'c', 'A', {
    errorBars: { x: { kind: 'none' }, y: { kind: 'sd', grouping: { by: 'sameX' } }, visible: true },
  })
  const d = deriveOnce([beer], plotOf({ series: [s] }), { fits: [fitOf('fit_b', 'ser_b')] })
  const f = buildFigure(d, figureContext())

  it('bars live only on the group-means trace; the observations keep no replicate bars', () => {
    const gm = trace(f, 'ser_b__groupMeans')
    expect(gm.x).toEqual(groupsRef.map((g) => Number(g.c)))
    gm.y.forEach((v, k) => expect(v).toBeCloseTo(Number(groupsRef[k].mean), 12))
    const ey = gm.error_y as { array: number[] }
    ey.array.forEach((v, k) => expect(v).toBeCloseTo(Number(groupsRef[k].sd), 12))
    expect((gm.marker as { symbol: string }).symbol).toBe('diamond')
    expect(gm.name).toContain('legend.groupMeans|')
    expect(gm.showlegend).toBe(true)
    expect(trace(f, 'ser_b__points').error_y).toBeUndefined()
    expect(trace(f, 'ser_b__points').x).toHaveLength(18)
    // The fit uses the 18 observations, not the 6 means — and says so.
    expect((d.series[0].fit as FitOk).provenance.nUsed).toBe(18)
    expect(f.caption).toContain('uncertainty.groupMeansNote|{"n":18}')
    // Selecting a mean selects its member rows.
    expect(f.selectionMap.byRow.get(1)).toContainEqual({ uid: 'ser_b__groupMeans', pointIndex: 0 })
  })
})

describe('line plots', () => {
  const ds = importCsv('t (s),v (m/s)\n0,1\n1,2\n2,\n3,4\n4,\n5,6\n6,7\n', 'ds_l')
  const linePlot = (markers: boolean) =>
    plotOf({ type: 'line', series: [series('ser_l', ds, 't', 'v')], line: { markers, sortByX: false } })

  it('breaks at missing values (never interpolated) with an explicit mode', () => {
    const f = buildFigure(deriveOnce([ds], linePlot(true)), figureContext())
    const l = trace(f, 'ser_l__points')
    expect(l.mode).toBe('lines+markers')
    expect(l.connectgaps).toBe(false)
    expect(l.x).toEqual([0, 1, NaN, 3, NaN, 5, 6])
    expect(l.y).toEqual([1, 2, NaN, 4, NaN, 6, 7])
  })

  it('without markers an isolated point keeps a marker so it does not vanish', () => {
    const f = buildFigure(deriveOnce([ds], linePlot(false)), figureContext())
    const l = trace(f, 'ser_l__points')
    expect(l.mode).toBe('lines+markers')
    expect((l.marker as { size: number[] }).size).toEqual([0, 0, 0, 7, 0, 0, 0])
    const ds2 = importCsv('t (s),v (m/s)\n0,1\n1,2\n2,3\n', 'ds_l2')
    const f2 = buildFigure(
      deriveOnce(
        [ds2],
        plotOf({
          type: 'line',
          series: [series('ser_l', ds2, 't', 'v')],
          line: { markers: false, sortByX: false },
        }),
      ),
      figureContext(),
    )
    expect(trace(f2, 'ser_l__points').mode).toBe('lines')
  })
})

describe('distinguishable series and fits', () => {
  type Line = { color: string; width: number; dash: string }
  const line = (f: FigureOut, uid: string) => trace(f, uid).line as Line
  const style = (over: Partial<SeriesStyle>): SeriesStyle => ({ ...DEFAULT_SERIES_STYLE, ...over })
  const allBands = { curve: true, confidenceBand: true, predictionBand: true, residuals: false }
  const extend = { mode: 'extend', min: -4, max: 36 } as const
  const tSeries = series('ser_a', cooling, 't', 'T')
  const dtSeries = series('ser_b', cooling, 't', 'ΔT', { style: style({ paletteIndex: 1 }) })
  const coolingFits = [
    fitOf('fit_a', 'ser_a', { show: allBands, curveRange: extend }),
    fitOf('fit_b', 'ser_b', { show: allBands, curveRange: extend }),
  ]
  const withoutPredictionBand = coolingFits.map((f) => ({ ...f, show: { ...f.show, predictionBand: false } }))
  const cool = (plotOver: Partial<PlotSpec>, extra: Parameters<typeof deriveOnce>[2] = {}) =>
    deriveOnce([cooling], plotOf({ series: [tSeries, dtSeries], ...plotOver }), {
      fits: coolingFits,
      ...extra,
    })

  it('scatter plot: the fit is the only line, solid and 2.25 px in the series colour', () => {
    const f = buildFigure(ohmDerived(), figureContext())
    expect(line(f, 'ser_ohm__fit')).toEqual({
      color: SERIES_COLORS[0],
      width: FIT_WIDTH_ALONE,
      dash: 'solid',
    })
  })

  it('line plot: the fit is dashed over a solid data line, solid over a patterned one; the extrapolation differs from both', () => {
    const f = buildFigure(cool({ type: 'line' }), figureContext())
    // Auto dashes by position: the first series is solid, the second dashed.
    expect(line(f, 'ser_a__points').dash).toBe('solid')
    expect(line(f, 'ser_a__fit')).toEqual({ color: SERIES_COLORS[0], width: 2, dash: 'dash' })
    // Never dotted next to the prediction band (its outline is dotted); dotted without it.
    expect(line(f, 'ser_a__fitExtrapolation').dash).toBe('dashdot')
    const noBand = cool({ type: 'line' }, { fits: withoutPredictionBand })
    expect(line(buildFigure(noBand, figureContext()), 'ser_a__fitExtrapolation').dash).toBe('dot')
    expect(line(f, 'ser_b__points').dash).toBe('dash')
    expect(line(f, 'ser_b__fit')).toEqual({ color: SERIES_COLORS[1], width: 2, dash: 'solid' })
    const dotted = { ...dtSeries, style: style({ paletteIndex: 1, lineDash: 'dot' }) }
    const g = buildFigure(cool({ type: 'line', series: [tSeries, dotted] }), figureContext())
    expect(line(g, 'ser_b__fit').dash).toBe('solid')
    expect(line(g, 'ser_b__fitExtrapolation').dash).toBe('dashdot')
    // The same series on a scatter plot: no data line, so solid fits.
    const sc = buildFigure(cool({ type: 'scatter' }), figureContext())
    expect(line(sc, 'ser_a__fit')).toEqual({ color: SERIES_COLORS[0], width: FIT_WIDTH_ALONE, dash: 'solid' })
    expect(line(sc, 'ser_b__fit').dash).toBe('solid')
  })

  it('with several series the caption says which series each extrapolation pattern belongs to', () => {
    // ser_b draws its DATA line dotted while ser_a's extrapolation is dotted: an unattributed "Dotted
    // curve: extrapolation" would also describe ser_b's data. (No prediction band: with it, no
    // extrapolation is dotted.)
    const dotted = { ...dtSeries, style: style({ paletteIndex: 1, lineDash: 'dot' }) }
    const exportCtx = figureContext({ mode: 'export', size: { width: 1000, height: 650 } })
    const fits = { fits: withoutPredictionBand }
    const g = buildFigure(cool({ type: 'line', series: [tSeries, dotted] }, fits), exportCtx)
    const extrapolation = (f: FigureOut) =>
      f.caption.filter((l) => l.includes('figure.caption.extrapolation'))
    expect(extrapolation(g)).toEqual([
      'T: figure.caption.extrapolation|{"pattern":"dot"}',
      'ΔT: figure.caption.extrapolation|{"pattern":"dashdot"}',
    ])
    // Series sharing a pattern share the line.
    expect(extrapolation(buildFigure(cool({ type: 'line' }, fits), exportCtx))).toEqual([
      'T, ΔT: figure.caption.extrapolation|{"pattern":"dot"}',
    ])
    const en = buildFigure(
      cool({ type: 'line', series: [tSeries, dotted] }, fits),
      figureContext({ ...exportCtx, t: makeTranslator('en') }),
    )
    expect(en.caption).toContain('ΔT: Dash-dot curve: extrapolation beyond the data.')
    // One series shown: no name needed.
    const hidden = { ...dtSeries, visible: false }
    expect(
      extrapolation(buildFigure(cool({ type: 'line', series: [tSeries, hidden] }, fits), exportCtx)),
    ).toEqual(['figure.caption.extrapolation|{"pattern":"dot"}'])
  })

  it('an explicit fit style wins: palette colour, dash and width; the bands keep the series colour', () => {
    const own = fitOf('fit_ohm', 'ser_ohm', {
      show: allBands,
      style: { color: { mode: 'palette', index: 6 }, dash: 'longdash', width: 3 },
    })
    const f = buildFigure(ohmDerived({}, { fits: [own] }), figureContext())
    expect(line(f, 'ser_ohm__fit')).toEqual({ color: '#882255', width: 3, dash: 'longdash' })
    expect(trace(f, 'ser_ohm__band').fillcolor).toBe(withAlpha(SERIES_COLORS[0], 0.12))
  })

  it('the fit style changes only the drawing: same fit object, sample and curve values', () => {
    const derive = createDeriver()
    const fitWith = (style: FitSpec['style']) => [fitOf('fit_ohm', 'ser_ohm', { style })]
    const doc = (style: FitSpec['style']) =>
      docOf([ohm], plotOf({ series: [ohmSeries()] }), { fits: fitWith(style) })
    const raw = rawTablesOf([ohm])
    const a = derive(doc({ color: { mode: 'series' }, dash: 'auto', width: 2 }), raw)
    const b = derive(doc({ color: { mode: 'palette', index: 7 }, dash: 'dot', width: 4 }), raw)
    expect(b.series[0].fit).toBe(a.series[0].fit)
    expect(b.series[0].data.sample).toBe(a.series[0].data.sample)
    const fa = trace(buildFigure(a, figureContext()), 'ser_ohm__fit')
    const fb = trace(buildFigure(b, figureContext()), 'ser_ohm__fit')
    expect(fb.y).toEqual(fa.y)
    expect(fb.line).toEqual({ color: '#000000', width: 4, dash: 'dot' })
  })

  it('bands are tinted with the series colour: confidence 12 %, prediction 6 % inside a dotted outline', () => {
    const f = buildFigure(cool({}), figureContext())
    const c = SERIES_COLORS[1]
    expect(trace(f, 'ser_b__band').fillcolor).toBe(withAlpha(c, 0.12))
    expect(line(f, 'ser_b__band')).toEqual({ color: c, width: 0 })
    expect(trace(f, 'ser_b__predictionBand').fillcolor).toBe(withAlpha(c, 0.06))
    expect(trace(f, 'ser_b__predictionBand').fill).toBe('tonexty')
    for (const uid of ['ser_b__predictionBand', 'ser_b__predictionBandLower'])
      expect(line(f, uid)).toEqual({ color: c, width: 1, dash: 'dot' })
    expect(trace(f, 'ser_a__predictionBand').fillcolor).toBe(withAlpha(SERIES_COLORS[0], 0.06))
  })

  it('with several series the band and excluded legend entries name their series; with one they do not', () => {
    const exclusions = [exclusionOf('e', cooling, [3])]
    const f = buildFigure(cool({}, { exclusions }), figureContext())
    expect(trace(f, 'ser_a__band').name).toBe('legend.band.confidenceOf|{"level":95,"series":"T"}')
    expect(trace(f, 'ser_b__predictionBand').name).toBe('legend.band.predictionOf|{"level":95,"series":"ΔT"}')
    expect(trace(f, 'ser_a__excluded').name).toBe('legend.excludedOf|{"n":1,"series":"T"}')
    const en = buildFigure(cool({}, { exclusions }), figureContext({ t: makeTranslator('en') }))
    expect(trace(en, 'ser_b__band').name).toBe('ΔT: 95 % confidence band')
    expect(trace(en, 'ser_a__excluded').name).toBe('T: excluded (n = 1)')
    const it = buildFigure(cool({}, { exclusions }), figureContext({ t: makeTranslator('it') }))
    expect(trace(it, 'ser_b__predictionBand').name).toBe('ΔT: banda di predizione 95 %')
    expect(trace(it, 'ser_a__excluded').name).toBe('T: escluse (n = 1)')
    // An export without the hidden series shows one series: the entries need no series name.
    const hidden = { ...dtSeries, visible: false }
    const one = buildFigure(
      cool({ series: [tSeries, hidden] }, { exclusions }),
      figureContext({ mode: 'export', size: { width: 1000, height: 650 } }),
    )
    expect(trace(one, 'ser_a__band').name).toBe('legend.band.confidence|{"level":95}')
    expect(trace(one, 'ser_a__excluded').name).toBe('legend.excluded|{"n":1}')
  })

  it('the 7th series is drawn with the x symbol and the 7th colour; 7 series of the same columns keep 7 names', () => {
    const seven = Array.from({ length: 7 }, (_, i) =>
      series(`ser_${i}`, ohm, 'I', 'V', { style: style({ paletteIndex: i }) }),
    )
    const f = buildFigure(
      deriveOnce([ohm], plotOf({ series: seven })),
      figureContext({ t: makeTranslator('en') }),
    )
    const marker = trace(f, 'ser_6__points').marker as { symbol: string; color: string }
    expect(marker).toMatchObject({ symbol: 'x', color: '#882255' })
    const names = seven.map((s) => trace(f, `${s.id}__points`).name)
    expect(names[0]).toBe('V vs I (1)')
    expect(new Set(names).size).toBe(7)
    const open = seven.map((s, i) => (i === 6 ? { ...s, style: style({ paletteIndex: 6, open: true }) } : s))
    const g = buildFigure(deriveOnce([ohm], plotOf({ series: open })), figureContext())
    expect((trace(g, 'ser_6__points').marker as { symbol: string }).symbol).toBe('x-open')
  })

  it('legend, indicator, caption and accessible summary name the series with the same labels', () => {
    const vsT = series('ser_a', cooling, 't', 'T')
    const vsDT = series('ser_b', cooling, 'ΔT', 'T', { style: style({ paletteIndex: 1 }) })
    const fits = [fitOf('fit_a', 'ser_a'), fitOf('fit_b', 'ser_b')]
    const f = buildFigure(
      deriveOnce([cooling], plotOf({ series: [vsT, vsDT] }), { fits }),
      figureContext({ t: makeTranslator('en'), mode: 'export', size: { width: 1000, height: 650 } }),
    )
    expect(trace(f, 'ser_a__points').name).toBe('T vs t')
    expect(trace(f, 'ser_b__points').name).toBe('T vs ΔT')
    expect(trace(f, 'ser_b__fit').name).toBe('T vs ΔT: linear fit')
    expect(f.indicator).toMatch(/^T vs t: .*; T vs ΔT: /)
    expect(f.caption.some((l) => l.startsWith('T vs ΔT: '))).toBe(true)
    expect(f.a11y).toContain('T vs t')
    expect(f.a11y).toContain('T vs ΔT')
  })
})

describe('series visibility and export', () => {
  const s1 = ohmSeries()
  const s2 = series('ser_2', ohm, 'I', 'V', {
    name: 'Hidden copy',
    visible: false,
    style: { ...ohmSeries().style, paletteIndex: 1 },
  })
  const plot = plotOf({ series: [s1, s2] })
  const extra = { fits: [ohmFit, fitOf('fit_2', 'ser_2')], exclusions: [exclusionOf('e', ohm, [3])] }
  const d = deriveOnce([ohm], plot, extra)
  const exportCtx = () => figureContext({ mode: 'export', size: { width: 1000, height: 650 } })

  it("hidden series stay in the screen legend as 'legendonly' (with their fit)", () => {
    const f = buildFigure(d, figureContext())
    expect(trace(f, 'ser_2__points').visible).toBe('legendonly')
    expect(trace(f, 'ser_2__fit').visible).toBe('legendonly')
    expect(trace(f, 'ser_ohm__points').visible).toBe(true)
    expect(f.layout.annotations).toBeUndefined()
  })

  it('export omits hidden series and their fits and always carries the indicator', () => {
    const f = buildFigure(d, exportCtx())
    expect(traces(f).some((t) => t.uid.startsWith('ser_2__'))).toBe(false)
    expect(f.layout).toMatchObject({ width: 1000, height: 650, autosize: false })
    const ann = f.layout.annotations as { name: string; text: string }[]
    expect(ann.find((a) => a.name === 'indicator')?.text).toBe(f.indicator)
    expect(f.indicator).toContain('figure.indicator.excluded|{"n":1}')
    const cap = ann.find((a) => a.name === 'caption')!.text
    expect(cap).toContain('V = b₀ + b₁·I')
    // Row 3 is excluded: the fit (and the caption) use the 9 remaining rows.
    const slope = (d.series[0].fit as FitOk).params[1]
    expect(cap).toContain(`b₁ = (${formatWithUncertainty(slope.value, slope.se, { decimal: '.' }).text}) V/A`)
    expect(cap).toContain('b₁ = (47.13 ± 0.08) V/A')
    expect(cap).toContain('"n":9')
    // Caption switched off: the indicator is still drawn.
    const noCaption = buildFigure(
      deriveOnce([ohm], { ...plot, export: { ...plot.export, caption: false } }, extra),
      exportCtx(),
    )
    const ann2 = noCaption.layout.annotations as { name: string }[]
    expect(ann2.map((a) => a.name)).toEqual(['indicator'])
  })

  it('an export without exclusions or fit has no indicator', () => {
    const plain = buildFigure(
      deriveOnce([ohm], plotOf({ series: [ohmSeries()], export: { ...plot.export, caption: false } })),
      exportCtx(),
    )
    expect(plain.indicator).toBeNull()
    expect(plain.layout.annotations).toEqual([])
  })
})

describe('configuration problems and scale', () => {
  it('no series → empty data and E_PLOT_NOT_CONFIGURED; no plot at all too', () => {
    const f = buildFigure(deriveOnce([ohm], plotOf()), figureContext())
    expect(f.data).toEqual([])
    expect(codes(f)).toEqual(['E_PLOT_NOT_CONFIGURED'])
    expect(f.a11y).toBe('figure.a11y.empty')
    const none = buildFigure(createDeriver()(docOf([ohm], null), rawTablesOf([ohm])), figureContext())
    expect(codes(none)).toEqual(['E_PLOT_NOT_CONFIGURED'])
  })

  it('a label column on an axis → E_COLUMN_NOT_NUMERIC and nothing drawn', () => {
    const f = buildFigure(
      deriveOnce([pendulum], plotOf({ series: [series('ser_p', pendulum, 'trial', 'observer')] })),
      figureContext(),
    )
    expect(f.data).toEqual([])
    expect(f.issues).toEqual([
      expect.objectContaining({ code: 'E_COLUMN_NOT_NUMERIC', params: { column: 'observer' } }),
    ])
  })

  it(`more than ${MANY_POINTS} markers → W_MANY_POINTS, and every point is still drawn`, () => {
    const rows = Array.from({ length: 6000 }, (_, i) => `${i},${(i * 0.5) % 97}`).join('\n')
    const big = importCsv(`x (s),y (m)\n${rows}\n`, 'ds_big')
    const f = buildFigure(
      deriveOnce([big], plotOf({ series: [series('ser_big', big, 'x', 'y')] })),
      figureContext(),
    )
    expect(trace(f, 'ser_big__points').x).toHaveLength(6000)
    expect(f.issues.find((i) => i.code === 'W_MANY_POINTS')).toMatchObject({ params: { count: 6000 } })
  })

  it('datetime columns get a date axis', () => {
    const ds = importCsv('date,T (°C)\n2026-01-01,1\n2026-01-02,3\n2026-01-03,2\n', 'ds_date')
    const f = buildFigure(
      deriveOnce([ds], plotOf({ series: [series('ser_d', ds, 'date', 'T')] })),
      figureContext(),
    )
    expect(f.layout.xaxis?.type).toBe('date')
    expect(trace(f, 'ser_d__points').x[0]).toBe(Date.UTC(2026, 0, 1))
  })

  it('a log scale requested on a date axis is drawn linear and says so (I_DATE_AXIS_LINEAR); y keeps its log', () => {
    const ds = importCsv('date,T (°C)\n2026-01-01,1\n2026-01-02,3\n2026-01-03,2\n', 'ds_date')
    const p = plotOf({ series: [series('ser_d', ds, 'date', 'T')] })
    const logBoth = {
      ...p,
      xAxis: { ...p.xAxis, scale: 'log' },
      yAxis: { ...p.yAxis, scale: 'log' },
    } as const
    const f = buildFigure(deriveOnce([ds], logBoth), figureContext())
    expect(f.layout.xaxis?.type).toBe('date')
    expect(f.layout.yaxis?.type).toBe('log')
    expect(f.issues.filter((i) => i.code === 'I_DATE_AXIS_LINEAR')).toEqual([
      { code: 'I_DATE_AXIS_LINEAR', severity: 'info', params: { axis: 'x' } },
    ])
    // Linear date axis, or a log scale on a numeric axis: nothing to report.
    expect(codes(buildFigure(deriveOnce([ds], p), figureContext()))).not.toContain('I_DATE_AXIS_LINEAR')
    expect(
      codes(buildFigure(ohmDerived({ xAxis: { ...p.xAxis, scale: 'log' } }), figureContext())),
    ).not.toContain('I_DATE_AXIS_LINEAR')
    // A date column on y with a log y scale: reported for y.
    const onY = plotOf({ series: [series('ser_d', ds, 'T', 'date')] })
    const fy = buildFigure(
      deriveOnce([ds], { ...onY, yAxis: { ...onY.yAxis, scale: 'log' } }),
      figureContext(),
    )
    expect(fy.issues.find((i) => i.code === 'I_DATE_AXIS_LINEAR')?.params).toEqual({ axis: 'y' })
  })

  it('fixed axis ranges are passed in data units (log10 for log axes)', () => {
    const p = plotOf({ series: [ohmSeries()] })
    const f = buildFigure(
      deriveOnce([ohm], {
        ...p,
        xAxis: { ...p.xAxis, range: { mode: 'fixed', min: 0, max: 0.2 } },
        yAxis: { ...p.yAxis, scale: 'log', range: { mode: 'fixed', min: 0.1, max: 10 } },
      }),
      figureContext(),
    )
    expect(f.layout.xaxis).toMatchObject({ range: [0, 0.2], autorange: false })
    expect(f.layout.yaxis).toMatchObject({ type: 'log', range: [-1, 1], autorange: false })
  })
})

describe('invariance: display changes never touch the analysis', () => {
  it('style, plot type and visibility changes return the same fit and statistics objects', () => {
    const derive = createDeriver()
    const raws = rawTablesOf([ohm])
    const base = plotOf({ series: [ohmSeries()] })
    const doc = docOf([ohm], base, { fits: [ohmFit] })
    const d0 = derive(doc, raws)
    const fit0 = d0.series[0].fit
    const stat0 = d0.columnSummary(ohm.dataset.id, ohm.col('V'))
    const variants: PlotSpec[] = [
      { ...base, type: 'line' },
      { ...base, series: [ohmSeries({ style: { ...base.series[0].style, markerSize: 3, open: true } })] },
      { ...base, series: [ohmSeries({ visible: false })] },
      {
        ...base,
        series: [ohmSeries({ errorBars: { x: { kind: 'none' }, y: { kind: 'none' }, visible: false } })],
      },
      { ...base, xAxis: { ...base.xAxis, scale: 'log' }, yAxis: { ...base.yAxis, scale: 'log' } },
    ]
    for (const p of variants) {
      const d = derive({ ...doc, plots: [p] }, raws)
      buildFigure(d, figureContext())
      expect(d.series[0].fit).toBe(fit0)
      expect(d.columnSummary(ohm.dataset.id, ohm.col('V'))).toBe(stat0)
    }
    expect(fit0?.status === 'ok' && fit0.params[1].value).toBeCloseTo(
      Number(ref('ohm.json').linear.coefficients[1]),
      10,
    )
  })
})

describe('accessible summary', () => {
  it('names the type, the variables with units, n and the fit', () => {
    const f = buildFigure(ohmDerived(), figureContext())
    expect(f.a11y).toContain('figure.a11y.xy|{"type":"plot.types.scatter","x":"I (A)","y":"V (V)"}')
    expect(f.a11y).toContain('figure.a11y.series|{"name":"V","n":10}')
    expect(f.a11y).toContain('b₁ = (47.15 ± 0.08) V/A')
  })
})

describe('layout details', () => {
  it('legend placement: auto = horizontal above the plot; corners inside; hidden legend', () => {
    const auto = buildFigure(ohmDerived(), figureContext())
    expect(auto.layout.showlegend).toBe(true)
    expect(auto.layout.legend).toMatchObject({ orientation: 'h', y: 1.02, yanchor: 'bottom' })
    const tl = buildFigure(ohmDerived({ legend: { visible: true, position: 'top-left' } }), figureContext())
    expect(tl.layout.legend).toMatchObject({ x: 0.01, y: 0.99, xanchor: 'left', yanchor: 'top' })
    const br = buildFigure(
      ohmDerived({
        legend: { visible: true, position: 'bottom-right' },
        scatter: { residualPanel: true, showExcluded: true },
      }),
      figureContext(),
    )
    // Above the residual panel, not inside it.
    expect(br.layout.legend).toMatchObject({ xanchor: 'right', yanchor: 'bottom' })
    expect(br.layout.legend?.y).toBeCloseTo(0.35, 12)
    const off = buildFigure(ohmDerived({ legend: { visible: false, position: 'auto' } }), figureContext())
    expect(off.layout.showlegend).toBe(false)
  })

  it('dragmode comes from the toolbar; the screen figure autosizes, the export one has a fixed size', () => {
    const f = buildFigure(ohmDerived(), figureContext({ dragmode: 'lasso' }))
    expect(f.layout.dragmode).toBe('lasso')
    expect(f.layout.autosize).toBe(true)
    expect(f.layout.width).toBeUndefined()
  })

  it('the export leaves the residual panel out when includeResiduals is off', () => {
    const p = plotOf({ series: [ohmSeries()], scatter: { residualPanel: true, showExcluded: true } })
    const on = buildFigure(
      deriveOnce([ohm], p, { fits: [ohmFit] }),
      figureContext({ mode: 'export', size: { width: 900, height: 600 } }),
    )
    expect(on.layout.xaxis2).toBeDefined()
    const off = buildFigure(
      deriveOnce([ohm], { ...p, export: { ...p.export, includeResiduals: false } }, { fits: [ohmFit] }),
      figureContext({ mode: 'export', size: { width: 900, height: 600 } }),
    )
    expect(off.layout.xaxis2).toBeUndefined()
    expect(traces(off).some((t) => t.uid === 'ser_ohm__residuals')).toBe(false)
  })

  it('a curve that leaves the double range is interrupted, never drawn with Infinity (W_CURVE_TRUNCATED)', () => {
    const s = series('ser_c', cooling, 't', 'ΔT')
    const exp = fitOf('fit_c', 'ser_c', {
      model: { type: 'exponential' },
      curveRange: { mode: 'extend', min: -20000, max: 30 },
    })
    const f = buildFigure(deriveOnce([cooling], plotOf({ series: [s] }), { fits: [exp] }), figureContext())
    const dashed = trace(f, 'ser_c__fitExtrapolation')
    expect(dashed.y.some(Number.isNaN)).toBe(true)
    expect(dashed.y.every((v) => Number.isNaN(v) || Number.isFinite(v))).toBe(true)
    expect(codes(f)).toEqual(expect.arrayContaining(['W_EXTRAPOLATION', 'W_CURVE_TRUNCATED']))
    // The data part is intact.
    expect(trace(f, 'ser_c__fit').y.every(Number.isFinite)).toBe(true)
  })

  it('an exact fit draws no band (NaN bounds) rather than a zero-width one', () => {
    const ds = importCsv('x (s),y (m)\n1,2\n2,4\n3,6\n4,8\n', 'ds_exact')
    const spec = fitOf('fit_x', 'ser_x', {
      show: { curve: true, confidenceBand: true, predictionBand: true, residuals: false },
    })
    const d = deriveOnce([ds], plotOf({ series: [series('ser_x', ds, 'x', 'y')] }), { fits: [spec] })
    expect((d.series[0].fit as FitOk).exactFit).toBe(true)
    const f = buildFigure(d, figureContext())
    expect(traces(f).map((t) => t.uid)).toEqual(['ser_x__fit', 'ser_x__points'])
    expect(f.caption).toContain('fit.exactFitNote')
    expect(f.caption.some((l) => l.startsWith('figure.caption.band'))).toBe(false)
  })

  it('an exact fit in Italian ends its goodness line with a single full stop ("s = n.d.")', () => {
    const ds = importCsv('x (s),y (m)\n1,2\n2,4\n3,6\n4,8\n', 'ds_exact_it')
    const d = deriveOnce([ds], plotOf({ series: [series('ser_x', ds, 'x', 'y')] }), {
      fits: [fitOf('fit_x', 'ser_x')],
    })
    const f = buildFigure(
      d,
      figureContext({ mode: 'export', size: { width: 900, height: 600 }, t: makeTranslator('it') }),
    )
    const goodness = f.caption.find((l) => l.includes('s = n.d.'))
    expect(goodness).toBeDefined()
    expect(goodness!.endsWith('n.d.')).toBe(true)
    expect(f.caption.some((l) => l.includes('n.d..'))).toBe(false)
  })
})

describe('figure honesty (review fixes)', () => {
  const exportCtx = () => figureContext({ mode: 'export', size: { width: 900, height: 600 } })
  const vi = importCsv(
    'I (A),V (V),uV (V),P (mW)\n' +
      '0.01,0.46,0.02,4.6\n0.02,0.94,0.02,18.8\n0.03,1.40,0.02,42\n0.04,1.87,0.02,74.8\n0.05,2.34,0.02,117\n',
    'ds_vi',
  )
  const panel = { residualPanel: true, showExcluded: true }

  it('an uncertainty column on a derived axis draws, labels and describes no bars (E_DERIVED_UNCERTAINTY)', () => {
    const V = vi.dataset.columns.find((c) => c.id === vi.col('V'))!
    const lnV: ColumnMeta = {
      ...V,
      id: 'col_lnV' as ColumnId,
      name: 'ln V',
      unit: null,
      unitSource: null,
      source: { type: 'derived', spec: { op: 'ln', input: V.id } },
    }
    const withLn: Imported = { ...vi, dataset: { ...vi.dataset, columns: [...vi.dataset.columns, lnV] } }
    const s: XYSeriesSpec = {
      ...series('ser_ln', vi, 'I', 'V'),
      y: lnV.id,
      errorBars: {
        x: { kind: 'none' },
        y: {
          kind: 'measurement',
          origin: 'instrument',
          source: { type: 'column', column: vi.col('uV') },
          meaning: { type: 'standard' },
        },
        visible: true,
      },
    }
    const d = deriveOnce([withLn], plotOf({ series: [s] }), { fits: [fitOf('fit_ln', 'ser_ln')] })
    expect(d.issues.map((i) => i.code)).toContain('E_DERIVED_UNCERTAINTY')
    for (const ctx of [figureContext(), exportCtx()]) {
      const f = buildFigure(d, ctx)
      const pts = trace(f, 'ser_ln__points')
      expect(pts.error_y).toBeUndefined()
      expect(pts.hovertemplate).not.toContain('uncertainty.label')
      expect(f.caption.some((l) => l.startsWith('figure.caption.bars'))).toBe(false)
      expect(f.caption).not.toContain('fit.unweighted')
    }
  })

  it('the residual axis lists each unit when the series differ, and says ln only for log-linear residuals', () => {
    const sV = series('ser_v', vi, 'I', 'V')
    const sP = series('ser_p', vi, 'I', 'P')
    const both = (pModel: 'linear' | 'exponential') =>
      buildFigure(
        deriveOnce([vi], plotOf({ series: [sV, sP], scatter: panel }), {
          fits: [fitOf('fit_v', 'ser_v'), fitOf('fit_p', 'ser_p', { model: { type: pModel } })],
        }),
        figureContext(),
      )
    const lin = both('linear')
    expect(lin.layout.yaxis?.title).toMatchObject({ text: 'V (V), P (mW)' })
    expect(lin.layout.yaxis2?.title).toMatchObject({ text: 'figure.residual: V (V), P (mW)' })
    expect(both('exponential').layout.yaxis2?.title).toMatchObject({ text: 'figure.residual: V (V), ln P' })
    // Same unit for every series: one label.
    const sV2 = { ...sV, id: 'ser_v2' as XYSeriesSpec['id'] }
    const twice = buildFigure(
      deriveOnce([vi], plotOf({ series: [sV, sV2], scatter: panel }), {
        fits: [fitOf('fit_v', 'ser_v'), fitOf('fit_v2', 'ser_v2')],
      }),
      figureContext(),
    )
    expect(twice.layout.yaxis2?.title).toMatchObject({ text: 'figure.residual (V)' })
  })

  it('line plots draw the residual panel too: the fit panel switch is never a no-op', () => {
    const p = plotOf({ type: 'line', series: [ohmSeries()], scatter: panel })
    for (const ctx of [figureContext(), exportCtx()]) {
      const on = buildFigure(deriveOnce([ohm], p, { fits: [ohmFit] }), ctx)
      expect(on.layout.yaxis2).toBeDefined()
      expect(traces(on).map((t) => t.uid)).toContain('ser_ohm__residuals')
    }
    const off = buildFigure(
      deriveOnce([ohm], { ...p, scatter: { ...panel, residualPanel: false } }, { fits: [ohmFit] }),
      figureContext(),
    )
    expect(off.layout.yaxis2).toBeUndefined()
  })

  it('residuals drawn without curve or band still state the model, n and the equation', () => {
    const onlyResiduals = fitOf('fit_ohm', 'ser_ohm', {
      show: { curve: false, confidenceBand: false, predictionBand: false, residuals: true },
    })
    const d = ohmDerived({ scatter: panel }, { fits: [onlyResiduals] })
    for (const ctx of [figureContext(), exportCtx()]) {
      const f = buildFigure(d, ctx)
      expect(traces(f).map((t) => t.uid)).toEqual(['ser_ohm__points', 'ser_ohm__residuals'])
      expect(f.indicator).toContain('figure.indicator.fit')
      const fitLine = f.caption.find((l) => l.startsWith('figure.caption.fit|'))
      expect(fitLine).toContain('V = b₀ + b₁·I')
      expect(f.a11y).toContain('figure.a11y.fit')
    }
    // Without the panel nothing comes from the fit: no indicator.
    const none = buildFigure(ohmDerived({}, { fits: [onlyResiduals] }), figureContext())
    expect(traces(none).map((t) => t.uid)).toEqual(['ser_ohm__points'])
    expect(none.indicator).toBeNull()
  })

  it("bars of aggregate 'none' with a measurement uncertainty are defined in the caption", () => {
    const barPlot = (ds: Imported) =>
      plotOf({
        type: 'bar',
        bar: {
          datasetId: ds.dataset.id,
          category: ds.col('sample'),
          value: ds.col('c'),
          showObservations: false,
          colorByCategory: false,
          aggregate: 'none',
          uncertainty: {
            kind: 'measurement',
            origin: 'instrument',
            source: { type: 'column', column: ds.col('u') },
            meaning: { type: 'expanded', k: 2 },
          },
        },
      })
    const ds = importCsv('sample,c (mg/L),u (mg/L)\nA,1.5,0.1\nB,2.5,0.2\nC,0.5,0.15\n', 'ds_bn')
    const f = buildFigure(deriveOnce([ds], barPlot(ds)), exportCtx())
    expect((trace(f, 'plot_1__bar').error_y as { array: number[] }).array).toEqual([0.1, 0.2, 0.15])
    const line = f.caption.find((l) => l.startsWith('figure.caption.bars|'))
    expect(line).toBeDefined()
    expect(line).toContain('"variable":"c"')
    expect(line).toContain('uncertainty.label.measurement.expanded')
    expect(line).toContain('figure.caption.source.column|')
    expect(line).toContain('u')
    const cap = (f.layout.annotations as { name: string; text: string }[]).find((a) => a.name === 'caption')
    expect(cap?.text).toContain('figure.caption.bars|')
    // An uncertainty column without any usable value draws nothing and is not described.
    const empty = importCsv('sample,c (mg/L),u (mg/L)\nA,1.5,NA\nB,2.5,NA\nC,0.5,NA\n', 'ds_bn')
    const g = buildFigure(deriveOnce([empty], barPlot(empty)), exportCtx())
    expect(trace(g, 'plot_1__bar').error_y).toBeUndefined()
    expect(g.caption.some((l) => l.startsWith('figure.caption.bars'))).toBe(false)
  })

  it('a box plot on a log axis reports every observation ≤ 0, whichever points are drawn', () => {
    const ds = importCsv('g,v (mV)\nA,-5\nA,-4\nA,-3\nA,-2\nA,1\nB,2\nB,3\nB,4\nB,5\n', 'ds_blog')
    const boxPlot = (points: 'all' | 'outliers' | 'none', scale: 'linear' | 'log') => {
      const p = plotOf({
        type: 'box',
        box: {
          datasetId: ds.dataset.id,
          value: ds.col('v'),
          groupBy: ds.col('g'),
          points,
          showMean: false,
          colorByGroup: false,
        },
      })
      return { ...p, yAxis: { ...p.yAxis, scale } }
    }
    for (const points of ['none', 'outliers', 'all'] as const) {
      const f = buildFigure(deriveOnce([ds], boxPlot(points, 'log')), exportCtx())
      expect(f.layout.yaxis?.type).toBe('log')
      const hidden = f.issues.find((i) => i.code === 'W_LOG_AXIS_HIDDEN')
      expect(hidden, points).toMatchObject({ params: { count: 4 } })
      expect([...hidden!.rows!].sort((a, b) => a - b)).toEqual([1, 2, 3, 4])
      expect(f.caption).toContain('figure.caption.logHidden|{"count":4}')
    }
    const linear = buildFigure(deriveOnce([ds], boxPlot('none', 'linear')), exportCtx())
    expect(codes(linear)).not.toContain('W_LOG_AXIS_HIDDEN')
  })
})
