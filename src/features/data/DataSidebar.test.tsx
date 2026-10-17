import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TooltipProvider } from '@/components/ui/tooltip'
import { I18nProvider } from '@/i18n/I18nProvider'
import { useProjectStore } from '@/state/projectStore'
import { ui } from '@/state/uiStore'
import { getActivePlotId } from '@/state/workspace'
import { column, DS, loadTestProject, notebook, plotWith, PLOT, xySeries } from '../inspector/testFixtures'
import { DataSidebar } from './DataSidebar'

describe('DataSidebar', () => {
  it('a dataset menu creates a new plot from that dataset and shows it', async () => {
    const user = userEvent.setup()
    loadTestProject(
      notebook({ t: ['1', '2', '3'], V: ['2', '4', '6'] }, [column('t'), column('V')]),
      plotWith({ series: [xySeries('t', 'V')] }),
    )
    ui.set({ workspace: { layout: 'single', panes: [PLOT], focused: 0 } })
    render(
      <I18nProvider lang="en">
        <TooltipProvider>
          <DataSidebar />
        </TooltipProvider>
      </I18nProvider>,
    )
    await user.click(screen.getByRole('button', { name: 'More: Test data' }))
    await user.click(await screen.findByRole('menuitem', { name: 'New plot from this dataset' }))
    const plots = useProjectStore.getState().doc.plots
    expect(plots).toHaveLength(2)
    expect(plots[1]).toMatchObject({ name: 'Test data' })
    expect(plots[1].series.map((s) => s.datasetId)).toEqual([DS])
    expect(getActivePlotId()).toBe(plots[1].id)
  })
})
