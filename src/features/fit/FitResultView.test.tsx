import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { importText } from '@/domain/import/importPipeline'
import { buildDatasetView } from '@/domain/derive/datasetView'
import { createDeriver, type DerivedSeries } from '@/domain/derive/pipeline'
import { initialPlot } from '@/domain/recommend/recommend'
import type {
  ColumnId,
  DatasetId,
  FitModel,
  ImportedDataset,
  PlotId,
  ProjectDoc,
  ProjectId,
  RawTable,
  SeriesId,
} from '@/domain/model'
import { I18nProvider } from '@/i18n/I18nProvider'
import type { Lang } from '@/i18n/translate'
import { FitResultView } from './FitResultView'
import { asOk, fitOf, fitSpec, param, withParams } from './fitFixtures'

const NOW = '2026-10-14T00:00:00.000Z'

/** An example through the real import, recommendation and derivation, with one fit on its series. */
function exampleSeries(file: string, model: FitModel, yColumn?: string): DerivedSeries {
  const r = importText(readFileSync(resolve('src/examples', file), 'utf8'), {
    kind: 'example',
    fileName: file,
  })
  if (!r.ok) throw new Error(`import of ${file} failed: ${r.error.code}`)
  const d = r.value
  const dataset: ImportedDataset = {
    id: 'ds_1' as DatasetId,
    name: d.suggestedName,
    createdAt: NOW,
    example: null,
    columns: d.columns,
    notes: d.notes,
    origin: 'import',
    rawTableId: d.rawTable.id,
    layout: d.layout,
  }
  const { plot } = initialPlot(
    dataset,
    buildDatasetView(dataset, d.rawTable),
    'plot_1' as PlotId,
    'ser_1' as SeriesId,
  )
  if (yColumn !== undefined && (plot.type === 'scatter' || plot.type === 'line')) {
    const y = dataset.columns.find((c) => c.name === yColumn)
    if (!y) throw new Error(`no column ${yColumn}`)
    plot.series[0] = { ...plot.series[0], y: y.id as ColumnId }
  }
  const doc: ProjectDoc = {
    id: 'proj_1' as ProjectId,
    name: 'test',
    createdAt: NOW,
    updatedAt: NOW,
    datasets: [dataset],
    plots: [plot],
    activePlotId: plot.id,
    fits: [fitSpec(model, 'ser_1')],
    exclusions: [],
    filters: [],
    numberFormat: { decimal: 'auto' },
  } as ProjectDoc
  const rawTables: Record<string, RawTable> = { [d.rawTable.id]: d.rawTable }
  const series = createDeriver()(doc, rawTables).series[0]
  if (!series) throw new Error(`no series for ${file}`)
  return series
}

function renderFit(series: DerivedSeries, lang: Lang = 'en', result = asOk(series.fit)) {
  render(
    <I18nProvider lang={lang}>
      <FitResultView series={series} result={result} />
    </I18nProvider>,
  )
}

/** The value and CI cells of the row headed `header`. */
function row(header: string): { value: string; ci: string } {
  const table = screen.getByTestId('fit-parameters')
  const tr = within(table).getByRole('rowheader', { name: header }).closest('tr')
  if (!tr) throw new Error(`no row ${header}`)
  const [value, ci] = within(tr).getAllByRole('cell')
  return { value: value.textContent ?? '', ci: ci.textContent ?? '' }
}

describe('FitResultView — equation and parameter table', () => {
  it('Ohm (English): V = −0.009 + 47.15·I, (47.15 ± 0.08) V/A, CI at the SE place', () => {
    renderFit(exampleSeries('ohm.csv', { type: 'linear' }))
    expect(screen.getByTestId('fit-equation')).toHaveTextContent('V = −0.009 + 47.15·I')
    expect(row('b₁')).toEqual({ value: '(47.15 ± 0.08)\u00a0V/A', ci: '[46.97; 47.32]' })
    expect(row('b₀')).toEqual({ value: '(−0.009 ± 0.005)\u00a0V', ci: '[−0.020; 0.002]' })
    expect(screen.getByRole('columnheader', { name: '95 % CI' })).toBeInTheDocument()
    // Original form: no note about the form of the table.
    expect(screen.queryByTestId('fit-params-form')).toBeNull()
  })

  it('Ohm (Italian): decimal comma everywhere, "IC 95 %"', () => {
    renderFit(exampleSeries('ohm.csv', { type: 'linear' }), 'it')
    expect(screen.getByTestId('fit-equation')).toHaveTextContent('V = −0,009 + 47,15·I')
    expect(row('b₁')).toEqual({ value: '(47,15 ± 0,08)\u00a0V/A', ci: '[46,97; 47,32]' })
    expect(screen.getByRole('columnheader', { name: 'IC 95 %' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Stima ± SE' })).toBeInTheDocument()
  })

  it('free fall: centred equation, original-form a₂, and g = 2·a₂ with its confidence interval', () => {
    renderFit(exampleSeries('freeFall.csv', { type: 'polynomial', degree: 2 }))
    expect(screen.getByTestId('fit-equation')).toHaveTextContent(
      'y = 0.5278 + 3.197·(t − 0.3) + 4.93·(t − 0.3)²',
    )
    expect(row('a₂')).toEqual({ value: '(4.93 ± 0.04)\u00a0m/s²', ci: '[4.85; 5.01]' })
    expect(row('a₀').value).toBe('(0.0123 ± 0.0025)\u00a0m')
    expect(row('g = 2·a₂')).toEqual({ value: '(9.86 ± 0.07)\u00a0m/s²', ci: '[9.70; 10.01]' })
    // The equation reads 0.5278 and 3.197, the table a₀ = 0.0123 and a₁ = 0.240: say why.
    expect(screen.getByTestId('fit-params-form')).toHaveTextContent(
      'The table gives the coefficients of the original form, in powers of t rather than (t − 0.3).',
    )
  })

  it('free fall (Italian): g row with comma decimals', () => {
    renderFit(exampleSeries('freeFall.csv', { type: 'polynomial', degree: 2 }), 'it')
    expect(screen.getByTestId('fit-equation')).toHaveTextContent(
      'y = 0,5278 + 3,197·(t − 0,3) + 4,93·(t − 0,3)²',
    )
    expect(row('g = 2·a₂')).toEqual({ value: '(9,86 ± 0,07)\u00a0m/s²', ci: '[9,70; 10,01]' })
    expect(screen.getByTestId('fit-params-form')).toHaveTextContent(
      'La tabella riporta i coefficienti della forma originale, in potenze di t anziché di (t − 0,3).',
    )
  })

  it('exponential (cooling): a rounded like its asymmetric interval, with the note', () => {
    renderFit(exampleSeries('cooling.csv', { type: 'exponential' }, 'ΔT'))
    expect(screen.getByTestId('fit-equation')).toHaveTextContent('ΔT = 63.17 · e^(−0.04014 · t)')
    const a = row('a')
    expect(a.value).toBe('63.17\u00a0KAsymmetric interval: exp of the interval of ln a.')
    expect(a.ci).toBe('[62.87; 63.47]')
  })

  it('tiny and large-SE coefficients keep their power of ten in the value and in the CI', () => {
    const series = exampleSeries('ohm.csv', { type: 'linear' })
    const fit = withParams(asOk(series.fit), [
      param('b₀', 1006.5, 50.35, 'V'),
      param('b₁', -3.4000357e-6, 1.89e-9, 'V/A'),
    ])
    renderFit(series, 'en', fit)
    expect(screen.getByTestId('fit-equation')).toHaveTextContent('V = 1.01×10³ − 3.4000×10⁻⁶·I')
    expect(row('b₀')).toEqual({ value: '(1.01 ± 0.05)×10³\u00a0V', ci: '[0.90; 1.12]×10³' })
    expect(row('b₁')).toEqual({ value: '(−3.4000 ± 0.0019)×10⁻⁶\u00a0V/A', ci: '[−3.4042; −3.3959]×10⁻⁶' })
  })

  it('exact exponential fit: no interval for a, so no note about an asymmetric interval', () => {
    const series = exampleSeries('cooling.csv', { type: 'exponential' }, 'ΔT')
    const exact = fitOf({ type: 'exponential' }, [0, 1, 2, 3], [1, Math.E, Math.E ** 2, Math.E ** 3])
    expect(exact.exactFit).toBe(true)
    renderFit(series, 'en', exact)
    expect(row('a')).toEqual({ value: '1.00000', ci: 'n/a' })
    expect(screen.queryByText('Asymmetric interval: exp of the interval of ln a.')).toBeNull()
  })

  it('an empty unit gets no brackets, like no unit at all', () => {
    const series = exampleSeries('ohm.csv', { type: 'linear' })
    const fit = withParams(asOk(series.fit), [param('b₀', -0.009, 0.005, ''), param('b₁', 47.15, 0.08)])
    renderFit(series, 'en', fit)
    expect(row('b₀').value).toBe('−0.009 ± 0.005')
    expect(row('b₁').value).toBe('47.15 ± 0.08')
  })
})

describe('FitResultView — the "?" next to the residual SD', () => {
  it('explains s itself (not the SE paragraph below it) and opens on click', async () => {
    const user = userEvent.setup()
    renderFit(exampleSeries('ohm.csv', { type: 'linear' }))
    const tip = screen.getByRole('button', {
      name: /^Residual SD \(s\): The typical distance of the points from the curve, measured vertically: s = √\(Σ residuals² \/ df\)\./,
    })
    await user.click(tip)
    expect(await screen.findByRole('dialog')).toHaveTextContent(
      'The SEs of the parameters are computed from it.',
    )
  })

  it('on a log model says that s is measured on ln y, without a unit', () => {
    renderFit(exampleSeries('cooling.csv', { type: 'exponential' }, 'ΔT'))
    expect(
      screen.getByRole('button', { name: /^Residual SD \(s\): .*measured vertically on ln y.*with no unit/ }),
    ).toBeInTheDocument()
  })

  it('Italian', async () => {
    const user = userEvent.setup()
    renderFit(exampleSeries('ohm.csv', { type: 'linear' }), 'it')
    const tip = screen.getByRole('button', {
      name: /^Deviazione standard dei residui \(s\): La distanza tipica dei punti dalla curva/,
    })
    await user.click(tip)
    expect(await screen.findByRole('dialog')).toHaveTextContent('Da s si calcolano gli SE dei parametri.')
  })
})
