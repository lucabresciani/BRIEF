import { beforeEach, describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PlotId } from '@/domain/model'
import { defaultPlotSpec } from '@/domain/recommend/recommend'
import { Toaster } from '@/components/ui/toast'
import { TooltipProvider } from '@/components/ui/tooltip'
import { I18nProvider } from '@/i18n/I18nProvider'
import { commit, setReadOnly, undo, useProjectStore } from '@/state/projectStore'
import { ui } from '@/state/uiStore'
import { getActivePlotId } from '@/state/workspace'
import { column, loadTestProject, notebook, plotWith, PLOT, xySeries } from '../inspector/testFixtures'
import { PlotTabStrip } from './PlotTabStrip'

const EMPTY = 'plot_empty' as PlotId
const NAMED = 'plot_named' as PlotId

/** Three plots: "V vs t" (automatic label), an empty one ("Plot 2") and one named "Calibration". */
beforeEach(() => {
  loadTestProject(
    notebook({ t: ['1', '2', '3'], V: ['2', '4', '6'] }, [column('t'), column('V')]),
    plotWith({ series: [xySeries('t', 'V')] }),
  )
  commit('plot.create', (d) => {
    d.plots.push({ ...defaultPlotSpec(EMPTY) }, { ...defaultPlotSpec(NAMED), name: 'Calibration' })
  })
  ui.set({ workspace: { layout: 'single', panes: [PLOT], focused: 0 } })
})

function renderStrip(lang: 'en' | 'it' = 'en') {
  return render(
    <I18nProvider lang={lang}>
      <TooltipProvider>
        <Toaster>
          <PlotTabStrip layoutSwitch />
        </Toaster>
      </TooltipProvider>
    </I18nProvider>,
  )
}

const tabs = () => screen.getAllByRole('tab')
const plotIds = () => useProjectStore.getState().doc.plots.map((p) => p.id)

describe('PlotTabStrip', () => {
  it('names each tab after its plot; the active one is selected and the only Tab stop', () => {
    renderStrip()
    expect(screen.getByRole('tablist', { name: 'Plots' })).toBeInTheDocument()
    expect(tabs().map((t) => t.textContent)).toEqual(['V vs t', 'Plot 2', 'Calibration'])
    expect(tabs().map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false'])
    expect(tabs().map((t) => t.tabIndex)).toEqual([0, -1, -1])
  })

  it('side by side, a tab shown in another pane says so in its description, not its name', () => {
    ui.set({ workspace: { layout: 'columns', panes: [PLOT, EMPTY], focused: 0 } })
    renderStrip()
    const other = screen.getByRole('tab', { name: 'Plot 2' })
    expect(other).toHaveAccessibleDescription('Shown in pane 2')
    expect(other).toHaveAttribute('aria-controls', 'plot-pane-1')
    expect(screen.getByRole('tab', { name: 'V vs t' })).not.toHaveAccessibleDescription(/pane/)
    expect(screen.getByRole('tab', { name: 'Calibration' })).not.toHaveAttribute('aria-controls')
  })

  it('arrows, Home and End move the focus only; Enter or Space shows the plot', async () => {
    const user = userEvent.setup()
    renderStrip()
    tabs()[0].focus()
    await user.keyboard('{ArrowRight}')
    expect(tabs()[1]).toHaveFocus()
    expect(getActivePlotId()).toBe(PLOT) // manual activation: moving the focus shows nothing
    await user.keyboard('{Enter}')
    expect(getActivePlotId()).toBe(EMPTY)
    expect(tabs()[1]).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{End}')
    expect(tabs()[2]).toHaveFocus()
    await user.keyboard('{ArrowRight}')
    expect(tabs()[0]).toHaveFocus() // wraps around
    await user.keyboard('{ArrowLeft}')
    expect(tabs()[2]).toHaveFocus()
    await user.keyboard(' ')
    expect(getActivePlotId()).toBe(NAMED)
    await user.keyboard('{Home}')
    expect(tabs()[0]).toHaveFocus()
  })

  it('F2 or a double click renames inline: Enter commits, Escape cancels, empty is automatic', async () => {
    const user = userEvent.setup()
    renderStrip()
    tabs()[0].focus()
    await user.keyboard('{F2}')
    const field = screen.getByRole('textbox', { name: 'Plot name' })
    expect(field).toHaveValue('V vs t')
    await user.clear(field)
    await user.type(field, 'Ohm{Enter}')
    expect(useProjectStore.getState().doc.plots[0].name).toBe('Ohm')
    expect(tabs()[0]).toHaveTextContent('Ohm')
    await waitFor(() => expect(tabs()[0]).toHaveFocus())

    await user.dblClick(tabs()[0])
    await user.type(screen.getByRole('textbox', { name: 'Plot name' }), ' law{Escape}')
    expect(screen.queryByRole('textbox', { name: 'Plot name' })).toBeNull()
    expect(useProjectStore.getState().doc.plots[0].name).toBe('Ohm')

    await user.dblClick(tabs()[0])
    await user.clear(screen.getByRole('textbox', { name: 'Plot name' }))
    await user.keyboard('{Enter}')
    expect(useProjectStore.getState().doc.plots[0].name).toBe('')
    expect(tabs()[0]).toHaveTextContent('V vs t')
  })

  it('pressing another tab while renaming commits the name, shows that tab and leaves the focus on it', async () => {
    const user = userEvent.setup()
    renderStrip()
    await user.dblClick(tabs()[0])
    await user.clear(screen.getByRole('textbox', { name: 'Plot name' }))
    await user.type(screen.getByRole('textbox', { name: 'Plot name' }), 'Ohm')
    // The press alone shows the tab: the strip reflows when the field closes, so the release may miss it.
    const calibration = screen.getByRole('tab', { name: 'Calibration' })
    fireEvent.pointerDown(calibration, { pointerType: 'mouse', button: 0 })
    expect(getActivePlotId()).toBe(NAMED)
    await user.click(calibration)
    expect(useProjectStore.getState().doc.plots[0].name).toBe('Ohm')
    await new Promise((r) => requestAnimationFrame(r))
    expect(tabs()[2]).toHaveFocus()
  })

  it('the actions menu deletes a plot, and the Undo of its notice brings it back', async () => {
    const user = userEvent.setup()
    renderStrip()
    await user.click(screen.getByRole('button', { name: 'Actions for Calibration' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    expect(plotIds()).toEqual([PLOT, EMPTY])
    expect(tabs()).toHaveLength(2)
    const notice = await screen.findByText('Plot deleted: Calibration')
    const toast = notice.closest('[data-slot="toast"]') as HTMLElement
    await user.click(within(toast).getByRole('button', { name: 'Undo' }))
    expect(plotIds()).toEqual([PLOT, EMPTY, NAMED])
    expect(tabs()).toHaveLength(3)
  })

  it('the notice of a deletion closes once its Undo would no longer undo it', async () => {
    const user = userEvent.setup()
    renderStrip()
    await user.click(screen.getByRole('button', { name: 'Actions for Calibration' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    await screen.findByText('Plot deleted: Calibration')
    // Undone from elsewhere (the top bar, Ctrl+Z): the notice's Undo would do nothing any more.
    act(() => void undo())
    expect(plotIds()).toEqual([PLOT, EMPTY, NAMED])
    await waitFor(() => expect(screen.queryByText('Plot deleted: Calibration')).toBeNull())
  })

  it('duplicates and moves plots from the menu', async () => {
    const user = userEvent.setup()
    renderStrip()
    await user.click(screen.getByRole('button', { name: 'Actions for V vs t' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Duplicate' }))
    expect(tabs().map((t) => t.textContent)).toEqual(['V vs t', 'V vs t (copy)', 'Plot 3', 'Calibration'])
    expect(tabs()[1]).toHaveAttribute('aria-selected', 'true') // the copy is shown

    await user.click(screen.getByRole('button', { name: 'Actions for Calibration' }))
    expect(await screen.findByRole('menuitem', { name: 'Move right' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await user.click(screen.getByRole('menuitem', { name: 'Move left' }))
    expect(tabs().map((t) => t.textContent)).toEqual(['V vs t', 'V vs t (copy)', 'Calibration', 'Plot 4'])
  })

  it('a read-only tab switches plots but changes none', async () => {
    const user = userEvent.setup()
    setReadOnly(true)
    renderStrip()
    await user.click(tabs()[2])
    expect(getActivePlotId()).toBe(NAMED)
    await user.keyboard('{F2}')
    expect(screen.queryByRole('textbox', { name: 'Plot name' })).toBeNull()
    expect(screen.getByRole('button', { name: 'New plot' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Actions for Calibration' }))
    expect(await screen.findByRole('menuitem', { name: 'Delete' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('reads naturally in Italian', async () => {
    const user = userEvent.setup()
    renderStrip('it')
    expect(screen.getByRole('tablist', { name: 'Grafici' })).toBeInTheDocument()
    expect(tabs().map((t) => t.textContent)).toEqual(['V vs t', 'Grafico 2', 'Calibration'])
    expect(screen.getByRole('button', { name: 'Nuovo grafico' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Due affiancati' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Azioni per Grafico 2' }))
    const items = (await screen.findAllByRole('menuitem')).map((i) => i.textContent)
    expect(items).toEqual(['Rinomina', 'Duplica', 'Sposta a sinistra', 'Sposta a destra', 'Elimina'])
  })
})
