import { lazy, Suspense } from 'react'

// Help and history open on demand only, so they load in their own chunks (precached like every
// chunk, so they still open offline) instead of weighing on the first paint.
const HelpPanelChunk = lazy(() => import('@/features/help/HelpPanel').then((m) => ({ default: m.HelpPanel })))
const HistoryPanelChunk = lazy(() =>
  import('@/features/history/HistoryPanel').then((m) => ({ default: m.HistoryPanel })),
)

export function HelpPanel() {
  return (
    <Suspense fallback={null}>
      <HelpPanelChunk />
    </Suspense>
  )
}

export function HistoryPanel() {
  return (
    <Suspense fallback={null}>
      <HistoryPanelChunk />
    </Suspense>
  )
}
