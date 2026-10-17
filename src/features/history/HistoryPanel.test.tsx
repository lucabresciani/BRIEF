import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TooltipProvider } from '@/components/ui/tooltip'
import { I18nProvider } from '@/i18n/I18nProvider'
import { ui } from '@/state/uiStore'
import { getActivePlotId } from '@/state/workspace'
import { createPlot, removePlot, renamePlot, setTitle } from '@/state/actions/plot'
import { column, loadTestProject, notebook, plotWith, PLOT, xySeries } from '../inspector/testFixtures'
import { HistoryPanel } from './HistoryPanel'

describe('HistoryPanel', () => {
  it('names the plot of each operation in a chip that shows it; a deleted plot has none', async () => {
    const user = userEvent.setup()
    loadTestProject(
      notebook({ t: ['1', '2', '3'], V: ['2', '4', '6'] }, [column('t'), column('V')]),
      plotWith({ series: [xySeries('t', 'V')] }),
    )
    ui.set({ workspace: { layout: 'single', panes: [PLOT], focused: 0 } })
    setTitle('Calibration', PLOT)
    const other = createPlot({ name: 'Residual check' })!
    const gone = createPlot({ name: 'Scratch' })!
    removePlot(gone)
    renamePlot(other, 'Residuals')
    render(
      <I18nProvider lang="en">
        <TooltipProvider>
          <HistoryPanel />
        </TooltipProvider>
      </I18nProvider>,
    )
    expect(screen.getAllByRole('button', { name: 'Show Residuals' })).toHaveLength(2) // created, renamed
    expect(screen.queryByRole('button', { name: /Scratch/ })).toBeNull()
    expect(screen.getByText('Deleted plot Scratch')).toBeInTheDocument()
    expect(getActivePlotId()).toBe(other)
    await user.click(screen.getByRole('button', { name: 'Show Calibration' }))
    expect(getActivePlotId()).toBe(PLOT)
  })
})
