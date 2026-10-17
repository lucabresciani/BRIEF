import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Draft } from 'immer'
import type { DatasetId, NotebookDataset, PlotId, RowId, SeriesId, WorkspaceState } from '@/domain/model'
import { TooltipProvider } from '@/components/ui/tooltip'
import { I18nProvider } from '@/i18n/I18nProvider'
import { makeTranslator } from '@/i18n/translate'
import { commit, useProjectStore } from '@/state/projectStore'
import { ui } from '@/state/uiStore'
import { getActivePlotId } from '@/state/workspace'
import { setTitle } from '@/state/actions/plot'
import { hovers, ZOOM } from '@/test/fakePlotCanvas'
import { Inspector } from '../inspector/Inspector'
import { column, DS, loadTestProject, notebook, plotWith, PLOT, xySeries } from '../inspector/testFixtures'
import { PlotArea } from './PlotArea'

vi.mock('@/plot/PlotCanvasLazy', async () => ({
  PlotCanvasLazy: (await import('@/test/fakePlotCanvas')).FakePlotCanvas,
}))
vi.mock('@/plot/preload', () => ({ preloadPlot: () => {} }))

const t = makeTranslator('en')
const BETA = 'plot_beta' as PlotId
const GAMMA = 'plot_gamma' as PlotId
const DS2 = 'ds_two' as DatasetId

/**
 * Plots "Alpha" (dataset 1), "Beta" (dataset 1) and "Gamma" (dataset 2), laid out as asked.
 */
function setup(workspace: WorkspaceState) {
  loadTestProject(
    notebook({ t: ['1', '2', '3'], V: ['2', '4', '6'] }, [column('t'), column('V')]),
    plotWith({ series: [xySeries('t', 'V')], title: 'Alpha' }),
  )
  const second = { ...notebook({ t: ['5', '6'], V: ['1', '3'] }, [column('t'), column('V')]), id: DS2 }
  commit('dataset.import', (d) => {
    d.datasets.push({ ...second, name: 'Second' } as Draft<NotebookDataset>)
  })
  commit('plot.create', (d) => {
    d.plots.push(
      {
        ...plotWith({ series: [{ ...xySeries('V', 't'), id: 'ser_beta' as SeriesId }], title: 'Beta' }),
        id: BETA,
      },
      {
        ...plotWith({
          series: [{ ...xySeries('t', 'V'), id: 'ser_gamma' as SeriesId, datasetId: DS2 }],
          title: 'Gamma',
        }),
        id: GAMMA,
      },
    )
  })
  ui.set({ workspace, views: {}, viewResets: {}, selection: null, hoverRow: null, inspectorTab: 'style' })
  render(
    <I18nProvider lang="en">
      <TooltipProvider>
        <PlotArea split />
        <Inspector />
      </TooltipProvider>
    </I18nProvider>,
  )
}

const pane = (i: number) => document.querySelector(`[data-plot-pane="${i}"]`) as HTMLElement
/**
 * A pointer down inside a pane. Away from (0, 0): jsdom gives every element an empty box there, and the
 * split handles of react-resizable-panels would take the pointer (and the focus) as a drag.
 */
const press = (el: HTMLElement) => fireEvent.pointerDown(el, { clientX: 400, clientY: 300 })
const canvasOf = (i: number) => within(pane(i)).findByTestId('fake-canvas')
const titleField = () => screen.getByRole('textbox', { name: t('style.title') })
const titleOf = (id: PlotId) => useProjectStore.getState().doc.plots.find((p) => p.id === id)?.title

describe('PaneGrid', () => {
  beforeEach(() => {
    hovers.length = 0
  })

  it('focusing a pane makes its plot the one the toolbar and the inspector edit', async () => {
    setup({ layout: 'columns', panes: [PLOT, BETA], focused: 0 })
    await canvasOf(1)
    expect(pane(0)).toHaveAttribute('data-focused')
    expect(screen.getByTestId('inspector-editing')).toHaveTextContent('Editing: Alpha')
    expect(titleField()).toHaveValue('Alpha')

    press(pane(1))
    expect(getActivePlotId()).toBe(BETA)
    expect(pane(1)).toHaveAttribute('data-focused')
    expect(pane(0)).not.toHaveAttribute('data-focused')
    expect(screen.getByTestId('inspector-editing')).toHaveTextContent('Editing: Beta')
    expect(titleField()).toHaveValue('Beta')

    // Keyboard focus inside a pane focuses it too.
    act(() => within(pane(0)).getByRole('combobox', { name: 'Plot shown in pane 1' }).focus())
    expect(getActivePlotId()).toBe(PLOT)
  })

  it('a title typed for one plot is saved to that plot when another pane takes the focus', async () => {
    const user = userEvent.setup()
    setup({ layout: 'columns', panes: [PLOT, BETA], focused: 0 })
    await canvasOf(1)
    await user.clear(titleField())
    await user.type(titleField(), 'Alpha 2')
    press(pane(1))
    expect(titleOf(PLOT)).toBe('Alpha 2')
    expect(titleOf(BETA)).toBe('Beta')
    expect(titleField()).toHaveValue('Beta')
  })

  it('a title typed for one plot is saved to that plot when another tab is pressed', async () => {
    const user = userEvent.setup()
    setup({ layout: 'single', panes: [PLOT], focused: 0 })
    await user.clear(titleField())
    await user.type(titleField(), 'Alpha 2')
    // A mouse press on a tab shows its plot at once (before the click): the edit must commit first.
    const beta = screen.getByRole('tab', { name: 'Beta' })
    fireEvent.pointerDown(beta, { pointerType: 'mouse', button: 0, clientX: 400, clientY: 10 })
    await user.click(beta)
    expect(getActivePlotId()).toBe(BETA)
    expect(titleOf(PLOT)).toBe('Alpha 2')
    expect(titleOf(BETA)).toBe('Beta')
    expect(titleField()).toHaveValue('Beta')
  })

  it('a draft never carries over to a plot whose field holds the same value (pane or tab switch)', async () => {
    const user = userEvent.setup()
    setup({ layout: 'columns', panes: [PLOT, BETA], focused: 0 })
    await canvasOf(1)
    act(() => setTitle('', PLOT))
    act(() => setTitle('', BETA)) // untitled plots: the field shows '' for both
    await user.type(titleField(), 'Alpha 2')
    press(pane(1))
    expect(titleOf(PLOT)).toBe('Alpha 2')
    expect(titleField()).toHaveValue('') // Beta's title, not the draft typed for Alpha
    act(() => titleField().focus())
    act(() => titleField().blur())
    expect(titleOf(BETA)).toBe('')

    await user.type(titleField(), 'Beta 2')
    const alpha = screen.getByRole('tab', { name: 'Alpha 2' })
    fireEvent.pointerDown(alpha, { pointerType: 'mouse', button: 0, clientX: 400, clientY: 10 })
    expect(titleOf(BETA)).toBe('Beta 2')
    expect(titleField()).toHaveValue('Alpha 2')
  })

  it('a selection reaches the panes that plot its dataset only (the others do not even redraw)', async () => {
    setup({ layout: 'columns', panes: [PLOT, GAMMA], focused: 0 })
    const alpha = await canvasOf(0)
    const gamma = await canvasOf(1)
    const figures = () => [alpha.getAttribute('data-figure'), gamma.getAttribute('data-figure')]
    const [alphaBefore, gammaBefore] = figures()
    act(() => ui.select({ datasetId: DS, rowIds: new Set([1 as RowId]), origin: 'table', anchor: null }))
    expect(JSON.parse(alpha.getAttribute('data-selected')!)).toContainEqual([1])
    expect(figures()[0]).not.toBe(alphaBefore)
    expect(figures()[1]).toBe(gammaBefore)
  })

  it('an edit of one plot rebuilds its own figure only, not the figures of the other panes', async () => {
    setup({ layout: 'columns', panes: [PLOT, BETA], focused: 0 })
    const alpha = await canvasOf(0)
    const beta = await canvasOf(1)
    const figures = () => [alpha.getAttribute('data-figure'), beta.getAttribute('data-figure')]
    const [alphaBefore, betaBefore] = figures()
    act(() => setTitle('Alpha 2', PLOT))
    expect(figures()[0]).not.toBe(alphaBefore)
    expect(figures()[1]).toBe(betaBefore)
  })

  it('table hover labels go to the focused pane only', async () => {
    setup({ layout: 'columns', panes: [PLOT, BETA], focused: 1 })
    await canvasOf(0)
    await canvasOf(1)
    act(() => ui.set({ hoverRow: { datasetId: DS, rowId: 0 as RowId, origin: 'table' } }))
    await waitFor(() => expect(hovers.length).toBeGreaterThan(0))
    // The stand-in records the uirevision of the canvas it hovered: it starts with the plot id.
    expect(hovers.every((h) => h.startsWith(`${BETA}|`))).toBe(true)
  })

  it('a plot coming back on screen restores its zoom, which the toolbar offers as axis limits', async () => {
    const user = userEvent.setup()
    setup({ layout: 'single', panes: [PLOT], focused: 0 })
    await user.click(await within(pane(0)).findByRole('button', { name: 'zoom on canvas' }))
    const limits = screen.getByRole('button', { name: t('plot.viewToLimits') })
    expect(limits).toBeEnabled()
    const rev = (await canvasOf(0)).getAttribute('data-uirevision')

    act(() => ui.showPlot(BETA))
    expect((await canvasOf(0)).getAttribute('data-initial-view')).toBe('')
    expect(limits).toBeDisabled()

    act(() => ui.showPlot(PLOT))
    const back = await canvasOf(0)
    expect(JSON.parse(back.getAttribute('data-initial-view')!)).toEqual({ ...ZOOM, rev })
    expect(limits).toBeEnabled()
  })

  it('with every plot deleted, the plot area teaches the next step and shows no idle toolbar', async () => {
    setup({ layout: 'columns', panes: [PLOT, BETA], focused: 0 })
    expect(screen.getByRole('toolbar', { name: t('plot.region') })).toBeInTheDocument()
    act(() => {
      commit('plot.remove', (d) => void d.plots.splice(0))
      ui.set({ workspace: { layout: 'columns', panes: [null, null], focused: 0 } })
    })
    expect(screen.queryByRole('toolbar')).toBeNull()
    expect(within(pane(0)).getByText('This project has no plot')).toBeInTheDocument()
    expect(within(pane(0)).getByRole('button', { name: 'New plot' })).toBeEnabled()
  })

  it('an empty pane offers the plots and a new plot; choosing one moves it there', async () => {
    const user = userEvent.setup()
    setup({ layout: 'grid', panes: [PLOT, BETA, GAMMA, null], focused: 0 })
    const empty = pane(3)
    expect(within(empty).getByText('Choose a plot', { selector: 'p' })).toBeInTheDocument()
    expect(within(empty).getByRole('button', { name: 'New plot' })).toBeInTheDocument()
    // From the keyboard: in jsdom every pointer down lands on the (zero-sized) split handles.
    act(() => within(empty).getByRole('combobox', { name: 'Plot shown in pane 4' }).focus())
    await user.keyboard('{ArrowDown}')
    await user.click(await screen.findByRole('option', { name: 'Beta' }))
    expect(ui.get().workspace.panes).toEqual([PLOT, null, GAMMA, BETA])
    expect(getActivePlotId()).toBe(BETA)
  })
})
