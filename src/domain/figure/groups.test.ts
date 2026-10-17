/**
 * Figures of grouped data: split XY series (group traces, colours, legend groups, fits per
 * group, selection), histogram / box / bar groups, captions and accessible text, short panes and the
 * extrapolation pattern next to a prediction band.
 */
import { describe, expect, it } from 'vitest'
import type { DerivedProject } from '@/domain/derive/pipeline'
import { NO_VALUE_KEY, fnv1a36 } from '@/domain/derive/split'
import type { FitOk, Selection } from '@/domain/derive/types'
import { predict } from '@/domain/fit/band'
import { issue } from '@/domain/model'
import type { FitSpec, PlotSpec, RowId, SplitSpec, XYSeriesSpec } from '@/domain/model'
import { makeTranslator } from '@/i18n/translate'
import { buildFigure } from './buildFigure'
import type { FigureContext, FigureOut } from './context'
import { groupRanks } from './groups'
import { COMPACT_MAIN_DOMAIN, COMPACT_RESIDUAL_DOMAIN, MAIN_DOMAIN, RESIDUAL_DOMAIN } from './layout'
import { NEUTRAL, SERIES_COLORS, SERIES_SYMBOLS, withAlpha } from './palette'
import { rowsFromPlotlyPoints, selectedIndicesForTrace } from './selectionMap'
import { uidOwner } from './traces/common'
import { deriveOnce, exclusionOf, figureContext, fitOf, importCsv, plotOf, series } from './testing'

type AnyTrace = Record<string, unknown> & {
  uid: string
  type: string
  x: number[]
  y: number[]
  name?: string
  mode?: string
  showlegend?: boolean
  legendgroup?: string
  legendgrouptitle?: { text: string }
  marker?: { color?: unknown; symbol?: unknown; line?: { color?: unknown } }
  line?: { color?: string; dash?: string; width?: number }
  customdata?: unknown[][]
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
const uids = (f: FigureOut) => traces(f).map((t) => t.uid)
const codes = (f: FigureOut) => f.issues.map((i) => i.code)

const CSV = [
  'x,y,z,who',
  '1,3.1,1.0,A',
  '1,2.0,1.1,B',
  '2,4.9,2.1,A',
  '2,5.1,2.0,B',
  '3,7.1,3.0,A',
  '3,7.9,3.2,B',
  '4,8.9,4.1,A',
  '4,11.1,3.9,B',
  '5,11.0,5.0,A',
  '5,14.0,5.1,B',
  '6,9.0,6.0,',
].join('\n')
const ds = importCsv(CSV, 'ds_g')
const byWho = (over: Partial<SplitSpec> = {}): SplitSpec => ({
  column: ds.col('who'),
  overrides: [],
  ...over,
})
const g = (key: string) => `g${fnv1a36(key)}`
const A = g('A')
const B = g('B')
const NONE = g(NO_VALUE_KEY)

const ySeries = (over: Partial<XYSeriesSpec> = {}) =>
  series('ser_y', ds, 'x', 'y', { split: byWho(), ...over })
const zSeries = (over: Partial<XYSeriesSpec> = {}) =>
  series('ser_z', ds, 'x', 'z', { split: byWho(), style: { ...ySeries().style, paletteIndex: 1 }, ...over })

function fig(
  seriesList: XYSeriesSpec[],
  opts: { fits?: FitSpec[]; plot?: Partial<PlotSpec>; ctx?: Partial<FigureContext> } = {},
): { f: FigureOut; d: DerivedProject } {
  const d = deriveOnce([ds], plotOf({ series: seriesList, ...opts.plot }), { fits: opts.fits ?? [] })
  return { f: buildFigure(d, figureContext(opts.ctx)), d }
}

describe('split XY series — group traces', () => {
  const { f, d } = fig([ySeries()])

  it('one points trace per group, uid `${series}__g${hash}__points` (a CSS identifier), group order', () => {
    expect(uids(f)).toEqual([`ser_y__${A}__points`, `ser_y__${B}__points`, `ser_y__${NONE}__points`])
    for (const u of uids(f)) {
      expect(u).toMatch(/^[A-Za-z_][A-Za-z0-9_-]*$/)
      // Every group trace belongs to its series (legend click, dataset lookup).
      expect(uidOwner(u)).toBe('ser_y')
    }
  })

  it('points restricted to the group rows; the rows without a value are shown as "(no value)"', () => {
    const [a, b, none] = d.series[0].split!.groups
    expect(trace(f, `ser_y__${A}__points`).customdata!.map((c) => c[0])).toEqual(
      Array.from(a.rows, (i) => d.series[0].data.rowIds[i]),
    )
    expect(trace(f, `ser_y__${B}__points`).x).toEqual([1, 2, 3, 4, 5])
    expect(trace(f, `ser_y__${NONE}__points`).y).toEqual([9])
    expect(b.rows).toHaveLength(5)
    expect(none.key).toBe(NO_VALUE_KEY)
    expect(codes(f)).not.toContain('I_SPLIT_NO_VALUE') // a series issue (panel), not a figure issue
  })

  it('legend: grouped under the series (title = series label), one entry per group, named by its group', () => {
    for (const t of traces(f)) {
      expect(t.legendgroup).toBe('ser_y')
      expect(t.legendgrouptitle).toEqual({ text: 'y' })
      expect(t.showlegend).toBe(true)
    }
    expect(traces(f).map((t) => t.name)).toEqual(['A', 'B', 'legend.noValue'])
    expect(f.layout.showlegend).toBe(true) // 'auto' with several entries
    const hover = trace(f, `ser_y__${A}__points`).hovertemplate as string
    expect(hover.startsWith('<b>y · A</b>')).toBe(true)
  })

  it('one series: colour and symbol by group rank', () => {
    for (const [k, key] of [A, B, NONE].entries())
      expect(trace(f, `ser_y__${key}__points`).marker).toMatchObject({
        color: SERIES_COLORS[k],
        symbol: SERIES_SYMBOLS[k],
      })
  })

  it('several series: the colour tells the group (the same in every series), the symbol the series', () => {
    const two = fig([ySeries(), zSeries()]).f
    for (const [k, key] of [A, B, NONE].entries()) {
      const py = trace(two, `ser_y__${key}__points`).marker!
      const pz = trace(two, `ser_z__${key}__points`).marker!
      expect(py.color).toBe(SERIES_COLORS[k])
      expect(pz.color).toBe(py.color)
      // Group A of y and group A of z must not be drawn alike.
      expect(py.symbol).toBe(SERIES_SYMBOLS[0])
      expect(pz.symbol).toBe(SERIES_SYMBOLS[1])
    }
    expect(trace(two, `ser_z__${A}__points`).legendgrouptitle).toEqual({ text: 'z' })
    // An unsplit series in the colour of group B keeps its own symbol, unlike group B's.
    const mixed = fig([ySeries(), zSeries({ split: null })]).f
    const b = trace(mixed, `ser_y__${B}__points`).marker!
    const z = trace(mixed, 'ser_z__points').marker!
    expect(b.color).toBe(z.color)
    expect(b.symbol).not.toBe(z.symbol)
    // A symbol override still wins.
    const over = fig([
      ySeries({ split: byWho({ overrides: [{ key: 'A', paletteIndex: null, symbol: 'x' }] }) }),
      zSeries(),
    ])
    expect(trace(over.f, `ser_y__${A}__points`).marker?.symbol).toBe('x')
  })

  it('legend: the groups read in group order, then the shared entries, with or without bands', () => {
    // Plotly's own rule: entries sorted by legendrank (default 1000), the whole group reversed as soon
    // as a trace fills to the next one (the bands).
    const order = (fo: FigureOut, series: string) => {
      const reversed = traces(fo).some((t) => t.fill === 'tonexty')
      const rank = (t: AnyTrace) => (t.legendrank as number | undefined) ?? 1000
      const items = traces(fo)
        .map((t, i) => ({ t, i }))
        .filter(({ t }) => t.legendgroup === series && t.showlegend !== false)
        .sort((a, b) => rank(a.t) - rank(b.t) || a.i - b.i)
        .map(({ t }) => t.name)
      return reversed ? items.reverse() : items
    }
    const fits = [
      fitOf('fit_y', 'ser_y', {
        perGroup: true,
        show: { curve: true, confidenceBand: true, predictionBand: true, residuals: false },
      }),
    ]
    const banded = fig([ySeries()], { fits }).f
    const expected = [
      'A',
      'B',
      'legend.noValue',
      'legend.fitEachGroup|{"model":"fit.modelShort.linear"}',
      'legend.band.confidenceEachGroup|{"level":95}',
      'legend.band.predictionEachGroup|{"level":95}',
    ]
    expect(order(banded, 'ser_y')).toEqual(expected)
    const plain = fig([ySeries()], {
      fits: [{ ...fits[0], show: { ...fits[0].show, confidenceBand: false, predictionBand: false } }],
    }).f
    expect(order(plain, 'ser_y')).toEqual([...expected.slice(0, 4)])
    // The lowest rank is Plotly's default: the series keep their order in the legend.
    const ranks = traces(banded)
      .map((t) => t.legendrank as number | undefined)
      .filter((r) => r !== undefined)
    expect(Math.min(...ranks)).toBe(1000)
  })

  it('overrides win for what they set; a key listed twice keeps its first override', () => {
    const over = byWho({
      overrides: [
        { key: 'A', paletteIndex: 5, symbol: 'auto' },
        { key: 'A', paletteIndex: 2, symbol: 'square' },
        { key: 'B', paletteIndex: null, symbol: 'x' },
      ],
    })
    const o = fig([ySeries({ split: over })]).f
    expect(trace(o, `ser_y__${A}__points`).marker).toMatchObject({
      color: SERIES_COLORS[5],
      symbol: 'circle',
    })
    expect(trace(o, `ser_y__${B}__points`).marker).toMatchObject({ color: SERIES_COLORS[1], symbol: 'x' })
  })

  it('groupRanks shares one order between columns of the same name and keeps "(no value)" last', () => {
    const rank = groupRanks(d.series)
    expect(['A', 'B', NO_VALUE_KEY].map((k) => rank(d.series[0], k))).toEqual([0, 1, 2])
  })

  it('excluded points per group, named by the group, in grey with the group symbol', () => {
    const rows = d.series[0].data.rowIds
    const ex = deriveOnce([ds], plotOf({ series: [ySeries()] }), {
      exclusions: [
        {
          id: 'ex_1' as never,
          datasetId: ds.dataset.id,
          rowIds: [rows[1] as RowId],
          reason: 'other',
          note: '',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    })
    const fe = buildFigure(ex, figureContext())
    const t = trace(fe, `ser_y__${B}__excluded`)
    expect(t.name).toBe('legend.excludedOf|{"n":1,"series":"B"}')
    expect(t.marker).toMatchObject({ color: NEUTRAL.excluded, symbol: `${SERIES_SYMBOLS[1]}-open` })
    expect(uids(fe)).not.toContain(`ser_y__${A}__excluded`)
    expect(trace(fe, `ser_y__${B}__points`).x).toEqual([2, 3, 4, 5])
  })

  it('a line plot joins each group in recorded order: rows of the other groups never break it', () => {
    const lf = fig([ySeries()], { plot: { type: 'line' } }).f
    const b = trace(lf, `ser_y__${B}__points`)
    expect(b.x).toEqual([1, 2, 3, 4, 5])
    expect(b.x.some(Number.isNaN)).toBe(false)
    expect(b.line?.color).toBe(SERIES_COLORS[1])
    // Sorted by x within the group only; its excluded row breaks the line, the other groups never do.
    const unsorted = importCsv('x,y,g\n3,1,a\n9,9,b\n1,2,a\n0,9,b\n2,3,a\n5,4,a\n', 'ds_sort')
    const rows = deriveOnce([unsorted], plotOf()).views.get(unsorted.dataset.id)!.rowIds
    const s = series('s', unsorted, 'x', 'y', { split: { column: unsorted.col('g'), overrides: [] } })
    const sorted = buildFigure(
      deriveOnce([unsorted], plotOf({ type: 'line', line: { markers: true, sortByX: true }, series: [s] }), {
        exclusions: [exclusionOf('ex_s', unsorted, [rows[4]])],
      }),
      figureContext(),
    )
    expect(trace(sorted, `s__${g('a')}__points`).x).toEqual([1, NaN, 3, 5])
    expect(trace(sorted, `s__${g('b')}__points`).x).toEqual([0, 9])
  })

  it('linked selection: group traces map back to their rows in both directions', () => {
    const rows = d.series[0].data.rowIds
    const sel: Selection = {
      datasetId: ds.dataset.id,
      rowIds: new Set([rows[1], rows[3]]),
      origin: 'table',
      anchor: null,
    }
    const fs = fig([ySeries()], { ctx: { selection: sel } }).f
    expect(trace(fs, `ser_y__${B}__points`).selectedpoints).toEqual([0, 1])
    expect(trace(fs, `ser_y__${A}__points`).selectedpoints).toEqual([])
    expect(selectedIndicesForTrace(`ser_y__${B}__points`, sel, fs.selectionMap)).toEqual([0, 1])
    const back = rowsFromPlotlyPoints(
      [
        { data: { uid: `ser_y__${B}__points` }, pointIndex: 2 },
        { data: { uid: `ser_y__${NONE}__points` }, pointIndex: 0 },
      ],
      fs.selectionMap,
    )
    expect(back).toEqual([rows[5], rows[10]])
    expect(fs.selectionMap.byRow.get(rows[10])).toEqual([{ uid: `ser_y__${NONE}__points`, pointIndex: 0 }])
    expect(fs.selectionMap.datasetOf.get(`ser_y__${A}__points`)).toBe(ds.dataset.id)
  })
})

describe('split XY series — fits', () => {
  const perGroup = fitOf('fit_y', 'ser_y', {
    perGroup: true,
    show: { curve: true, confidenceBand: true, predictionBand: true, residuals: true },
  })

  it('pooled fit (perGroup off): one fit over the groups, neutral, its residuals coloured by group', () => {
    const { f } = fig([ySeries()], {
      fits: [fitOf('fit_y', 'ser_y')],
      plot: { scatter: { residualPanel: true, showExcluded: true } },
    })
    const fit = trace(f, 'ser_y__fit')
    expect(fit.line?.color).toBe(NEUTRAL.text)
    expect(fit.showlegend).toBe(true)
    expect(fit.legendgrouptitle).toEqual({ text: 'y' })
    const res = trace(f, 'ser_y__residuals')
    expect(res.x).toHaveLength(11)
    const colours = res.marker!.color as string[]
    expect(new Set(colours)).toEqual(new Set([SERIES_COLORS[0], SERIES_COLORS[1], SERIES_COLORS[2]]))
    expect(uids(f).some((u) => u.endsWith('__fitLegend'))).toBe(false)
  })

  it('per group: a fit, bands and residuals per group in its colour; one neutral legend entry each', () => {
    const { f, d } = fig([ySeries()], {
      fits: [perGroup],
      plot: { scatter: { residualPanel: true, showExcluded: true } },
    })
    const s = d.series[0]
    expect(s.fit).toBeNull()
    const fa = trace(f, `ser_y__${A}__fit`)
    const fb = trace(f, `ser_y__${B}__fit`)
    expect(fa.line?.color).toBe(SERIES_COLORS[0])
    expect(fb.line?.color).toBe(SERIES_COLORS[1])
    expect([fa.showlegend, fb.showlegend]).toEqual([false, false])
    // The prediction from each group's own fit.
    const groupFit = s.split!.groups[1].fit as FitOk
    expect(fb.y[0]).toBeCloseTo(predict(groupFit, fb.x[0]), 12)
    // The single row without an observer has no fit: nothing drawn for it but its point.
    expect(uids(f)).not.toContain(`ser_y__${NONE}__fit`)
    for (const role of ['band', 'bandLower', 'predictionBand', 'predictionBandLower', 'residuals'])
      for (const key of [A, B]) expect(uids(f)).toContain(`ser_y__${key}__${role}`)
    expect(trace(f, `ser_y__${A}__residuals`).x).toHaveLength(5)
    const proxy = trace(f, 'ser_y__fitLegend')
    expect(proxy).toMatchObject({
      name: 'legend.fitEachGroup|{"model":"fit.modelShort.linear"}',
      showlegend: true,
      x: [null],
      y: [null],
      hoverinfo: 'skip',
      legendgroup: 'ser_y',
    })
    expect(proxy.line?.color).toBe(NEUTRAL.text)
    expect(trace(f, 'ser_y__bandLegend').name).toBe('legend.band.confidenceEachGroup|{"level":95}')
    expect(trace(f, 'ser_y__predictionBandLegend').name).toBe('legend.band.predictionEachGroup|{"level":95}')
    // Group bands carry no legend entry of their own; proxies are not selectable.
    expect(trace(f, `ser_y__${A}__band`).showlegend).toBe(false)
    expect(f.selectionMap.byTrace.has('ser_y__fitLegend')).toBe(false)
    // Residual panel: one axis title for the series, not one per group.
    expect(f.layout.yaxis2?.title).toMatchObject({ text: 'figure.residual' })
  })

  it('extrapolation next to a prediction band is never dotted, and is reported once per series', () => {
    const ext = { ...perGroup, curveRange: { mode: 'extend' as const, min: 0, max: 8 } }
    const { f } = fig([ySeries()], { fits: [ext] })
    expect(trace(f, `ser_y__${A}__fitExtrapolation`).line?.dash).toBe('dashdot')
    const w = f.issues.filter((i) => i.code === 'W_EXTRAPOLATION')
    expect(w).toEqual([issue('W_EXTRAPOLATION', { series: 'y', pattern: 'dashdot' })])
    // Without the band the first free pattern is dot, as before.
    const plain = fig([ySeries({ split: null })], {
      fits: [{ ...ext, perGroup: false, show: { ...ext.show, predictionBand: false } }],
    }).f
    expect(trace(plain, 'ser_y__fitExtrapolation').line?.dash).toBe('dot')
  })

  it('the screen warning names its series (EN and IT)', () => {
    const w = issue('W_EXTRAPOLATION', { series: 'V', pattern: 'dashdot' })
    expect(makeTranslator('en')(`issues.${w.code}.title`, w.params)).toBe(
      'V: the dash-dot part of the fit is an extrapolation beyond the data.',
    )
    expect(makeTranslator('it')(`issues.${w.code}.title`, w.params)).toBe(
      'V: la parte tratto-punto del fit è un’estrapolazione oltre i dati.',
    )
  })

  it('caption, indicator and accessible text describe the groups and each group fit', () => {
    const { f } = fig([ySeries()], { fits: [perGroup], ctx: { mode: 'export' } })
    expect(f.caption).toContain(
      'figure.caption.split|{"column":"who","groups":"A: n = 5, B: n = 5, legend.noValue: n = 1"}',
    )
    expect(f.caption.some((l) => l.startsWith('A: figure.caption.fit|'))).toBe(true)
    expect(f.caption.some((l) => l.startsWith('B: figure.caption.fit|'))).toBe(true)
    expect(f.caption).toContain('figure.caption.groupNoFit|{"group":"legend.noValue"}')
    // The band notes are stated once, not once per group.
    expect(f.caption.filter((l) => l.startsWith('figure.caption.band.confidence'))).toHaveLength(1)
    expect(f.indicator).toContain('figure.indicator.groups|{"count":3}')
    expect(f.indicator).toContain('figure.indicator.fitEachGroup|{"model":"fit.modelShort.linear"}')
    expect(f.a11y).toContain(
      'figure.a11y.split|{"column":"who","groups":"A: n = 5, B: n = 5, legend.noValue: n = 1"}',
    )
    expect(f.a11y).toMatch(/figure\.a11y\.groupFit\|\{"group":"A"/)
    expect(f.a11y).toMatch(/figure\.a11y\.groupFit\|\{"group":"B"/)
  })

  it('no group fit succeeded: the figure says nothing about fits (like a failed single fit)', () => {
    const one = importCsv('x,y,g\n1,2,a\n2,3,b\n', 'ds_one_each')
    const s = series('s', one, 'x', 'y', { split: { column: one.col('g'), overrides: [] } })
    const d = deriveOnce([one], plotOf({ series: [s] }), { fits: [fitOf('f', 's', { perGroup: true })] })
    const f = buildFigure(d, figureContext({ mode: 'export' }))
    expect(f.indicator).toBeNull()
    expect(f.caption.some((l) => l.includes('groupNoFit'))).toBe(false)
    expect(uids(f).some((u) => u.endsWith('Legend'))).toBe(false)
    // The failures are reported, each with its group.
    const tooFew = d.series[0].issues.filter((i) => i.code === 'E_TOO_FEW_POINTS')
    expect(tooFew.map((i) => i.params?.group)).toEqual(['a', 'b'])
  })

  it('too many groups: drawn whole, like an unsplit series', () => {
    const rows = Array.from({ length: 60 }, (_, i) => `${i},${2 * i},${i}`).join('\n')
    const many = importCsv(`x,y,id\n${rows}\n`, 'ds_many')
    const s = series('s', many, 'x', 'y', { split: { column: many.col('id'), overrides: [] } })
    const fm = buildFigure(deriveOnce([many], plotOf({ series: [s] })), figureContext())
    expect(uids(fm)).toEqual(['s__points'])
    // The warning also serves histograms: it speaks of the data, not of a series (EN / IT).
    const w = issue('W_SPLIT_TOO_MANY_GROUPS', { column: 'id', count: 60, limit: 50 })
    expect(makeTranslator('en')(`issues.${w.code}.title`, w.params)).toBe(
      'id has 60 different values (limit 50): the data are drawn without groups.',
    )
    expect(makeTranslator('it')(`issues.${w.code}.title`, w.params)).toBe(
      'id ha 60 valori diversi (limite 50): i dati sono disegnati senza gruppi.',
    )
  })
})

describe('short panes keep the residual panel legible', () => {
  const fits = [fitOf('fit_y', 'ser_y')]
  const plot = { scatter: { residualPanel: true, showExcluded: true } }
  const at = (paneHeight?: number) => fig([ySeries({ split: null })], { fits, plot, ctx: { paneHeight } }).f

  it('a 140 px pane: no residual axis title, fewer and smaller ticks, a larger share for the residuals', () => {
    const f = at(140)
    expect(f.layout.yaxis2?.title).toMatchObject({ text: '' })
    expect(f.layout.yaxis2).toMatchObject({
      nticks: 3,
      tickfont: { size: 10 },
      domain: COMPACT_RESIDUAL_DOMAIN,
    })
    expect(f.layout.yaxis).toMatchObject({ nticks: 4, tickfont: { size: 10 }, domain: COMPACT_MAIN_DOMAIN })
    expect(f.layout.xaxis2).toMatchObject({ tickfont: { size: 10 } })
    expect(f.layout.margin).toMatchObject({ b: 36, l: 56 })
  })

  it('a 140 px pane: the automatic legend (a split series brings several entries) moves to the right', () => {
    const split = fig([ySeries()], {
      fits: [fitOf('fit_y', 'ser_y', { perGroup: true })],
      plot,
      ctx: { paneHeight: 140 },
    }).f
    expect(split.layout.showlegend).toBe(true)
    expect(split.layout.legend).toMatchObject({ x: 1.02, xanchor: 'left', yanchor: 'top' })
    expect(split.layout.legend?.orientation).toBeUndefined()
    // No legend row is reserved above the plot.
    expect(split.layout.margin).toMatchObject({ t: 12 })
    // A chosen position is kept; a tall pane keeps the row above the plot.
    const chosen = fig([ySeries()], {
      fits: [fitOf('fit_y', 'ser_y', { perGroup: true })],
      plot: { ...plot, legend: { visible: true, position: 'top-left' } },
      ctx: { paneHeight: 140 },
    }).f
    expect(chosen.layout.legend).toMatchObject({ x: 0.01, xanchor: 'left' })
  })

  it('a titled legend group goes to the right in a tall pane too: Plotly would stack it above the plot', () => {
    // Plotly lays out the entries of a group with a title one under the other even in a horizontal
    // legend: above the plot, four entries took 100 px of a 330 px pane (seen at 1366 × 768).
    const tall = fig([ySeries()], { fits: [fitOf('fit_y', 'ser_y', { perGroup: true })], plot }).f
    expect(tall.layout.legend).toMatchObject({ x: 1.02, xanchor: 'left', yanchor: 'top' })
    expect(tall.layout.legend?.orientation).toBeUndefined()
    expect(tall.layout.margin).toMatchObject({ t: 12 })
    // Histogram groups have a titled legend group as well.
    const hist = buildFigure(
      deriveOnce(
        [ds],
        plotOf({
          type: 'histogram',
          histogram: {
            datasetId: ds.dataset.id,
            value: ds.col('y'),
            bins: { mode: 'auto' },
            groupBy: ds.col('who'),
            groupMode: 'overlay',
          },
        }),
      ),
      figureContext(),
    )
    expect(hist.layout.legend).toMatchObject({ x: 1.02, xanchor: 'left' })
    // Two series without groups keep the legend row above the plot.
    const two = fig([ySeries({ split: null }), zSeries({ split: null })]).f
    expect(two.layout.legend).toMatchObject({ orientation: 'h', y: 1.02 })
    expect(two.layout.margin).toMatchObject({ t: 40 })
  })

  it('a narrow pane (a phone) keeps the titled legend group above the plot; an export ignores the pane', () => {
    const fits = [fitOf('fit_y', 'ser_y', { perGroup: true })]
    const narrow = fig([ySeries()], { fits, plot, ctx: { paneWidth: 380, paneHeight: 600 } }).f
    expect(narrow.layout.legend).toMatchObject({ orientation: 'h', y: 1.02 })
    expect(fig([ySeries()], { fits, plot, ctx: { paneWidth: 760 } }).f.layout.legend).toMatchObject({
      x: 1.02,
    })
    // Short and narrow: the short pane wins (no height for a legend row).
    const both = fig([ySeries()], { fits, plot, ctx: { paneWidth: 380, paneHeight: 200 } }).f
    expect(both.layout.legend).toMatchObject({ x: 1.02 })
    const exp = fig([ySeries()], { fits, plot, ctx: { mode: 'export', paneWidth: 380 } }).f
    expect(exp.layout.legend).toMatchObject({ x: 1.02 })
  })

  it('any short pane, residual panel or not, puts the automatic legend at the right (a 2 × 2 grid)', () => {
    // A 545 × 240 px pane (2 × 2 on a 1080 px screen): narrow, but short wins; seen with histogram groups.
    const hist = buildFigure(
      deriveOnce(
        [ds],
        plotOf({
          type: 'histogram',
          histogram: {
            datasetId: ds.dataset.id,
            value: ds.col('y'),
            bins: { mode: 'auto' },
            groupBy: ds.col('who'),
            groupMode: 'overlay',
          },
        }),
      ),
      figureContext({ paneWidth: 545, paneHeight: 240 }),
    )
    expect(hist.layout.legend).toMatchObject({ x: 1.02 })
    const two = fig([ySeries({ split: null }), zSeries({ split: null })], { ctx: { paneHeight: 200 } }).f
    expect(two.layout.legend).toMatchObject({ x: 1.02 })
    expect(two.layout.margin).toMatchObject({ t: 12 })
  })

  it('a 260 px pane is compact (the full residual panel would be ~40 px with five tick labels)', () => {
    expect(at(260).layout.yaxis2).toMatchObject({ domain: COMPACT_RESIDUAL_DOMAIN })
    expect(at(320).layout.yaxis2).toMatchObject({ domain: RESIDUAL_DOMAIN })
  })

  it('a tall pane, an unknown height and every export are drawn as before', () => {
    const normal = at(undefined)
    expect(normal.layout.yaxis2).toMatchObject({ domain: RESIDUAL_DOMAIN, tickfont: { size: 12 } })
    expect(normal.layout.yaxis).toMatchObject({ domain: MAIN_DOMAIN })
    expect((normal.layout.yaxis2?.title as { text: string }).text).not.toBe('')
    expect(JSON.stringify(at(600).layout)).toBe(JSON.stringify(normal.layout))
    const exp = fig([ySeries({ split: null })], { fits, plot, ctx: { mode: 'export', paneHeight: 140 } }).f
    expect(exp.layout.yaxis2).toMatchObject({ domain: RESIDUAL_DOMAIN })
  })
})

describe('histogram groupBy', () => {
  const hist = (groupMode: 'overlay' | 'stack', groupBy: string | null = 'who') =>
    plotOf({
      type: 'histogram',
      histogram: {
        datasetId: ds.dataset.id,
        value: ds.col('y'),
        bins: { mode: 'count', count: 4 },
        groupBy: groupBy ? ds.col(groupBy) : null,
        groupMode,
      },
    })
  const one = buildFigure(deriveOnce([ds], hist('overlay', null)), figureContext())
  const ov = buildFigure(deriveOnce([ds], hist('overlay')), figureContext())
  const st = buildFigure(deriveOnce([ds], hist('stack')), figureContext())

  it('one bar trace per group on the SAME bin edges; group counts add up to the pooled counts (Σ = n)', () => {
    expect(uids(ov)).toEqual([
      `plot_1__${A}__histogram`,
      `plot_1__${B}__histogram`,
      `plot_1__${NONE}__histogram`,
    ])
    const pooled = traces(one)[0]
    for (const t of traces(ov)) {
      expect(t.x).toEqual(pooled.x)
      expect(t.width).toEqual(pooled.width)
    }
    const sum = pooled.y.map((_, j) => traces(ov).reduce((n, t) => n + t.y[j], 0))
    expect(sum).toEqual(pooled.y)
    expect(sum.reduce((a, b) => a + b, 0)).toBe(11)
    expect(traces(ov).map((t) => t.name)).toEqual(['A', 'B', 'legend.noValue'])
    expect(traces(ov)[0].legendgrouptitle).toEqual({ text: 'who' })
  })

  it('overlay: translucent with an outline, from zero; stack: stacked (no fixed base)', () => {
    expect(ov.layout.barmode).toBe('overlay')
    expect(traces(ov)[1]).toMatchObject({
      base: 0,
      marker: { color: withAlpha(SERIES_COLORS[1], 0.35), line: { color: SERIES_COLORS[1] } },
    })
    expect(st.layout.barmode).toBe('stack')
    expect(traces(st)[0].base).toBeUndefined()
  })

  it('the rows without a group stay in the histogram, reported; caption and summary say how it is grouped', () => {
    expect(ov.issues).toContainEqual(
      expect.objectContaining({ code: 'I_SPLIT_NO_VALUE', params: { count: 1, column: 'who' } }),
    )
    expect(ov.caption).toContain(
      'figure.caption.histogramGroups|{"column":"who","mode":"overlay","groups":"A: n = 5, B: n = 5, legend.noValue: n = 1"}',
    )
    expect(ov.a11y).toContain('figure.a11y.groupedBy|{"column":"who","count":3}')
  })

  it('every bar maps back to its rows (selection)', () => {
    const t = traces(ov)[2]
    const j = t.y.findIndex((c) => c > 0)
    expect(ov.selectionMap.members.get(t.uid)?.[j]).toHaveLength(1)
  })
})

describe('box colorByGroup and bar colorByCategory', () => {
  const box = (colorByGroup: boolean) =>
    buildFigure(
      deriveOnce(
        [ds],
        plotOf({
          type: 'box',
          box: {
            datasetId: ds.dataset.id,
            value: ds.col('y'),
            groupBy: ds.col('who'),
            points: 'all',
            showMean: false,
            colorByGroup,
          },
        }),
      ),
      figureContext(),
    )

  it('one coloured box trace per group with exactly the same (type 7) statistics', () => {
    const plain = box(false)
    const coloured = box(true)
    const b = trace(plain, 'plot_1__box')
    const boxes = traces(coloured).filter((t) => t.type === 'box')
    expect(boxes.map((t) => t.uid)).toEqual([`plot_1__${A}__box`, `plot_1__${B}__box`])
    for (const key of ['x', 'q1', 'median', 'q3', 'lowerfence', 'upperfence'])
      expect(boxes.flatMap((t) => t[key] as number[])).toEqual(b[key])
    expect(boxes.map((t) => t.line?.color)).toEqual([SERIES_COLORS[0], SERIES_COLORS[1]])
    expect(trace(coloured, 'plot_1__boxStats')).toEqual(trace(plain, 'plot_1__boxStats'))
    const pts = trace(coloured, 'plot_1__boxPoints')
    expect(new Set(pts.marker!.color as string[])).toEqual(new Set([SERIES_COLORS[0], SERIES_COLORS[1]]))
    expect(coloured.caption).toEqual(plain.caption)
  })

  it('bars coloured by category in one trace (selection unchanged); off keeps one colour', () => {
    const bar = (colorByCategory: boolean) =>
      buildFigure(
        deriveOnce(
          [ds],
          plotOf({
            type: 'bar',
            bar: {
              datasetId: ds.dataset.id,
              category: ds.col('who'),
              value: ds.col('y'),
              showObservations: true,
              colorByCategory,
              aggregate: 'mean',
              spread: { kind: 'sd' },
            },
          }),
        ),
        figureContext(),
      )
    const on = trace(bar(true), 'plot_1__bar')
    expect(on.marker).toMatchObject({
      color: [withAlpha(SERIES_COLORS[0], 0.8), withAlpha(SERIES_COLORS[1], 0.8)],
      line: { color: [SERIES_COLORS[0], SERIES_COLORS[1]] },
    })
    const off = trace(bar(false), 'plot_1__bar')
    expect(off.marker).toMatchObject({ color: withAlpha(SERIES_COLORS[0], 0.8) })
    const obs = trace(bar(true), 'plot_1__barPoints')
    expect(new Set(obs.marker!.color as string[]).size).toBe(2)
    expect(bar(true).selectionMap.members.get('plot_1__bar')).toEqual(
      bar(false).selectionMap.members.get('plot_1__bar'),
    )
  })
})
