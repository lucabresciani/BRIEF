import { forwardRef, lazy, Suspense } from 'react'
import type { PlotCanvasHandle, PlotCanvasProps } from './PlotCanvas'

// Plotly is ~1.5 MB: it loads in its own chunk after the shell has painted.
const Inner = lazy(() => import('./PlotCanvas'))

export const PlotCanvasLazy = forwardRef<PlotCanvasHandle, PlotCanvasProps & { fallback: React.ReactNode }>(
  function PlotCanvasLazy({ fallback, ...props }, ref) {
    return (
      <Suspense fallback={fallback}>
        <Inner ref={ref} {...props} />
      </Suspense>
    )
  },
)
