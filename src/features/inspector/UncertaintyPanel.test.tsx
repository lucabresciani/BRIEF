import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ColumnId, SeriesId, UncertaintySpec } from '@/domain/model'
import { I18nProvider } from '@/i18n/I18nProvider'
import { makeTranslator } from '@/i18n/translate'
import { loadProject, useProjectStore } from '@/state/projectStore'
import { UncertaintyPanel } from './UncertaintyPanel'
import { column, loadTestProject, notebook, plotWith, xySeries } from './testFixtures'

const t = makeTranslator('en')
/** Accessible name starting with the option label (a disabled option also carries its reason). */
const startsWith = (label: string) => new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
const absolute: UncertaintySpec = {
  kind: 'measurement',
  origin: 'instrument',
  source: { type: 'absolute', value: 0.1 },
  meaning: { type: 'unspecified' },
}

/** t, V and u(V) typed in a notebook, plus lnV = ln(V) as a derived column. */
function dataset(uncertaintyOf: string | null = 'V') {
  return notebook(
    {
      t: ['1', '2', '3', '4', '5'],
      V: ['2', '4', '6', '8', '10'],
      uV: ['0.1', '0.1', '0.1', '0.1', '0.1'],
    },
    [column('t'), column('V'), column('uV', { role: 'uncertainty', uncertaintyOf })],
    [column('lnV', { derived: { op: 'ln', input: 'V' as ColumnId } })],
  )
}

const renderPanel = () =>
  render(
    <I18nProvider lang="en">
      <UncertaintyPanel />
    </I18nProvider>,
  )

async function sourceOptions() {
  await userEvent.click(screen.getByRole('combobox', { name: t('uncertainty.source') }))
  const option = (key: string) =>
    screen.findByRole('option', { name: startsWith(t(`uncertainty.sources.${key}`)) })
  return {
    absolute: await option('absolute'),
    percent: await option('percent'),
    column: await option('column'),
    columnAsymmetric: await option('columnAsymmetric'),
  }
}

describe('UncertaintyPanel on a derived axis column', () => {
  it('disables the column sources for y bars on a derived y column, with the reason', async () => {
    loadTestProject(dataset(), plotWith({ series: [xySeries('t', 'lnV', { y: absolute })] }))
    renderPanel()
    const o = await sourceOptions()
    for (const opt of [o.column, o.columnAsymmetric]) {
      expect(opt).toHaveAttribute('aria-disabled', 'true')
      expect(opt).toHaveTextContent(t('derived.noUncertainty'))
    }
    // A typed value or a percentage is the user's own statement about lnV: still offered.
    for (const opt of [o.absolute, o.percent]) expect(opt).not.toHaveAttribute('aria-disabled', 'true')
  })

  it('disables the column sources for x bars on a derived x column', async () => {
    loadTestProject(dataset(), plotWith({ series: [xySeries('lnV', 't', { x: absolute })] }))
    renderPanel()
    const o = await sourceOptions()
    expect(o.column).toHaveAttribute('aria-disabled', 'true')
    expect(o.columnAsymmetric).toHaveAttribute('aria-disabled', 'true')
    expect(o.absolute).not.toHaveAttribute('aria-disabled', 'true')
  })

  it('explains a column source left on a column that became derived (y remapped to lnV)', () => {
    const fromColumn: UncertaintySpec = { ...absolute, source: { type: 'column', column: 'uV' as ColumnId } }
    loadTestProject(dataset(), plotWith({ series: [xySeries('t', 'lnV', { y: fromColumn })] }))
    renderPanel()
    expect(screen.getByText(t('issues.E_DERIVED_UNCERTAINTY.title'))).toBeInTheDocument()
  })

  it('keeps the column sources available on a raw column', async () => {
    loadTestProject(dataset(), plotWith({ series: [xySeries('t', 'V', { y: absolute })] }))
    renderPanel()
    const o = await sourceOptions()
    expect(o.column).not.toHaveAttribute('aria-disabled', 'true')
    expect(o.columnAsymmetric).not.toHaveAttribute('aria-disabled', 'true')
    expect(o.column).not.toHaveTextContent(t('derived.noUncertainty'))
  })

  it('does not preselect a column source for a derived column, even one marked as its uncertainty', async () => {
    loadTestProject(dataset('lnV'), plotWith({ series: [xySeries('t', 'lnV')] }))
    renderPanel()
    await userEvent.click(screen.getByRole('combobox', { name: t('uncertainty.kind') }))
    await userEvent.click(await screen.findByRole('option', { name: t('uncertainty.kinds.measurement') }))
    const y = useProjectStore.getState().doc.plots[0].series[0].errorBars.y
    expect(y.kind).toBe('measurement')
    expect(y.kind === 'measurement' && y.source.type).toBe('absolute')
  })

  it('still preselects the column marked as the uncertainty of a raw column', async () => {
    loadTestProject(dataset('V'), plotWith({ series: [xySeries('t', 'V')] }))
    renderPanel()
    await userEvent.click(screen.getByRole('combobox', { name: t('uncertainty.kind') }))
    await userEvent.click(await screen.findByRole('option', { name: t('uncertainty.kinds.measurement') }))
    const y = useProjectStore.getState().doc.plots[0].series[0].errorBars.y
    expect(y.kind === 'measurement' && y.source).toEqual({ type: 'column', column: 'uV' })
  })

  it('does not preselect a derived column marked as the uncertainty of a raw column', async () => {
    // u2 = 2·uV is derived: as a source it is refused (E_DERIVED_UNCERTAINTY), so it is never preselected.
    const u2 = column('u2', {
      derived: { op: 'affine', input: 'uV' as ColumnId, a: 2, b: 0 },
      role: 'uncertainty',
      uncertaintyOf: 'V',
    })
    const ds = dataset(null)
    loadTestProject({ ...ds, columns: [...ds.columns, u2] }, plotWith({ series: [xySeries('t', 'V')] }))
    renderPanel()
    await userEvent.click(screen.getByRole('combobox', { name: t('uncertainty.kind') }))
    await userEvent.click(await screen.findByRole('option', { name: t('uncertainty.kinds.measurement') }))
    const y = useProjectStore.getState().doc.plots[0].series[0].errorBars.y
    expect(y.kind === 'measurement' && y.source.type).toBe('absolute')
    expect(screen.queryByText(t('issues.E_DERIVED_UNCERTAINTY.title'))).not.toBeInTheDocument()
  })
})

describe('UncertaintyPanel series and empty states', () => {
  it('names the series as the legend does in the series choice', async () => {
    loadTestProject(
      dataset(),
      plotWith({ series: [xySeries('t', 'V'), { ...xySeries('uV', 'V'), id: 'ser_2' as SeriesId }] }),
    )
    renderPanel()
    await userEvent.click(screen.getByRole('combobox', { name: t('fit.series') }))
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual(['V vs t', 'V vs uV'])
  })

  it('without any plot, says how to make one', () => {
    const doc = loadTestProject(dataset(), plotWith({ series: [xySeries('t', 'V')] }))
    loadProject({ ...doc, plots: [], activePlotId: null })
    renderPanel()
    expect(screen.getByText(t('plot.noPlot'))).toBeInTheDocument()
  })

  it('on a histogram or a box plot, says where error bars are set, never mentioning a fit', () => {
    for (const type of ['histogram', 'box', 'bar'] as const) {
      loadTestProject(dataset(), plotWith({ type, series: [xySeries('t', 'V')] }))
      const { unmount } = renderPanel()
      expect(screen.getByText(t('uncertainty.notForType'))).toBeInTheDocument()
      expect(screen.queryByText(/fit/i)).toBeNull()
      unmount()
    }
  })

  it('on a scatter plot without a series, asks for one', () => {
    loadTestProject(dataset(), plotWith({ type: 'scatter', series: [] }))
    renderPanel()
    expect(screen.getByText(t('uncertainty.noSeries'))).toBeInTheDocument()
  })
})
