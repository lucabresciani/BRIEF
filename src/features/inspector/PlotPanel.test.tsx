import { describe, expect, it } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AxisSpec, ColumnId, DatasetId, NotebookDataset, PlotSpec, SeriesId } from '@/domain/model'
import { DEFAULT_AXIS } from '@/domain/model'
import { checkRefs } from '@/domain/model/integrity'
import { I18nProvider } from '@/i18n/I18nProvider'
import { issueTitle, makeTranslator } from '@/i18n/translate'
import { loadProject, undo, useProjectStore } from '@/state/projectStore'
import { PlotPanel } from './PlotPanel'
import { DS, column, loadTestProject, notebook, plotWith, xySeries } from './testFixtures'

const t = makeTranslator('en')
const barsStartAtZero = issueTitle(t, { code: 'I_BAR_LINEAR_ONLY' })
const logLabel = new RegExp(`^${t('axes.log')}`)

/** A date/time column, a numeric one and a group label. */
const dataset = () =>
  notebook(
    {
      when: ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04'],
      T: ['20.5', '21.0', '22.4', '23.1'],
      g: ['A', 'A', 'B', 'B'],
    },
    [column('when', { kind: 'datetime' }), column('T'), column('g', { kind: 'categorical', role: 'group' })],
  )

const axis = (patch: Partial<AxisSpec> = {}): AxisSpec => ({ ...DEFAULT_AXIS, ...patch })
const barOptions: PlotSpec['bar'] = {
  datasetId: DS,
  category: 'g' as ColumnId,
  value: 'T' as ColumnId,
  showObservations: true,
  colorByCategory: false,
  aggregate: 'mean',
  spread: { kind: 'none' },
}

const renderPanel = () =>
  render(
    <I18nProvider lang="en">
      <PlotPanel />
    </I18nProvider>,
  )

/** Opens the scale list of the n-th open axis section and returns its "Logarithmic" option. */
async function logOption(index = 0) {
  await userEvent.click(screen.getAllByRole('combobox', { name: t('axes.scale') })[index])
  return screen.findByRole('option', { name: logLabel })
}

const openYAxis = () => userEvent.click(screen.getByRole('button', { name: t('axes.y') }))

describe('PlotPanel axis scale', () => {
  it('disables log on a date/time axis, with the reason', async () => {
    loadTestProject(dataset(), plotWith({ series: [xySeries('when', 'T')] }))
    renderPanel()
    const log = await logOption()
    expect(log).toHaveAttribute('aria-disabled', 'true')
    expect(log).toHaveTextContent(t('axes.logDate'))
  })

  it('keeps log available on a numeric axis', async () => {
    loadTestProject(dataset(), plotWith({ series: [xySeries('when', 'T')] }))
    renderPanel()
    await openYAxis()
    const log = await logOption(1)
    expect(log).not.toHaveAttribute('aria-disabled', 'true')
    expect(log).not.toHaveTextContent(t('axes.logDate'))
  })

  it('says a stored log scale on a date axis is drawn linear, without the positive-values hint', () => {
    loadTestProject(dataset(), plotWith({ series: [xySeries('when', 'T')], xAxis: axis({ scale: 'log' }) }))
    renderPanel()
    expect(screen.getByText(`${t('axes.logDate')} ${t('axes.drawnLinear')}`)).toBeInTheDocument()
    expect(screen.queryByText(t('axes.logHint'))).not.toBeInTheDocument()
  })

  it('disables log on the bar value axis with I_BAR_LINEAR_ONLY', async () => {
    loadTestProject(dataset(), plotWith({ type: 'bar', bar: barOptions }))
    renderPanel()
    await openYAxis()
    const log = await logOption()
    expect(log).toHaveAttribute('aria-disabled', 'true')
    expect(log).toHaveTextContent(barsStartAtZero)
  })

  it('explains a log scale kept from another plot type on the bar value axis', async () => {
    loadTestProject(dataset(), plotWith({ type: 'bar', bar: barOptions, yAxis: axis({ scale: 'log' }) }))
    renderPanel()
    await openYAxis()
    expect(screen.getByText(`${barsStartAtZero} ${t('axes.drawnLinear')}`)).toBeInTheDocument()
    expect(screen.queryByText(t('axes.logHint'))).not.toBeInTheDocument()
  })

  it('validates a fixed range on a bar value axis as linear, even with a stored log scale', async () => {
    loadTestProject(
      dataset(),
      plotWith({
        type: 'bar',
        bar: barOptions,
        yAxis: axis({ scale: 'log', range: { mode: 'fixed', min: 1, max: 30 } }),
      }),
    )
    renderPanel()
    await openYAxis()
    const min = screen.getByLabelText(t('common.minimum'))
    await userEvent.clear(min)
    await userEvent.type(min, '0{Enter}')
    expect(screen.queryByText(t('issues.E_LOG_RANGE_NONPOSITIVE.title'))).not.toBeInTheDocument()
    expect(useProjectStore.getState().doc.plots[0].yAxis.range).toEqual({ mode: 'fixed', min: 0, max: 30 })
  })

  it('disables log on both histogram axes, each with its reason', async () => {
    loadTestProject(
      dataset(),
      plotWith({
        type: 'histogram',
        histogram: {
          datasetId: DS,
          value: 'T' as ColumnId,
          bins: { mode: 'auto' },
          groupBy: null,
          groupMode: 'overlay',
        },
      }),
    )
    renderPanel()
    const x = await logOption(0)
    expect(x).toHaveAttribute('aria-disabled', 'true')
    expect(x).toHaveTextContent(t('axes.logBins'))
    await userEvent.keyboard('{Escape}')
    await openYAxis()
    const y = await logOption(1)
    expect(y).toHaveAttribute('aria-disabled', 'true')
    expect(y).toHaveTextContent(barsStartAtZero)
  })
})

describe('PlotPanel dataset of a distribution plot', () => {
  it('switching the histogram dataset drops the grouping column of the previous one', async () => {
    const other: NotebookDataset = {
      ...notebook({ v: ['1', '2', '3'] }, [column('v')]),
      id: 'ds_other' as DatasetId,
      name: 'Other data',
    }
    const doc = loadTestProject(
      dataset(),
      plotWith({
        type: 'histogram',
        histogram: {
          datasetId: DS,
          value: 'T' as ColumnId,
          bins: { mode: 'auto' },
          groupBy: 'g' as ColumnId,
          groupMode: 'stack',
        },
      }),
    )
    loadProject({ ...doc, datasets: [...doc.datasets, other] })
    renderPanel()
    await userEvent.click(screen.getByRole('combobox', { name: t('common.dataset') }))
    await userEvent.click(await screen.findByRole('option', { name: 'Other data' }))
    const after = useProjectStore.getState().doc
    expect(after.plots[0].histogram).toMatchObject({ datasetId: other.id, value: null, groupBy: null })
    expect(checkRefs(after)).toEqual([])
  })
})

describe('PlotPanel split by', () => {
  /** x, y, a label column, 60 distinct numbers, an empty column and a 3-valued number column. */
  const splitData = () => {
    const n = 60
    const rows = Array.from({ length: n }, (_, i) => i)
    return notebook(
      {
        x: rows.map((i) => String(i)),
        y: rows.map((i) => String(2 * i + 1)),
        g: rows.map((i) => (i % 2 ? 'B' : 'A')),
        many: rows.map((i) => String(i * 0.5)),
        empty: rows.map(() => ''),
        level: rows.map((i) => String(i % 3)),
      },
      [
        column('x'),
        column('y'),
        column('g', { kind: 'categorical', role: 'group' }),
        column('many'),
        column('empty'),
        column('level'),
      ],
    )
  }
  const splitBox = () => screen.getByRole('combobox', { name: t('series.split') })
  const option = (name: RegExp) => screen.findByRole('option', { name })

  it('offers every column the split can draw and says why the others are disabled', async () => {
    loadTestProject(splitData(), plotWith({ series: [xySeries('x', 'y')] }))
    renderPanel()
    await userEvent.click(splitBox())
    expect(await option(/^None \(one curve\)/)).not.toHaveAttribute('aria-disabled', 'true')
    const g = await option(/^g/)
    expect(g).not.toHaveAttribute('aria-disabled', 'true')
    expect(g).toHaveTextContent('2 groups')
    expect(await option(/^level/)).toHaveTextContent('3 groups')
    const many = await option(/^many/)
    expect(many).toHaveAttribute('aria-disabled', 'true')
    expect(many).toHaveTextContent('More than 50 different values')
    const empty = await option(/^empty/)
    expect(empty).toHaveAttribute('aria-disabled', 'true')
    expect(empty).toHaveTextContent('No readable values')
    expect(await option(/^x/)).toHaveTextContent('Plotted on the X axis')
    expect(await option(/^y/)).toHaveAttribute('aria-disabled', 'true')
  })

  it('splits the series by the chosen column in one undo step, listing its groups with their markers', async () => {
    loadTestProject(splitData(), plotWith({ series: [xySeries('x', 'y')] }))
    renderPanel()
    await userEvent.click(splitBox())
    await userEvent.click(await option(/^g/))
    const series = () => useProjectStore.getState().doc.plots[0].series[0]
    expect(series().split).toEqual({ column: 'g', overrides: [] })
    const last = useProjectStore.getState().past.at(-1)!
    expect(last.op).toBe('series.split')
    expect(t(last.label.key, last.label.params)).toBe('Split series y by g')
    const list = screen.getByRole('list', { name: 'Groups of y' })
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['A', 'B'])
    expect([...list.querySelectorAll('[data-swatch]')].map((s) => s.getAttribute('data-swatch'))).toEqual([
      'circle',
      'square',
    ])

    act(() => void undo())
    expect(series().split).toBeNull()
    expect(screen.queryByRole('list', { name: 'Groups of y' })).toBeNull()
  })

  it('choosing None draws the series whole again, and the history says so', async () => {
    loadTestProject(
      splitData(),
      plotWith({ series: [{ ...xySeries('x', 'y'), split: { column: 'g' as ColumnId, overrides: [] } }] }),
    )
    renderPanel()
    await userEvent.click(splitBox())
    await userEvent.click(await option(/^None/))
    expect(useProjectStore.getState().doc.plots[0].series[0].split).toBeNull()
    const last = useProjectStore.getState().past.at(-1)!
    expect(t(last.label.key, last.label.params)).toBe('Stopped splitting series y')
  })

  it('says next to the select when the stored split is not drawn (too many values)', () => {
    loadTestProject(
      splitData(),
      plotWith({ series: [{ ...xySeries('x', 'y'), split: { column: 'many' as ColumnId, overrides: [] } }] }),
    )
    renderPanel()
    expect(splitBox()).toHaveTextContent('many')
    const why = issueTitle(t, {
      code: 'W_SPLIT_TOO_MANY_GROUPS',
      params: { column: 'many', count: 60, limit: 50 },
    })
    expect(screen.getByText(why)).toBeInTheDocument()
    expect(screen.queryByText(t('series.splitHint'))).toBeNull()
  })

  it('shows the split hint once, under the first series that is not split', () => {
    loadTestProject(
      splitData(),
      plotWith({
        series: [
          { ...xySeries('x', 'y'), split: { column: 'g' as ColumnId, overrides: [] } },
          { ...xySeries('level', 'y'), id: 'ser_2' as SeriesId },
          { ...xySeries('many', 'y'), id: 'ser_3' as SeriesId },
        ],
      }),
    )
    renderPanel()
    const hints = screen.getAllByText(t('series.splitHint'))
    expect(hints).toHaveLength(1)
    expect(hints[0].closest('[data-series]')).toHaveAttribute('data-series', 'ser_2')
  })

  it('shows the series key: colour and marker of an unsplit series', () => {
    loadTestProject(splitData(), plotWith({ series: [xySeries('x', 'y')] }))
    renderPanel()
    const key = document.querySelector('[data-series] [data-swatch]')!
    expect(key.getAttribute('data-swatch')).toBe('circle')
    expect(key.getAttribute('data-color')).toBe('#0072B2')
  })

  it('names the series as the legend does: "y vs x" when two series would share a name', () => {
    loadTestProject(
      splitData(),
      plotWith({ series: [xySeries('x', 'y'), { ...xySeries('level', 'y'), id: 'ser_2' as SeriesId }] }),
    )
    renderPanel()
    expect(screen.getByText('y vs x')).toBeInTheDocument()
    expect(screen.getByText('y vs level')).toBeInTheDocument()
  })

  it('histogram: group by a column, then draw the groups stacked', async () => {
    loadTestProject(
      splitData(),
      plotWith({
        type: 'histogram',
        histogram: {
          datasetId: DS,
          value: 'y' as ColumnId,
          bins: { mode: 'auto' },
          groupBy: null,
          groupMode: 'overlay',
        },
      }),
    )
    renderPanel()
    expect(screen.queryByRole('combobox', { name: t('style.histogramGroupMode') })).toBeNull()
    await userEvent.click(screen.getByRole('combobox', { name: t('style.histogramGroup') }))
    expect(await option(/^y/)).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(await option(/^g/))
    expect(useProjectStore.getState().doc.plots[0].histogram.groupBy).toBe('g')
    await userEvent.click(screen.getByRole('combobox', { name: t('style.histogramGroupMode') }))
    await userEvent.click(await screen.findByRole('option', { name: t('style.groupModes.stack') }))
    expect(useProjectStore.getState().doc.plots[0].histogram).toMatchObject({
      groupBy: 'g',
      groupMode: 'stack',
    })
  })
})
