import { beforeEach, describe, expect, it } from 'vitest'
import type { PlotId, SeriesId } from '@/domain/model'
import {
  column,
  fit,
  loadTestProject,
  notebook,
  plotWith,
  PLOT,
  SERIES,
  xySeries,
} from '@/features/inspector/testFixtures'
import { deriveNow } from './derived'
import { commit, useProjectStore } from './projectStore'
import { ui } from './uiStore'

const OTHER = 'plot_other' as PlotId

/** Two plots of one notebook: the active one fits y against x, the other plots x against y. */
beforeEach(() => {
  const ds = notebook({ x: ['1', '2', '3', '4'], y: ['2.1', '3.9', '6.2', '7.8'] }, [
    column('x'),
    column('y'),
  ])
  loadTestProject(ds, plotWith({ series: [xySeries('x', 'y')] }), { fits: [fit({ type: 'linear' })] })
  commit('plot.create', (d) => {
    d.plots.push(plotWith({ id: OTHER, series: [{ ...xySeries('y', 'x'), id: 'ser_other' as SeriesId }] }))
  })
})

describe('deriveNow', () => {
  it('derives the active plot without an id, and the plot asked for with one', () => {
    const active = deriveNow()
    expect(active.plot?.id).toBe(PLOT)
    expect(active.series[0].spec.id).toBe(SERIES)
    expect(active.series[0].fit?.status).toBe('ok')

    const other = deriveNow(OTHER)
    expect(other.plot?.id).toBe(OTHER)
    expect(other.series[0].xColumn.id).toBe('y')
    expect(other.series[0].fit).toBeNull()
    // One dataset stage for both plots; the active plot is unchanged by deriving the other one.
    expect(other.parts.data).toBe(active.parts.data)
    expect(deriveNow()).toBe(active)
    expect(deriveNow(PLOT)).toBe(active)
  })

  it('follows the active plot of the UI store, and an id no longer in the document derives no plot', () => {
    const doc = useProjectStore.getState().doc
    ui.showPlot(OTHER)
    expect(deriveNow().plot?.id).toBe(OTHER)
    expect(useProjectStore.getState().doc).toBe(doc) // switching plots never edits the document
    commit('plot.remove', (d) => {
      d.plots = d.plots.filter((p) => p.id !== OTHER)
      d.activePlotId = PLOT
    })
    const gone = deriveNow(OTHER)
    expect(gone.plot).toBeNull()
    expect(gone.series).toEqual([])
    expect(deriveNow().plot?.id).toBe(PLOT)
  })
})
