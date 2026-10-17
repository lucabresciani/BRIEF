import { describe, expect, it } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ColumnId, FitModel, SeriesId } from '@/domain/model'
import { I18nProvider } from '@/i18n/I18nProvider'
import { makeTranslator } from '@/i18n/translate'
import { deriveNow } from '@/state/derived'
import { loadProject, useProjectStore } from '@/state/projectStore'
import { useUiStore, type Level } from '@/state/uiStore'
import { FitPanel } from './FitPanel'
import { column, fit, loadTestProject, notebook, plotWith, xySeries } from './testFixtures'

const t = makeTranslator('en')
// 12 distinct x: the degree cap is 3 in Intermediate and 6 in Advanced (also min(distinct x − 1, n − 2)).
const noise = [0.3, -0.2, 0.1, -0.4, 0.25, -0.1, 0.05, 0.2, -0.3, 0.15, -0.05, 0.1]
const xs = noise.map((_, i) => i + 1)
const dataset = () =>
  notebook(
    {
      x: xs.map(String),
      y: xs.map((x, i) => String(0.5 * x ** 3 - 2 * x ** 2 + x + noise[i])),
    },
    [column('x'), column('y')],
  )

function setup(model: FitModel | null, level: Level) {
  loadTestProject(dataset(), plotWith({ series: [xySeries('x', 'y')] }), {
    fits: model ? [fit(model)] : [],
    level,
  })
  return render(
    <I18nProvider lang="en">
      <FitPanel />
    </I18nProvider>,
  )
}

const storedModel = () => useProjectStore.getState().doc.fits[0]?.model
const degreeField = () => screen.getByLabelText(t('fit.degree'))
const capError = (max: number) => t('common.wholeNumberBetween', { min: 2, max })

describe('FitPanel polynomial degree stays within what runFit accepts (1 to 10)', () => {
  it('opens a project with degree 7 at Intermediate: shown as stored, fitted, nothing rewritten', () => {
    setup({ type: 'polynomial', degree: 7 }, 'intermediate')
    expect(degreeField()).toHaveValue('7')
    expect(screen.getByRole('heading', { name: t('fit.parameters') })).toBeInTheDocument()
    expect(deriveNow().series[0].fit?.status).toBe('ok')
    expect(storedModel()).toEqual({ type: 'polynomial', degree: 7 })
  })

  it('keeps a degree-6 fit when the level drops from Advanced to Intermediate', () => {
    setup({ type: 'polynomial', degree: 6 }, 'advanced')
    expect(degreeField()).toHaveValue('6')
    act(() => useUiStore.setState({ level: 'intermediate' }))
    expect(degreeField()).toHaveValue('6')
    expect(storedModel()).toEqual({ type: 'polynomial', degree: 6 })
    expect(deriveNow().series[0].fit?.status).toBe('ok')
  })

  it('does not report an error when a degree above the level cap is left unchanged', async () => {
    setup({ type: 'polynomial', degree: 6 }, 'intermediate')
    await userEvent.click(degreeField())
    await userEvent.tab()
    expect(screen.queryByText(capError(3))).not.toBeInTheDocument()
    expect(storedModel()).toEqual({ type: 'polynomial', degree: 6 })
  })

  it.each(['4', '11', '0', '2.5', '-1'])(
    'refuses degree %s at Intermediate and keeps the stored one',
    async (v) => {
      setup({ type: 'polynomial', degree: 6 }, 'intermediate')
      await userEvent.clear(degreeField())
      await userEvent.type(degreeField(), `${v}{Enter}`)
      expect(storedModel()).toEqual({ type: 'polynomial', degree: 6 })
      expect(screen.getByRole('alert')).toHaveTextContent(/2|3|negative/i)
    },
  )

  it('accepts a degree within the cap', async () => {
    setup({ type: 'polynomial', degree: 6 }, 'intermediate')
    await userEvent.clear(degreeField())
    await userEvent.type(degreeField(), '3{Enter}')
    expect(storedModel()).toEqual({ type: 'polynomial', degree: 3 })
  })

  it('switching the model back to polynomial stores a degree within the cap', async () => {
    setup({ type: 'polynomial', degree: 7 }, 'intermediate')
    await userEvent.click(screen.getByRole('combobox', { name: t('fit.model') }))
    await userEvent.click(await screen.findByRole('option', { name: t('fit.models.linear') }))
    expect(storedModel()).toEqual({ type: 'linear' })
    await userEvent.click(screen.getByRole('combobox', { name: t('fit.model') }))
    await userEvent.click(await screen.findByRole('option', { name: t('fit.models.polynomial') }))
    expect(storedModel()).toEqual({ type: 'polynomial', degree: 2 })
  })

  it('a new-fit degree picked in Advanced shows and adds the Intermediate cap after the level drops', async () => {
    setup(null, 'advanced')
    await userEvent.click(screen.getByRole('combobox', { name: t('fit.model') }))
    await userEvent.click(await screen.findByRole('option', { name: t('fit.models.polynomial') }))
    await userEvent.clear(degreeField())
    await userEvent.type(degreeField(), '6{Enter}')
    act(() => useUiStore.setState({ level: 'intermediate' }))
    expect(degreeField()).toHaveValue('3')
    await userEvent.click(screen.getByTestId('add-fit'))
    expect(storedModel()).toEqual({ type: 'polynomial', degree: 3 })
  })

  it('a new-fit model offered only in Advanced falls back to linear after the level drops', async () => {
    setup(null, 'advanced')
    await userEvent.click(screen.getByRole('combobox', { name: t('fit.model') }))
    await userEvent.click(await screen.findByRole('option', { name: t('fit.models.exponential') }))
    expect(screen.getByRole('combobox', { name: t('fit.model') })).toHaveTextContent(
      t('fit.models.exponential'),
    )
    act(() => useUiStore.setState({ level: 'intermediate' }))
    expect(screen.getByRole('combobox', { name: t('fit.model') })).toHaveTextContent(t('fit.models.linear'))
    await userEvent.click(screen.getByTestId('add-fit'))
    expect(storedModel()).toEqual({ type: 'linear' })
  })

  it('adds a polynomial fit with a degree within the cap only', async () => {
    setup(null, 'intermediate')
    await userEvent.click(screen.getByRole('combobox', { name: t('fit.model') }))
    await userEvent.click(await screen.findByRole('option', { name: t('fit.models.polynomial') }))
    await userEvent.clear(degreeField())
    await userEvent.type(degreeField(), '5{Enter}')
    expect(screen.getByText(capError(3))).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('add-fit'))
    expect(storedModel()).toEqual({ type: 'polynomial', degree: 2 })
  })
})

describe('FitPanel per-group fits of a split series', () => {
  const grouped = () =>
    notebook(
      {
        x: ['1', '2', '3', '4', '5', '1', '2', '3', '4', '5'],
        y: ['3.1', '4.9', '7.2', '8.8', '11.1', '2.2', '5.1', '7.8', '11.2', '13.9'],
        g: ['A', 'A', 'A', 'A', 'A', 'B', 'B', 'B', 'B', 'B'],
      },
      [column('x'), column('y'), column('g', { kind: 'categorical', role: 'group' })],
    )
  const split = { split: { column: 'g' as ColumnId, overrides: [] } }
  const renderFit = () =>
    render(
      <I18nProvider lang="en">
        <FitPanel />
      </I18nProvider>,
    )
  const perGroup = () => screen.queryByRole('switch', { name: t('fit.perGroup') })

  it('is offered only for a split series, with the pooled / per-group explanation', () => {
    loadTestProject(grouped(), plotWith({ series: [xySeries('x', 'y')] }), {
      fits: [fit({ type: 'linear' })],
    })
    const { unmount } = renderFit()
    expect(perGroup()).toBeNull()
    unmount()
    loadTestProject(grouped(), plotWith({ series: [{ ...xySeries('x', 'y'), ...split }] }), {
      fits: [fit({ type: 'linear' })],
    })
    renderFit()
    expect(perGroup()).not.toBeChecked()
    expect(screen.getByText(t('fit.perGroupHint'))).toBeInTheDocument()
  })

  it('switches between the pooled fit and one fit per group, each shown in its own view', async () => {
    loadTestProject(grouped(), plotWith({ series: [{ ...xySeries('x', 'y'), ...split }] }), {
      fits: [fit({ type: 'linear' })],
    })
    renderFit()
    // Pooled: the single-fit view, unchanged.
    expect(screen.getByTestId('fit-n')).toHaveTextContent('10 of 10')
    expect(screen.queryByTestId('fit-group-table')).toBeNull()

    await userEvent.click(perGroup()!)
    expect(useProjectStore.getState().doc.fits[0].perGroup).toBe(true)
    expect(deriveNow().series[0].fit).toBeNull()
    const table = screen.getByTestId('fit-group-table')
    expect(
      within(table)
        .getAllByRole('rowheader')
        .map((h) => h.textContent),
    ).toEqual(['A', 'B'])
    expect(screen.queryByTestId('fit-n')).toBeNull()

    await userEvent.click(perGroup()!)
    expect(useProjectStore.getState().doc.fits[0].perGroup).toBe(false)
    expect(screen.getByTestId('fit-n')).toHaveTextContent('10 of 10')
  })

  it('per group with no group left to fit (every y emptied): says so instead of an empty table', () => {
    const data = grouped()
    loadTestProject(
      { ...data, cells: { ...data.cells, y: data.cells.y.map(() => '') } },
      plotWith({ series: [{ ...xySeries('x', 'y'), ...split }] }),
      { fits: [{ ...fit({ type: 'linear' }), perGroup: true }] },
    )
    renderFit()
    expect(screen.getByText(t('fit.noGroups'))).toBeInTheDocument()
    expect(screen.queryByTestId('fit-group-table')).toBeNull()
  })

  it('names the series as the legend does in the series choice', async () => {
    loadTestProject(
      grouped(),
      plotWith({ series: [xySeries('x', 'y'), { ...xySeries('g', 'y'), id: 'ser_2' as SeriesId }] }),
    )
    renderFit()
    await userEvent.click(screen.getByRole('combobox', { name: t('fit.series') }))
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual(['y vs x', 'y vs g'])
  })
})

describe('FitPanel empty states', () => {
  const renderFit = () =>
    render(
      <I18nProvider lang="en">
        <FitPanel />
      </I18nProvider>,
    )

  it('without any plot, says how to make one', () => {
    const doc = loadTestProject(dataset(), plotWith({ series: [xySeries('x', 'y')] }))
    loadProject({ ...doc, plots: [], activePlotId: null })
    renderFit()
    expect(screen.getByText(t('fit.noPlot'))).toBeInTheDocument()
  })

  it('on a histogram, says which plot types fit', () => {
    loadTestProject(dataset(), plotWith({ type: 'histogram' }))
    renderFit()
    expect(screen.getByText(t('fit.notForType'))).toBeInTheDocument()
  })
})
