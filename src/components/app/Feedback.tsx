import { useRef, useState, type ReactElement, type ReactNode } from 'react'
import { Popover as PopoverPrimitive } from '@base-ui/react/popover'
import { CircleAlert, Info, Lightbulb, TriangleAlert } from 'lucide-react'
import type { Issue, RowId } from '@/domain/model'
import { Popover, PopoverTrigger } from '@/components/ui/popover'
import { useT } from '@/i18n/I18nProvider'
import { issueHint, issueTitle, type RowLabeler } from '@/i18n/translate'
import { useUiStore } from '@/state/uiStore'
import { cn } from '@/lib/utils'

/** A resting mouse opens the tip after this long; a pointer just passing over does not. */
const HOVER_OPEN_MS = 300
/** A tip the mouse opened stays this long after the pointer leaves, so a small slip does not close it. */
const HOVER_CLOSE_MS = 150

/**
 * A button that shows a short explanation (a "toggletip"). It is a popover rather than a tooltip
 * because a tooltip closes on click, never opens on touch and needs a still mouse, so a "?" that
 * people click or tap looked broken. Click, tap, Enter or Space toggle it and a resting mouse opens
 * it; Escape or a press outside closes it. Focus never leaves the button, so the tip interrupts
 * nothing and Escape lands back where the reader was.
 *
 * A press always means "show it": on a tip the resting mouse already opened, it pins the tip (the
 * pointer may then leave) instead of closing it, which would look like a "?" that does not respond.
 * The tip often covers the "?" of the rows above, so a press there is never lost: a pinned tip lets
 * it through to what lies under it (it closes, as on any press outside); a tip the mouse opened stays
 * under the pointer so that it can be read (WCAG 1.4.13), and a press on it dismisses it.
 */
export function Toggletip({
  trigger,
  children,
  content,
  side = 'top',
}: {
  /** The button element, without children: `<button type="button" aria-label="…" />`. */
  trigger: ReactElement
  /** What the button shows. */
  children: ReactNode
  /** The explanation. */
  content: ReactNode
  side?: 'top' | 'bottom'
}) {
  const actions = useRef<PopoverPrimitive.Root.Actions>(null)
  // Opened (or kept) by a press rather than by the resting mouse. The ref is read while Base UI
  // decides; the state only restyles the tip.
  const pinnedRef = useRef(false)
  const [pinned, setPinnedState] = useState(false)
  const setPinned = (value: boolean) => {
    pinnedRef.current = value
    setPinnedState(value)
  }
  const onOpenChange = (open: boolean, details: PopoverPrimitive.Root.ChangeEventDetails) => {
    const press = details.reason === 'trigger-press'
    if (open) {
      setPinned(press)
    } else if (press && !pinnedRef.current) {
      setPinned(true)
      details.cancel()
    } else if (details.reason === 'trigger-hover' && pinnedRef.current) {
      details.cancel()
    } else {
      setPinned(false)
    }
  }
  return (
    <Popover onOpenChange={onOpenChange} actionsRef={actions}>
      <PopoverTrigger openOnHover delay={HOVER_OPEN_MS} closeDelay={HOVER_CLOSE_MS} render={trigger}>
        {children}
      </PopoverTrigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className={cn('isolate z-(--z-tooltip)', pinned && 'pointer-events-none')}
        >
          <PopoverPrimitive.Popup
            initialFocus={false}
            data-slot="toggletip"
            data-pinned={pinned ? '' : undefined}
            onClick={() => actions.current?.close()}
            className={cn(
              'w-max max-w-72 rounded-lg bg-popover px-3 py-2 text-left text-xs leading-snug text-pretty text-popover-foreground shadow-popover ring-1 ring-foreground/10',
              // Scale from the button; a short exit; no motion when opened from the keyboard or
              // dismissed with Escape (data-instant). Reduced motion is handled globally in index.css.
              'origin-(--transform-origin) transition-[opacity,scale] duration-(--dur-popover) ease-out data-ending-style:scale-97 data-ending-style:opacity-0 data-ending-style:duration-100 data-ending-style:ease-in data-instant:duration-0 data-starting-style:scale-97 data-starting-style:opacity-0',
            )}
          >
            {content}
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </Popover>
  )
}

/**
 * Small "?" next to a statistic or control. `label` is the button's accessible name (default: the
 * text itself), so a screen reader hears the explanation without opening the tip.
 */
export function InfoTip({ text, label }: { text: string; label?: string }) {
  return (
    <Toggletip
      trigger={
        <button
          type="button"
          className="relative inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors duration-(--dur-press) after:absolute after:-inset-0.5 hover:bg-accent hover:text-foreground data-popup-open:bg-accent data-popup-open:text-foreground"
          aria-label={label ?? text}
        />
      }
      content={text}
    >
      <Info className="size-3.5" aria-hidden />
    </Toggletip>
  )
}

/** Educational hint at the moment of decision; hidden when hints are turned off. */
export function Hint({ children, className }: { children: ReactNode; className?: string }) {
  const hints = useUiStore((s) => s.hints)
  if (!hints) return null
  return (
    <p className={cn('flex gap-1.5 text-xs leading-snug text-muted-foreground', className)}>
      <Lightbulb className="mt-px size-3.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  )
}

const ICON = { error: CircleAlert, warning: TriangleAlert, info: Info } as const
const TONE = {
  error: 'border-destructive/30 bg-destructive-surface text-destructive',
  warning: 'border-warning/30 bg-warning-surface text-warning',
  info: 'border-border bg-info-surface text-foreground',
} as const

/** One issue: icon + title + optional hint. Colour is never the only cue (icon and wording differ). */
export function IssueNote({
  issue,
  onShowRows,
  compact = false,
  rowLabel,
}: {
  issue: Issue
  onShowRows?: (rows: readonly RowId[]) => void
  compact?: boolean
  rowLabel?: RowLabeler
}) {
  const t = useT()
  const Icon = ICON[issue.severity]
  const hint = issueHint(t, issue, rowLabel)
  return (
    <div
      className={cn('flex gap-2 rounded-md border px-2.5 py-2 text-xs', TONE[issue.severity])}
      role={issue.severity === 'error' ? 'alert' : undefined}
    >
      <Icon className="mt-px size-3.5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 wrap-break-word">
        <p className="font-medium text-foreground">{issueTitle(t, issue, rowLabel)}</p>
        {!compact && hint ? <p className="mt-0.5 text-muted-foreground">{hint}</p> : null}
        {onShowRows && issue.rows && issue.rows.length > 0 ? (
          <button
            type="button"
            className="relative mt-1 rounded-sm text-primary underline-offset-2 after:absolute after:-inset-1 hover:underline"
            onClick={() => onShowRows(issue.rows!)}
          >
            {t('import.showRows')}
          </button>
        ) : null}
      </div>
    </div>
  )
}

export function IssueList({
  issues,
  onShowRows,
  compact,
  empty,
  rowLabel,
}: {
  issues: readonly Issue[]
  onShowRows?: (rows: readonly RowId[]) => void
  compact?: boolean
  empty?: ReactNode
  rowLabel?: RowLabeler
}) {
  if (!issues.length) return empty ? <>{empty}</> : null
  const order = { error: 0, warning: 1, info: 2 }
  const sorted = [...issues].sort((a, b) => order[a.severity] - order[b.severity])
  return (
    <ul className="flex flex-col gap-1.5">
      {sorted.map((i, k) => (
        <li key={`${i.code}-${k}`}>
          <IssueNote issue={i} onShowRows={onShowRows} compact={compact} rowLabel={rowLabel} />
        </li>
      ))}
    </ul>
  )
}
