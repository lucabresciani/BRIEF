import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  Columns2,
  Copy,
  Grid2x2,
  MoreHorizontal,
  MoveLeft,
  MoveRight,
  Pencil,
  Plus,
  Square,
  Trash2,
} from 'lucide-react'
import type { PlotId } from '@/domain/model'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { toast } from '@/components/ui/toast'
import { useT } from '@/i18n/I18nProvider'
import type { Translator } from '@/i18n/translate'
import { undo, useProjectStore } from '@/state/projectStore'
import { ui, useUiStore, type Layout } from '@/state/uiStore'
import { getActivePlotId, useActivePlotId } from '@/state/workspace'
import { duplicatePlot, movePlot, removePlot, renamePlot } from '@/state/actions/plot'
import { cn } from '@/lib/utils'
import { NewPlotMenu } from './NewPlotMenu'
import { commitPendingEdit, paneId, tabId, usePlotLabels } from './plotLabels'

const LAYOUTS: { layout: Layout; icon: typeof Square; key: 'single' | 'columns' | 'grid' }[] = [
  { layout: 'single', icon: Square, key: 'single' },
  { layout: 'columns', icon: Columns2, key: 'columns' },
  { layout: 'grid', icon: Grid2x2, key: 'grid' },
]

/**
 * Deletes a plot and offers to undo it. The toast's Undo only undoes the deletion itself: the toast
 * closes as soon as the deletion is no longer the last step (undone elsewhere, or another edit).
 */
function deleteWithUndo(plotId: PlotId, label: string, t: Translator): void {
  removePlot(plotId)
  const entry = useProjectStore.getState().past.at(-1)
  if (entry?.op !== 'plot.remove' || entry.plotId !== plotId) return
  const isLast = () => useProjectStore.getState().past.at(-1)?.id === entry.id
  const stop = useProjectStore.subscribe(() => {
    if (!isLast()) toast.close(id)
  })
  const id = toast.add({
    title: t('plot.tabs.deleted', { name: label }),
    type: 'success',
    onRemove: stop,
    actionProps: {
      children: t('topbar.undo'),
      onClick: () => {
        if (isLast()) undo()
        toast.close(id)
      },
    },
  })
}

/**
 * The plots of the project as tabs (WAI-ARIA tabs with manual activation): arrows, Home and End move
 * the focus, Enter or Space shows the plot, F2 or a double click renames it. Each tab has its own
 * actions menu next to it. Showing a plot focuses the pane that has it, else loads it into the focused
 * pane. `layoutSwitch`: the single / two / four panes switch (wide screens only).
 */
export function PlotTabStrip({ layoutSwitch }: { layoutSwitch: boolean }) {
  const t = useT()
  const plots = useProjectStore((s) => s.doc.plots)
  const readOnly = useProjectStore((s) => s.readOnly)
  const labels = usePlotLabels()
  const active = useActivePlotId()
  const ws = useUiStore((s) => s.workspace)
  const split = layoutSwitch && ws.layout !== 'single'
  const [renaming, setRenaming] = useState<PlotId | null>(null)
  const tabs = useRef(new Map<PlotId, HTMLButtonElement>())
  const scroller = useRef<HTMLDivElement>(null)
  // Which ends of the strip hide tabs: those ends fade out, so a cut tab reads as "more this way".
  const [hidden, setHidden] = useState({ start: false, end: false })
  const measure = () => {
    const el = scroller.current
    if (!el) return
    const start = el.scrollLeft > 1
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
    setHidden((h) => (h.start === start && h.end === end ? h : { start, end }))
  }
  useEffect(() => {
    const el = scroller.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(measure, [plots, labels])
  const fade = (on: boolean) => (on ? '1.5rem' : '0px')

  const focusTab = (id: PlotId | null) =>
    requestAnimationFrame(() => {
      const el = id ? tabs.current.get(id) : undefined
      el?.focus()
      el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    })

  // The active tab stays in view: a plot shown from the history, a new plot added at the end.
  useEffect(() => {
    if (active) tabs.current.get(active)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active, plots.length])

  const onTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = plots.length - 1
    let next: number
    switch (e.key) {
      case 'ArrowRight':
        next = index === last ? 0 : index + 1
        break
      case 'ArrowLeft':
        next = index === 0 ? last : index - 1
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = last
        break
      case 'F2':
        e.preventDefault()
        if (!readOnly) setRenaming(plots[index].id)
        return
      default:
        return
    }
    e.preventDefault()
    const el = tabs.current.get(plots[next].id)
    el?.focus()
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  // Panes on screen: below lg only the focused one is.
  const paneOf = (id: PlotId) => {
    const at = ws.panes.indexOf(id)
    return at >= 0 && (split || at === ws.focused) ? at : -1
  }

  return (
    <div className="flex h-9 shrink-0 items-stretch border-b border-border bg-panel">
      <div
        ref={scroller}
        role="tablist"
        aria-label={t('plot.tabs.list')}
        className="flex min-w-0 scroll-px-6 [scrollbar-width:none] items-stretch overflow-x-auto overscroll-x-contain [&::-webkit-scrollbar]:hidden"
        style={{
          maskImage: `linear-gradient(to right, transparent, #000 ${fade(hidden.start)}, #000 calc(100% - ${fade(hidden.end)}), transparent)`,
        }}
        onScroll={measure}
        // A vertical wheel scrolls the tabs sideways (the strip never scrolls vertically).
        onWheel={(e) => {
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY
        }}
      >
        {plots.map((plot, index) => {
          const label = labels.get(plot.id) ?? ''
          const selected = plot.id === active
          const pane = paneOf(plot.id)
          const onScreen = split && pane >= 0 && !selected
          return (
            <div
              key={plot.id}
              role="presentation"
              className="group/tab relative flex shrink-0 border-r border-border"
            >
              {renaming === plot.id ? (
                <RenameField
                  label={label}
                  onDone={(name, byKey) => {
                    setRenaming(null)
                    if (name !== null) renamePlot(plot.id, name)
                    // Left by a click elsewhere (another tab): the focus stays where the click put it.
                    if (byKey) focusTab(plot.id)
                  }}
                />
              ) : (
                <button
                  ref={(el) => {
                    if (el) tabs.current.set(plot.id, el)
                    else tabs.current.delete(plot.id)
                  }}
                  type="button"
                  role="tab"
                  id={tabId(plot.id)}
                  aria-selected={selected}
                  aria-controls={pane >= 0 ? paneId(pane) : undefined}
                  aria-describedby={onScreen ? `${tabId(plot.id)}-pane` : undefined}
                  tabIndex={selected ? 0 : -1}
                  title={label}
                  // Shown on a mouse press: closing a rename field reflows the strip under the pointer,
                  // and the release would then land beside the tab (no click). A field being edited
                  // (the inspector, a tab name) commits first, to the plot it was typed for.
                  onPointerDown={(e) => {
                    if (e.pointerType !== 'mouse' || e.button !== 0) return
                    commitPendingEdit(null)
                    ui.showPlot(plot.id)
                  }}
                  onClick={() => ui.showPlot(plot.id)}
                  onDoubleClick={() => !readOnly && setRenaming(plot.id)}
                  onKeyDown={(e) => onTabKeyDown(e, index)}
                  className={cn(
                    'relative flex h-full max-w-56 min-w-0 touch-manipulation items-center pr-8 pl-3 text-sm whitespace-nowrap text-muted-foreground transition-colors duration-(--dur-press) ease-(--ease-out-ui) select-none hover:text-foreground focus-visible:-outline-offset-2',
                    // A 2 px bar marks the tab: the accent for the active plot, the strong border for the
                    // other plots on screen. The active tab merges into the toolbar below it.
                    'before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-transparent',
                    selected
                      ? 'bg-background text-foreground before:bg-primary after:absolute after:inset-x-0 after:-bottom-px after:h-px after:bg-background'
                      : 'hover:bg-accent/60',
                    onScreen && 'text-foreground before:bg-border-strong',
                  )}
                >
                  <span className="truncate">{label}</span>
                </button>
              )}
              {onScreen ? (
                // A description, not part of the name: the tab is still called by its plot's label.
                <span id={`${tabId(plot.id)}-pane`} hidden>
                  {t('plot.tabs.shownInPane', { n: pane + 1 })}
                </span>
              ) : null}
              {/* Mounted while renaming: its menu may still be closing (focus stays in the field). */}
              <TabMenu
                hidden={renaming === plot.id}
                plotId={plot.id}
                label={label}
                index={index}
                count={plots.length}
                selected={selected}
                readOnly={readOnly}
                onRename={() => setRenaming(plot.id)}
                onDeleted={() => focusTab(getActivePlotId())}
                onMoved={() => focusTab(plot.id)}
                onDuplicated={(id) => focusTab(id)}
              />
            </div>
          )
        })}
      </div>
      <div className="flex shrink-0 items-center px-1">
        <NewPlotMenu
          render={<Button size="icon-sm" variant="ghost" aria-label={t('plot.tabs.newPlot')} />}
          tooltip={t('plot.tabs.newPlot')}
        >
          <Plus aria-hidden />
        </NewPlotMenu>
      </div>
      {layoutSwitch ? (
        <ToggleGroup
          aria-label={t('plot.layout.label')}
          value={[ws.layout]}
          onValueChange={(v) => {
            const next = v[0] as Layout | undefined
            if (next) ui.setLayout(next)
          }}
          size="sm"
          className="ml-auto hidden shrink-0 items-center self-center px-2 lg:flex"
        >
          {LAYOUTS.map(({ layout, icon: Icon, key }) => (
            <Tooltip key={layout}>
              <TooltipTrigger
                render={
                  <ToggleGroupItem
                    value={layout}
                    aria-label={t(`plot.layout.${key}`)}
                    className="size-7 px-0"
                  />
                }
              >
                <Icon className="size-4" aria-hidden />
              </TooltipTrigger>
              <TooltipContent side="bottom">{t(`plot.layout.${key}`)}</TooltipContent>
            </Tooltip>
          ))}
        </ToggleGroup>
      ) : null}
    </div>
  )
}

/**
 * Inline name field of a tab: Enter (or leaving the field) commits, Escape cancels. '' = automatic.
 * `byKey`: closed from the keyboard (the focus goes back to the tab), not by leaving the field.
 */
function RenameField({
  label,
  onDone,
}: {
  label: string
  onDone: (name: string | null, byKey: boolean) => void
}) {
  const t = useT()
  const [value, setValue] = useState(label)
  const finished = useRef(false)
  const finish = (commit: boolean, byKey: boolean) => {
    if (finished.current) return
    finished.current = true
    const name = value.trim()
    onDone(commit && name !== label ? name : null, byKey)
  }
  return (
    <input
      autoFocus
      aria-label={t('plot.tabs.nameField')}
      name="plotName"
      autoComplete="off"
      spellCheck={false}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => finish(true, false)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          finish(true, true)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          finish(false, true)
        }
      }}
      className="mx-1.5 h-7 w-44 self-center rounded-sm border border-input bg-background px-1.5 text-sm"
    />
  )
}

function TabMenu({
  hidden,
  plotId,
  label,
  index,
  count,
  selected,
  readOnly,
  onRename,
  onDeleted,
  onMoved,
  onDuplicated,
}: {
  hidden: boolean
  plotId: PlotId
  label: string
  index: number
  count: number
  selected: boolean
  readOnly: boolean
  onRename: () => void
  onDeleted: () => void
  onMoved: () => void
  onDuplicated: (id: PlotId) => void
}) {
  const t = useT()
  const name = t('plot.tabs.actions', { name: label })
  // Every action moves the focus itself (the trigger may be gone, or the name field takes the focus).
  const acted = useRef(false)
  const act = (fn: () => void) => () => {
    acted.current = true
    fn()
  }
  const finalFocus = () => {
    const keep = !acted.current
    acted.current = false
    return keep
  }
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={name}
                  // Only the active tab's menu is a Tab stop; the others open with the pointer.
                  tabIndex={selected ? 0 : -1}
                  className={cn(
                    'absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground hover:text-foreground data-popup-open:visible',
                    !selected && 'invisible group-focus-within/tab:visible group-hover/tab:visible',
                    hidden && 'hidden',
                  )}
                />
              }
            />
          }
        >
          <MoreHorizontal aria-hidden />
        </TooltipTrigger>
        <TooltipContent side="bottom">{name}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="min-w-44" finalFocus={finalFocus}>
        <DropdownMenuItem disabled={readOnly} onClick={act(onRename)}>
          <Pencil aria-hidden />
          {t('common.rename')}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={readOnly}
          onClick={act(() => {
            const id = duplicatePlot(plotId)
            if (id) onDuplicated(id)
          })}
        >
          <Copy aria-hidden />
          {t('plot.tabs.duplicate')}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={readOnly || index === 0}
          onClick={act(() => {
            movePlot(plotId, index - 1)
            onMoved()
          })}
        >
          <MoveLeft aria-hidden />
          {t('plot.tabs.moveLeft')}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={readOnly || index === count - 1}
          onClick={act(() => {
            movePlot(plotId, index + 1)
            onMoved()
          })}
        >
          <MoveRight aria-hidden />
          {t('plot.tabs.moveRight')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          disabled={readOnly}
          onClick={act(() => {
            deleteWithUndo(plotId, label, t)
            onDeleted()
          })}
        >
          <Trash2 aria-hidden />
          {t('plot.tabs.delete')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
