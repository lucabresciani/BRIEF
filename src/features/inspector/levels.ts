import type { InspectorTab, Level } from '@/state/uiStore'

/** Tabs available per disclosure level. An existing fit keeps its tab visible. */
export function visibleTabs(level: Level, hasFit: boolean): InspectorTab[] {
  if (level === 'beginner')
    return hasFit ? ['plot', 'fit', 'statistics', 'style'] : ['plot', 'statistics', 'style']
  return ['plot', 'fit', 'uncertainty', 'statistics', 'style']
}
