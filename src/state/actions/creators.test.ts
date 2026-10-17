import { beforeEach, describe, expect, it } from 'vitest'
import { deserializeProject } from '@/domain/project/deserialize'
import { serializeProject } from '@/domain/project/serialize'
import { getRawTables } from '../dataStore'
import { emptyProject, loadProject, operationLog, useProjectStore } from '../projectStore'
import { projectForSave } from '../workspace'
import { addFit } from './analysis'
import { createNotebook } from './notebook'
import { addSeries, createPlot, duplicatePlot, setPlotType } from './plot'
import { loadExample } from './project'

beforeEach(() => loadProject(emptyProject('Creators')))

const doc = () => useProjectStore.getState().doc

describe('plots, series and fits created by the actions', () => {
  it('carry every schema 2 field with its neutral value, and the project reopens unchanged', () => {
    // A notebook first: it creates the first plot from defaultPlotSpec.
    const nb = createNotebook(
      'Spring',
      [
        { name: 'm', unit: 'kg' },
        { name: 'x', unit: 'cm' },
      ],
      'dot',
    )
    const first = doc().plots[0].id
    expect(loadExample('ohm', 'Ohm')).toBe(true) // initialPlot, in a tab of its own
    const [m, x] = doc().datasets.find((d) => d.id === nb)!.columns
    const extra = addSeries(nb, x.id, m.id, 'm vs x', first) // swapped mapping, a second series
    setPlotType('histogram', first)
    setPlotType('scatter', first)
    createPlot()
    createPlot({ datasetId: doc().datasets[1].id })
    for (const p of doc().plots) for (const s of p.series) addFit(s.id, { type: 'linear' }, 'linear')
    duplicatePlot(first)

    const plots = doc().plots
    expect(plots).toHaveLength(5)
    expect(plots[0].name).toBe('')
    expect(plots[0].series.map((s) => s.id)).toContain(extra)
    for (const plot of plots) {
      for (const s of plot.series) expect(s.split).toBeNull()
      expect(plot.histogram).toMatchObject({ groupBy: null, groupMode: 'overlay' })
      expect(plot.box.colorByGroup).toBe(false)
      expect(plot.bar.colorByCategory).toBe(false)
    }
    expect(doc().fits).toHaveLength(plots.flatMap((p) => p.series).length)
    for (const f of doc().fits) {
      expect(f.style).toEqual({ color: { mode: 'series' }, dash: 'auto', width: 2 })
      expect(f.perGroup).toBe(false)
    }
    const log = operationLog()
    const plotIds = new Set<string>(plots.map((p) => p.id))
    expect(log.every((e) => e.plotId === null || plotIds.has(e.plotId))).toBe(true)
    expect(log.filter((e) => e.plotId !== null).length).toBe(log.length)

    // The schema accepts what the actions wrote, workspace included, without a single repair or notice.
    const saved = projectForSave(doc())
    const reopened = deserializeProject(
      serializeProject(saved.doc, getRawTables(), log, 'test', undefined, { workspace: saved.workspace }),
    )
    if (!reopened.ok) throw new Error(JSON.stringify(reopened.error))
    expect(reopened.warnings).toEqual([])
    expect(reopened.value.doc).toEqual(saved.doc)
    expect(reopened.value.log).toEqual(log)
    expect(reopened.value.workspace).toEqual(saved.workspace)
  })
})
