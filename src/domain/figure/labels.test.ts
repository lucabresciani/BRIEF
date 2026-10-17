import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PlotSpec, SeriesId } from '@/domain/model'
import { en } from '@/i18n/en'
import { it as itDict } from '@/i18n/it'
import { makeTranslator } from '@/i18n/translate'
import { plotLabel, seriesLabels } from './labels'
import { fakeT, importCsv, plotOf, series } from './testing'

const ohm = importCsv(readFileSync(resolve('src/examples/ohm.csv'), 'utf8'), 'ds_ohm')
const pendulum = importCsv(readFileSync(resolve('src/examples/pendulum.csv'), 'utf8'), 'ds_pend')
const datasets = [ohm.dataset, pendulum.dataset]
const label = (plot: PlotSpec, index = 0) => plotLabel(plot, index, datasets, fakeT)

describe('plotLabel', () => {
  const scatter = plotOf({ series: [series('s1', ohm, 'I', 'V')] })

  it('the name first, then the title (trimmed)', () => {
    expect(label({ ...scatter, name: '  Calibration ', title: 'Ohm' })).toBe('Calibration')
    expect(label({ ...scatter, name: '  ', title: ' Ohm law ' })).toBe('Ohm law')
  })

  it('else "{y} vs {x}" with the names the axes show', () => {
    expect(label(scatter)).toBe('plot.label.versus|{"y":"V","x":"I"}')
    const relabelled = { ...scatter, yAxis: { ...scatter.yAxis, label: 'Voltage' } }
    expect(label(relabelled)).toBe('plot.label.versus|{"y":"Voltage","x":"I"}')
    const two = plotOf({ series: [series('s1', ohm, 'I', 'V'), series('s2', pendulum, 'trial', 'T')] })
    expect(label(two)).toBe('plot.label.versus|{"y":"V, T","x":"I, trial"}')
  })

  it('histogram and box plots without groups name their one variable; bar and grouped box plots a pair', () => {
    const p = pendulum.dataset.id
    const T = pendulum.col('T')
    const obs = pendulum.col('observer')
    const base = plotOf()
    expect(
      label({ ...base, type: 'histogram', histogram: { ...base.histogram, datasetId: p, value: T } }),
    ).toBe('T')
    expect(label({ ...base, type: 'box', box: { ...base.box, datasetId: p, value: T, groupBy: null } })).toBe(
      'T',
    )
    expect(label({ ...base, type: 'box', box: { ...base.box, datasetId: p, value: T, groupBy: obs } })).toBe(
      'plot.label.versus|{"y":"T","x":"observer"}',
    )
    const bar: PlotSpec = {
      ...base,
      type: 'bar',
      bar: { ...base.bar, datasetId: p, category: obs, value: T },
    }
    expect(label(bar)).toBe('plot.label.versus|{"y":"T","x":"observer"}')
  })

  it('else "Plot {n}" (n = position + 1), also when the plotted columns no longer exist', () => {
    expect(label(plotOf(), 2)).toBe('plot.label.numbered|{"n":3}')
    const gone = plotOf({ series: [{ ...series('s1', ohm, 'I', 'V'), y: 'col_gone' as never }] })
    expect(label(gone, 0)).toBe('plot.label.numbered|{"n":1}')
    const bar = plotOf({ type: 'bar' })
    expect(
      label({ ...bar, bar: { ...bar.bar, datasetId: pendulum.dataset.id, value: pendulum.col('T') } }, 1),
    ).toBe('plot.label.numbered|{"n":2}')
  })

  it('an axis label names a variable only while the plot draws one on that axis', () => {
    // The axes are shared by the plot types: labels typed on a scatter plot stay when it becomes a bar,
    // histogram or box plot whose columns are not chosen yet.
    const labelled = {
      ...scatter,
      xAxis: { ...scatter.xAxis, label: 'Current' },
      yAxis: { ...scatter.yAxis, label: 'Voltage' },
    }
    expect(label(labelled)).toBe('plot.label.versus|{"y":"Voltage","x":"Current"}')
    for (const type of ['bar', 'histogram', 'box'] as const)
      expect(label({ ...labelled, type }, 1), type).toBe('plot.label.numbered|{"n":2}')
    expect(label({ ...labelled, series: [] }, 0)).toBe('plot.label.numbered|{"n":1}')
    // With its variable chosen, a histogram takes the typed label of the axis it draws on.
    const p = pendulum.dataset.id
    const histogram: PlotSpec = {
      ...labelled,
      type: 'histogram',
      histogram: { ...labelled.histogram, datasetId: p, value: pendulum.col('T') },
    }
    expect(label(histogram)).toBe('Current')
  })

  it('reads naturally in both languages', () => {
    expect(en.plot.label.versus).toBe('{y} vs {x}')
    expect(itDict.plot.label.numbered).toBe('Grafico {n}')
    expect(plotLabel(scatter, 0, datasets, makeTranslator('en'))).toBe('V vs I')
    expect(plotLabel(plotOf(), 1, datasets, makeTranslator('it'))).toBe('Grafico 2')
  })
})

describe('seriesLabels', () => {
  const cooling = importCsv(readFileSync(resolve('src/examples/cooling.csv'), 'utf8'), 'ds_cool')
  const all = [ohm.dataset, pendulum.dataset, cooling.dataset]
  const labels = (list: Parameters<typeof seriesLabels>[0], t = fakeT) => [
    ...seriesLabels(list, all, t).values(),
  ]

  it('the typed name, else the y column, prefixed by the dataset when the plot shows several', () => {
    expect(
      labels([series('a', cooling, 't', 'T'), series('b', cooling, 't', 'ΔT', { name: ' Excess ' })]),
    ).toEqual(['T', 'Excess'])
    expect(labels([series('a', ohm, 'I', 'V'), series('b', pendulum, 'trial', 'T')])).toEqual([
      `${ohm.dataset.name} · V`,
      `${pendulum.dataset.name} · T`,
    ])
    const map = seriesLabels([series('a', ohm, 'I', 'V')], all, fakeT)
    expect(map.get('a' as SeriesId)).toBe('V')
  })

  it('names that would be equal become "{y} vs {x}"; still equal, they get their position', () => {
    const en = makeTranslator('en')
    expect(labels([series('a', cooling, 't', 'T'), series('b', cooling, 'ΔT', 'T')], en)).toEqual([
      'T vs t',
      'T vs ΔT',
    ])
    // Only the names that clash change.
    expect(
      labels(
        [series('a', cooling, 't', 'T'), series('b', cooling, 'ΔT', 'T'), series('c', cooling, 't', 'ΔT')],
        en,
      ),
    ).toEqual(['T vs t', 'T vs ΔT', 'ΔT'])
    expect(labels([series('a', ohm, 'I', 'V'), series('b', ohm, 'I', 'V')], en)).toEqual([
      'V vs I (1)',
      'V vs I (2)',
    ])
    // Two datasets: the prefix stays.
    const twice = [
      series('a', cooling, 't', 'T'),
      series('b', cooling, 'ΔT', 'T'),
      series('c', ohm, 'I', 'V'),
    ]
    expect(labels(twice, en)).toEqual([
      `${cooling.dataset.name} · T vs t`,
      `${cooling.dataset.name} · T vs ΔT`,
      `${ohm.dataset.name} · V`,
    ])
    expect(labels([series('a', ohm, 'I', 'V'), series('b', ohm, 'I', 'V')], makeTranslator('it'))).toEqual([
      'V vs I (1)',
      'V vs I (2)',
    ])
  })

  it('a typed name is kept as typed; an automatic name equal to it changes', () => {
    const en = makeTranslator('en')
    expect(labels([series('a', ohm, 'I', 'V', { name: 'V' }), series('b', ohm, 'I', 'V')], en)).toEqual([
      'V',
      'V vs I',
    ])
    expect(
      labels([series('a', ohm, 'I', 'V', { name: 'Run' }), series('b', ohm, 'I', 'V', { name: 'Run' })], en),
    ).toEqual(['Run', 'Run'])
  })
})
