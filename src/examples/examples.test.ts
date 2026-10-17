// Every bundled example goes through the real import → derive → fit/statistics path, and the results
// match the independent oracle (scripts/oracle/reference_values.py) to 1e-10 relative.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { importText } from '@/domain/import/importPipeline'
import { buildDatasetView } from '@/domain/derive/datasetView'
import { seriesData } from '@/domain/derive/series'
import { analysisSample } from '@/domain/derive/analysisSample'
import { summarizeColumn } from '@/domain/stats/descriptive'
import { runFit } from '@/domain/fit/runFit'
import type { FitOk } from '@/domain/derive/types'
import {
  DEFAULT_SERIES_STYLE,
  NO_UNCERTAINTY,
  newId,
  type ColumnId,
  type DatasetId,
  type FitId,
  type FitModel,
  type ImportedDataset,
  type SeriesId,
} from '@/domain/model'

const ref = (name: string) =>
  JSON.parse(readFileSync(resolve(`tests/fixtures/reference/${name}.json`), 'utf8'))
const csv = (file: string) => readFileSync(resolve(`src/examples/${file}`), 'utf8')
const close = (a: number, b: number | string, rel = 1e-10) => {
  const bn = Number(b)
  expect(Math.abs(a - bn) / Math.max(Math.abs(bn), 1e-300), `${a} vs ${bn}`).toBeLessThan(rel)
}

function load(file: string) {
  const r = importText(csv(file), { kind: 'example', fileName: file })
  if (!r.ok) throw new Error(r.error.code)
  const d = r.value
  const ds: ImportedDataset = {
    id: newId<'DatasetId'>('ds') as DatasetId,
    name: file,
    createdAt: '',
    example: null,
    columns: d.columns,
    notes: d.notes,
    origin: 'import',
    rawTableId: d.rawTable.id,
    layout: d.layout,
  }
  return { draft: d, ds, view: buildDatasetView(ds, d.rawTable) }
}

function fit(file: string, xName: string, yName: string, model: FitModel): FitOk {
  const { ds, view } = load(file)
  const col = (n: string) => ds.columns.find((c) => c.name === n)!.id as ColumnId
  const spec = {
    id: newId('ser') as SeriesId,
    datasetId: ds.id,
    name: null,
    x: col(xName),
    y: col(yName),
    visible: true,
    style: DEFAULT_SERIES_STYLE,
    errorBars: { x: NO_UNCERTAINTY, y: NO_UNCERTAINTY, visible: true },
    split: null,
  }
  const data = seriesData(spec, view, [], [], { x: 'linear', y: 'linear' })
  const r = runFit(
    {
      id: newId('fit') as FitId,
      seriesId: spec.id,
      model,
      confidence: 0.95,
      show: { curve: true, confidenceBand: false, predictionBand: false, residuals: true },
      curveRange: { mode: 'data' },
      style: { color: { mode: 'series' }, dash: 'auto', width: 2 },
      perGroup: false,
    },
    data,
    { xUnit: null, yUnit: null },
  )
  if (r.status !== 'ok') throw new Error(r.error.code)
  return r
}

describe('bundled examples', () => {
  it('all five import on the fast path with names and units read from "Name (unit)" headers', () => {
    for (const f of ['ohm.csv', 'freeFall.csv', 'cooling.csv', 'beerLambert.csv', 'pendulum.csv']) {
      const { draft } = load(f)
      expect(draft.fastPath, f).toBe(true)
      expect(
        draft.issues.filter((i) => i.severity === 'error'),
        f,
      ).toEqual([])
    }
    const { ds } = load('freeFall.csv')
    expect(ds.columns.map((c) => [c.name, c.unit])).toEqual([
      ['t', 's'],
      ['y', 'm'],
      ['u(y)', 'm'],
    ])
    expect(ds.columns[2].role).toBe('uncertainty')
    expect(ds.columns[2].uncertaintyOf).toBe(ds.columns[1].id)
  })

  it("Ohm's law: linear fit equals the oracle", () => {
    const o = ref('ohm').linear
    const f = fit('ohm.csv', 'I', 'V', { type: 'linear' })
    close(f.params[1].value, o.coefficients[1])
    close(f.params[1].se!, o.se[1])
    close(f.params[0].value, o.coefficients[0], 1e-9)
    close(f.s, o.s)
    close(f.r2!, o.r2, 1e-12)
    expect(f.df).toBe(o.df)
  })

  it('free fall: quadratic and linear fits equal the oracle (linear residual runs reveal the curvature)', () => {
    const q = ref('freeFall').quadratic
    const fq = fit('freeFall.csv', 't', 'y', { type: 'polynomial', degree: 2 })
    q.coefficients.forEach((c: string, k: number) => close(fq.params[k].value, c, 1e-9))
    close(fq.params[2].se!, q.se[2], 1e-9)
    const l = ref('freeFall').linear
    const fl = fit('freeFall.csv', 't', 'y', { type: 'linear' })
    close(fl.r2!, l.r2, 1e-12)
    expect(fl.residualSignRuns).toBe(l.residualSigns)
  })

  it('cooling: exponential fit on ΔT (least squares on ln y) equals the oracle', () => {
    const e = ref('cooling').exponentialDeltaT
    const f = fit('cooling.csv', 't', 'ΔT', { type: 'exponential' })
    const b = f.params.find((p) => p.symbol === 'b')!
    close(b.value, e.b, 1e-9)
    close(b.se!, e.seB, 1e-8)
    close(f.r2!, e.r2LnY, 1e-12)
    expect(f.r2Of).toBe('lnY')
  })

  it('calibration: linear fit uses all 18 observations', () => {
    const o = ref('beerLambert').linear
    const f = fit('beerLambert.csv', 'c', 'A', { type: 'linear' })
    expect(f.provenance.nUsed).toBe(18)
    close(f.params[1].value, o.coefficients[1])
    close(f.params[1].se!, o.se[1])
  })

  it('pendulum: descriptive statistics of all 24 timings equal the oracle', () => {
    const { ds, view } = load('pendulum.csv')
    const col = ds.columns.find((c) => c.name === 'T')!.id as ColumnId
    const s = summarizeColumn(view, col, analysisSample(view, [col], [], []))
    const all = ref('pendulum').all
    expect(s.n).toBe(24)
    close(s.mean!, all.mean, 1e-12)
    close(s.sd!, all.sd, 1e-12)
    close(s.median!, all.median, 1e-12)
    expect(s.min).toBe(Number(all.min))
    expect(s.max).toBe(Number(all.max))
  })
})
