import { useMemo } from 'react'
import { createDeriver, type DerivedProject } from '@/domain/derive/pipeline'
import type { NumberFormatLocale } from '@/domain/format/number'
import type { PlotId, PlotSpec } from '@/domain/model'
import { useI18n } from '@/i18n/I18nProvider'
import { useDataStore } from './dataStore'
import { useProjectStore } from './projectStore'
import { getActivePlotId, useActivePlotId } from './workspace'

/**
 * One memoised deriver for the app: the datasets are derived once for every plot, and each plot only
 * when it changed. Memoised consumers depend on `derived.parts`, which stay put across unrelated edits.
 */
const derive = createDeriver()

/** Never a plot id: the deriver falls back to the active plot only when no id is given at all. */
const NO_PLOT = '' as PlotId

/** One plot by id (an id no longer in the document derives no plot; null = no plot at all). */
export function useDerivedPlot(plotId: PlotId | null): DerivedProject {
  const doc = useProjectStore((s) => s.doc)
  const rawTables = useDataStore((s) => s.rawTables)
  return useMemo(() => derive(doc, rawTables, plotId ?? NO_PLOT), [doc, rawTables, plotId])
}

/** The active plot (the plot of the focused pane). */
export function useDerived(): DerivedProject {
  return useDerivedPlot(useActivePlotId())
}

/** Outside React: the given plot, else the active one. */
export function deriveNow(plotId?: PlotId): DerivedProject {
  return derive(
    useProjectStore.getState().doc,
    useDataStore.getState().rawTables,
    plotId ?? getActivePlotId() ?? undefined,
  )
}

/** Display decimal separator: project setting, else the UI language (it → comma). */
export function useNumberLocale(): NumberFormatLocale {
  const { lang } = useI18n()
  const setting = useProjectStore((s) => s.doc.numberFormat.decimal)
  return useMemo(
    () => ({ decimal: setting === 'auto' ? (lang === 'it' ? ',' : '.') : setting === 'comma' ? ',' : '.' }),
    [lang, setting],
  )
}

/** The PlotSpec of the active plot, read from the document (the UI store only holds its id). */
export function useActivePlot(): PlotSpec | null {
  const id = useActivePlotId()
  return useProjectStore((s) => s.doc.plots.find((p) => p.id === id) ?? null)
}
