import { describe, expect, it } from 'vitest'
import { createDeriver } from '@/domain/derive/pipeline'
import type { PlotSpec } from '@/domain/model'
import { buildFigure } from './buildFigure'
import { LogTally, axisRange, drawableOn, lowerEndClipped } from './logDomain'
import { docOf, figureContext, fitOf, importCsv, plotOf, rawTablesOf, series } from './testing'

describe('logDomain primitives', () => {
  it('only positive finite values are drawable on a log axis', () => {
    expect(drawableOn(1e-300, 'log')).toBe(true)
    expect(drawableOn(0, 'log')).toBe(false)
    expect(drawableOn(-2, 'log')).toBe(false)
    expect(drawableOn(-2, 'linear')).toBe(true)
    expect(drawableOn(NaN, 'linear')).toBe(false)
  })

  it('a bar is clipped when its lower end is ≤ 0 on a log axis (NaN bars are no bars)', () => {
    expect(lowerEndClipped(4, 5, null, 'log')).toBe(true)
    expect(lowerEndClipped(4, 4, null, 'log')).toBe(true)
    expect(lowerEndClipped(4, 3.9, null, 'log')).toBe(false)
    expect(lowerEndClipped(4, 0.1, 4.5, 'log')).toBe(true) // asymmetric: the minus side counts
    expect(lowerEndClipped(4, 5, null, 'linear')).toBe(false)
    expect(lowerEndClipped(4, NaN, null, 'log')).toBe(false)
    expect(lowerEndClipped(-1, 5, null, 'log')).toBe(false) // the point itself is hidden, not clipped
  })

  it('fixed ranges are converted to log10 for log axes; invalid ones fall back to autorange with an issue', () => {
    expect(axisRange({ mode: 'auto' }, 'log')).toEqual({ range: null, issue: null })
    expect(axisRange({ mode: 'fixed', min: 0.01, max: 1000 }, 'log').range).toEqual([-2, 3])
    expect(axisRange({ mode: 'fixed', min: -1, max: 2 }, 'linear').range).toEqual([-1, 2])
    expect(axisRange({ mode: 'fixed', min: 0, max: 10 }, 'log').issue?.code).toBe('E_LOG_RANGE_NONPOSITIVE')
    expect(axisRange({ mode: 'fixed', min: 5, max: 1 }, 'linear').issue?.code).toBe('E_RANGE_INVERTED')
    expect(axisRange({ mode: 'fixed', min: NaN, max: 1 }, 'linear').range).toBeNull()
  })

  it('the tally deduplicates rows and reports counts with the rows', () => {
    const t = new LogTally()
    expect(t.issues()).toEqual([])
    t.hide(3)
    t.hide(3)
    t.hide(7)
    t.clip(2)
    t.clip([4, 5])
    const [hidden, clipped] = t.issues()
    expect(hidden).toMatchObject({
      code: 'W_LOG_AXIS_HIDDEN',
      severity: 'warning',
      params: { count: 2 },
      rows: [3, 7],
    })
    expect(clipped).toMatchObject({ code: 'W_LOG_AXIS_BARS_CLIPPED', params: { count: 2 }, rows: [2, 4, 5] })
  })
})

// x, y with one negative y (grid row 3) and a bar reaching below zero (grid row 4: y = 4, u = 5).
const CSV = 'x (s),y (m),u (m)\n1,2,0.5\n2,-1,0.1\n3,4,5\n4,8,0.2\n5,16,1\n6,30,2\n'

describe('log axes act only on the figure', () => {
  const ds = importCsv(CSV, 'ds_log')
  const s = series('ser_1', ds, 'x', 'y', {
    errorBars: {
      x: { kind: 'none' },
      y: {
        kind: 'measurement',
        origin: 'user',
        source: { type: 'column', column: ds.col('u') },
        meaning: { type: 'standard' },
      },
      visible: true,
    },
  })
  const fit = fitOf('fit_1', 'ser_1')
  const linear = plotOf({ series: [s] })
  const logY: PlotSpec = { ...linear, yAxis: { ...linear.yAxis, scale: 'log' } }
  const raws = rawTablesOf([ds])
  const derive = createDeriver()
  const doc = docOf([ds], linear, { fits: [fit] })
  const dLin = derive(doc, raws)
  const dLog = derive({ ...doc, plots: [logY] }, raws)

  it('hides the point ≤ 0 only in the drawing and reports it with its row', () => {
    const fig = buildFigure(dLog, figureContext())
    const hidden = fig.issues.find((i) => i.code === 'W_LOG_AXIS_HIDDEN')
    expect(hidden).toMatchObject({ params: { count: 1 }, rows: [2] })
    const pts = fig.data.find((t) => t.uid === 'ser_1__points') as { y: number[]; customdata: unknown[][] }
    expect(pts.y).toEqual([2, 4, 8, 16, 30])
    expect(pts.customdata.map((c) => c[0])).toEqual([1, 3, 4, 5, 6])
    expect(fig.layout.yaxis?.type).toBe('log')
    // Linear axis: nothing hidden, nothing clipped.
    const lin = buildFigure(dLin, figureContext())
    expect(lin.issues.filter((i) => i.code.startsWith('W_LOG'))).toEqual([])
  })

  it('counts error bars whose lower end is ≤ 0 (Plotly clips them silently)', () => {
    const fig = buildFigure(dLog, figureContext())
    expect(fig.issues.find((i) => i.code === 'W_LOG_AXIS_BARS_CLIPPED')).toMatchObject({
      params: { count: 1 },
      rows: [3],
    })
    // The bar arrays are unchanged: the figure reports, it does not alter the uncertainty.
    const pts = fig.data.find((t) => t.uid === 'ser_1__points') as { error_y: { array: number[] } }
    expect(pts.error_y.array).toEqual([0.5, 5, 0.2, 1, 2])
  })

  it('leaves the analysed sample and the fit object unchanged (same references)', () => {
    const a = dLin.series[0]
    const b = dLog.series[0]
    expect(b.data.sample).toBe(a.data.sample)
    expect(b.fit).toBe(a.fit)
    expect(b.data.sample.nActive).toBe(6)
    expect(a.fit?.status === 'ok' && a.fit.provenance.nUsed).toBe(6)
    expect(dLog.columnSummary(ds.dataset.id, ds.col('y'))).toBe(
      dLin.columnSummary(ds.dataset.id, ds.col('y')),
    )
  })

  it('a log x axis also hides residuals at x ≤ 0 and starts the curve at the smallest positive x', () => {
    const csv = 'x (s),y (m)\n-1,1\n0,2\n1,3.1\n2,3.9\n4,6.2\n'
    const d2 = importCsv(csv, 'ds_logx')
    const plot = plotOf({
      series: [series('ser_2', d2, 'x', 'y')],
      scatter: { residualPanel: true, showExcluded: true },
    })
    const logX: PlotSpec = { ...plot, xAxis: { ...plot.xAxis, scale: 'log' } }
    const d = createDeriver()(docOf([d2], logX, { fits: [fitOf('fit_2', 'ser_2')] }), rawTablesOf([d2]))
    const fig = buildFigure(d, figureContext())
    expect(fig.issues.find((i) => i.code === 'W_LOG_AXIS_HIDDEN')).toMatchObject({
      params: { count: 2 },
      rows: [1, 2],
    })
    const res = fig.data.find((t) => t.uid === 'ser_2__residuals') as { x: number[] }
    expect(res.x).toEqual([1, 2, 4])
    const curve = fig.data.find((t) => t.uid === 'ser_2__fit') as { x: number[] }
    expect(curve.x[0]).toBe(1)
    expect(curve.x[curve.x.length - 1]).toBe(4)
    expect(curve.x.every((v) => v > 0)).toBe(true)
    // The fit still used all 5 rows.
    expect(d.series[0].fit?.status === 'ok' && d.series[0].fit.provenance.nUsed).toBe(5)
  })
})
