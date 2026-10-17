import { describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { PlotId, SeriesId } from '@/domain/model'
import { column, loadTestProject, notebook, plotWith, xySeries } from '@/features/inspector/testFixtures'
import { useDerivedPlot } from './derived'
import { commit } from './projectStore'

const OTHER = 'plot_other' as PlotId

describe('useDerivedPlot', () => {
  it('derives the plot asked for, and no plot at all for null (an empty pane)', () => {
    loadTestProject(
      notebook({ x: ['1', '2', '3'], y: ['2', '4', '6'] }, [column('x'), column('y')]),
      plotWith({ series: [xySeries('x', 'y')] }),
    )
    commit('plot.create', (d) => {
      d.plots.push(plotWith({ id: OTHER, series: [{ ...xySeries('y', 'x'), id: 'ser_other' as SeriesId }] }))
    })
    const { result, rerender } = renderHook(({ id }: { id: PlotId | null }) => useDerivedPlot(id), {
      initialProps: { id: OTHER as PlotId | null },
    })
    expect(result.current.plot?.id).toBe(OTHER)
    // null used to fall back to the document's first plot: an empty pane would have drawn it.
    rerender({ id: null })
    expect(result.current.plot).toBeNull()
    expect(result.current.series).toEqual([])
    // The datasets are still derived for the panels that read them.
    expect(result.current.views.size).toBe(1)
  })
})
