import { useId, useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

/** A titled group inside a panel. Collapsible sections remember nothing: they start in `defaultOpen`. */
export function Section({
  title,
  children,
  actions,
  collapsible = false,
  defaultOpen = true,
  className,
}: {
  title: string
  children: ReactNode
  actions?: ReactNode
  collapsible?: boolean
  defaultOpen?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  const id = useId()
  return (
    <section
      className={cn('border-b border-border px-3 py-3 last:border-b-0', className)}
      aria-labelledby={`${id}-h`}
    >
      <div className="mb-2 flex min-h-6 items-center justify-between gap-2">
        {collapsible ? (
          // Disclosure pattern: the button sits inside the heading so the section stays in the heading outline.
          <h3 className="min-w-0">
            <button
              type="button"
              className="-mx-1 flex min-h-6 items-center gap-1 rounded-sm px-1 text-left text-sm font-semibold text-foreground hover:bg-accent"
              aria-expanded={open}
              aria-controls={`${id}-c`}
              onClick={() => setOpen((o) => !o)}
            >
              <ChevronRight
                className={cn(
                  'size-3.5 shrink-0 text-muted-foreground transition-transform duration-150',
                  open && 'rotate-90',
                )}
                aria-hidden
              />
              <span id={`${id}-h`}>{title}</span>
            </button>
          </h3>
        ) : (
          <h3 id={`${id}-h`} className="text-sm font-semibold text-foreground">
            {title}
          </h3>
        )}
        {actions ? <div className="flex items-center gap-1">{actions}</div> : null}
      </div>
      {(!collapsible || open) && (
        <div id={`${id}-c`} className="flex flex-col gap-3">
          {children}
        </div>
      )}
    </section>
  )
}
