/**
 * Preload the Plotly chunk when the browser is idle (called once the shell is visible). A failed
 * preload is ignored: the plot loads the chunk again when it renders, and reports a failure there.
 */
export function preloadPlot(): void {
  const go = () => void import('./PlotCanvas').catch(() => undefined)
  if ('requestIdleCallback' in window) window.requestIdleCallback(go, { timeout: 2000 })
  else setTimeout(go, 300)
}
