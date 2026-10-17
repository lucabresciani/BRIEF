import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Issue } from '@/domain/model'
import { I18nProvider } from '@/i18n/I18nProvider'
import { issueHint, issueTitle, makeTranslator } from '@/i18n/translate'
import { setNumberFormat } from '@/state/actions/project'
import { useUiStore } from '@/state/uiStore'
import { StatsPanel } from './StatsPanel'
import { column, loadTestProject, notebook, plotWith, xySeries } from './testFixtures'

const t = makeTranslator('en')
const zeroSpread = (params: Issue['params']) => ({ code: 'I_ZERO_SPREAD' as const, params })

const renderPanel = () =>
  render(
    <I18nProvider lang="en">
      <StatsPanel />
    </I18nProvider>,
  )

describe('StatsPanel issues', () => {
  it('shows the column warnings from the summary with their hint (what to do), without per-code wiring', () => {
    loadTestProject(notebook({ v: ['2', '2', '2', '2', '2'] }, [column('v')]), plotWith({}))
    renderPanel()
    const issue = zeroSpread({ scope: 'column', n: 5, count: 1 })
    expect(screen.getByText(issueTitle(t, issue))).toBeInTheDocument()
    expect(screen.getByText(issueHint(t, issue))).toBeInTheDocument()
  })

  it('explains a zero SD in the per-group table and can select those rows', async () => {
    loadTestProject(
      notebook({ g: ['A', 'A', 'A', 'B', 'B', 'B'], v: ['1', '1', '1', '1', '2', '3'] }, [
        column('g', { kind: 'categorical', role: 'group' }),
        column('v'),
      ]),
      plotWith({}),
    )
    renderPanel()
    expect(screen.getByTestId('stats-groups')).toBeInTheDocument()
    expect(
      screen.getByText(issueTitle(t, zeroSpread({ scope: 'groups', count: 1, n: 3 }))),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: t('import.showRows') }))
    expect([...(useUiStore.getState().selection?.rowIds ?? [])]).toEqual([0, 1, 2])
  })
})

describe('StatsPanel outlier candidates', () => {
  const withOutliers = () =>
    loadTestProject(
      notebook({ T: ['10.1', '10.2', '10.3', '10.4', '10.5', '10.6', '10.7', '10.8', '25.5', '30.250'] }, [
        column('T', { unit: 's' }),
      ]),
      plotWith({}),
    )
  const outliersCell = () => screen.getByTestId('stats-table').querySelector('[data-stat="outliers"] td')

  it('are numbers in the interface language, like the maximum, with the unit and an unambiguous separator', () => {
    withOutliers()
    setNumberFormat('auto') // follow the interface language, as a new project does
    render(
      <I18nProvider lang="it">
        <StatsPanel />
      </I18nProvider>,
    )
    expect(outliersCell()).toHaveTextContent(/^25,5; 30,25\s*s$/)
    expect(screen.getByTestId('stats-table').querySelector('[data-stat="max"] td')).toHaveTextContent(
      /^30,25\s*s$/,
    )
  })

  it('show no unit when there are none', () => {
    loadTestProject(notebook({ T: ['1', '2', '3', '4', '5'] }, [column('T', { unit: 's' })]), plotWith({}))
    renderPanel()
    expect(outliersCell()).toHaveTextContent(/^None outside the fences$/)
  })
})

describe('StatsPanel columns', () => {
  /** A plotted date/time y column next to a numeric one. */
  const withDates = () =>
    loadTestProject(
      notebook(
        { when: ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04'], T: ['20.5', '21', '22.4', '23.1'] },
        [column('when', { kind: 'datetime' }), column('T')],
      ),
      plotWith({ series: [xySeries('T', 'when')] }),
    )

  it('never shows an empty "0 of n rows" sample for a date/time column: it summarises a numeric one', () => {
    withDates()
    renderPanel()
    expect(screen.getByRole('combobox', { name: t('stats.column') })).toHaveTextContent('T')
    expect(screen.getByTestId('stats-sample')).toHaveTextContent('4 of 4 rows')
    expect(screen.getByTestId('stats-table')).toBeInTheDocument()
  })

  it('does not list date/time columns, which have no descriptive statistics', async () => {
    withDates()
    renderPanel()
    await userEvent.click(screen.getByRole('combobox', { name: t('stats.column') }))
    expect(await screen.findByRole('option', { name: 'T' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'when' })).not.toBeInTheDocument()
  })

  it('asks for a numeric column when the dataset has only dates', () => {
    loadTestProject(
      notebook({ when: ['2026-01-01', '2026-01-02'] }, [column('when', { kind: 'datetime' })]),
      plotWith({}),
    )
    renderPanel()
    expect(screen.getByText(t('stats.pickColumn'))).toBeInTheDocument()
    expect(screen.queryByTestId('stats-sample')).not.toBeInTheDocument()
  })
})
