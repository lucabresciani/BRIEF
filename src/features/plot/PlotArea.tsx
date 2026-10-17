import { useState } from 'react'
import { useT } from '@/i18n/I18nProvider'
import { useActivePlotId } from '@/state/workspace'
import { ExclusionBar } from './ExclusionBar'
import { PaneGrid } from './PaneGrid'
import { PaneRegistry, PaneRegistryContext } from './paneRegistry'
import { PlotTabStrip } from './PlotTabStrip'
import { PlotToolbar } from './PlotToolbar'
import { RecommendationBanner } from './RecommendationBanner'

/**
 * The instrument: plot tabs, the one toolbar (it acts on the focused pane), the suggestion for the
 * active plot, the panes (most of the space) and the selection bar shared by every plot. `split`:
 * side-by-side panes are available (wide screens). Target of the "Skip to plot" link.
 */
export function PlotArea({ split }: { split: boolean }) {
  const t = useT()
  const [registry] = useState(() => new PaneRegistry())
  const plotId = useActivePlotId()
  return (
    <PaneRegistryContext.Provider value={registry}>
      <section
        id="plot"
        aria-label={t('plot.region')}
        className="flex h-full min-h-0 flex-col bg-background"
        tabIndex={-1}
      >
        <PlotTabStrip layoutSwitch={split} />
        {/* Without a plot (every tab deleted) the toolbar would only offer controls that do nothing. */}
        {plotId ? (
          <>
            <PlotToolbar plotId={plotId} />
            <RecommendationBanner plotId={plotId} />
          </>
        ) : null}
        <PaneGrid split={split} />
        <ExclusionBar />
      </section>
    </PaneRegistryContext.Provider>
  )
}
