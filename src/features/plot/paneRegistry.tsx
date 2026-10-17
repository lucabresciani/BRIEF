import { createContext, useContext, useEffect, useSyncExternalStore, type RefObject } from 'react'
import type { PlotId } from '@/domain/model'
import type { PlotCanvasHandle } from '@/plot/PlotCanvas'

interface PaneEntry {
  canvas: RefObject<PlotCanvasHandle | null>
  /** uirevision of the figure on screen: a zoom recorded under another one is stale. */
  viewRev: string
}

/**
 * The canvases on screen, by plot: the one toolbar above the panes zooms the canvas of the focused
 * pane, and offers "Use view as axis limits" only for a zoom that canvas still shows.
 */
export class PaneRegistry {
  private entries = new Map<PlotId, PaneEntry>()
  private listeners = new Set<() => void>()

  set(plotId: PlotId, entry: PaneEntry): void {
    const old = this.entries.get(plotId)
    if (old && old.canvas === entry.canvas && old.viewRev === entry.viewRev) return
    this.entries.set(plotId, entry)
    this.emit()
  }

  /** Only the pane that registered the entry removes it (a remounting pane may have replaced it). */
  delete(plotId: PlotId, canvas: RefObject<PlotCanvasHandle | null>): void {
    if (this.entries.get(plotId)?.canvas !== canvas) return
    this.entries.delete(plotId)
    this.emit()
  }

  canvas(plotId: PlotId | null): PlotCanvasHandle | null {
    return plotId ? (this.entries.get(plotId)?.canvas.current ?? null) : null
  }

  viewRev(plotId: PlotId | null): string | null {
    return plotId ? (this.entries.get(plotId)?.viewRev ?? null) : null
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit(): void {
    for (const fn of this.listeners) fn()
  }
}

/** PlotArea provides one per plot area; the default serves components rendered on their own (tests). */
export const PaneRegistryContext = createContext<PaneRegistry>(new PaneRegistry())

export const usePaneRegistry = () => useContext(PaneRegistryContext)

/** The uirevision on screen for a plot, or null when no pane shows it. */
export function usePaneViewRev(plotId: PlotId | null): string | null {
  const registry = usePaneRegistry()
  return useSyncExternalStore(registry.subscribe, () => registry.viewRev(plotId))
}

/** Registers a pane's canvas while it shows `plotId`. */
export function useRegisterPane(
  plotId: PlotId,
  canvas: RefObject<PlotCanvasHandle | null>,
  viewRev: string,
): void {
  const registry = usePaneRegistry()
  useEffect(() => registry.set(plotId, { canvas, viewRev }), [registry, plotId, canvas, viewRev])
  useEffect(() => () => registry.delete(plotId, canvas), [registry, plotId, canvas])
}
