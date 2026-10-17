import type { ComponentProps, ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Kbd } from '@/components/ui/kbd'
import { ariaKeyShortcuts } from '@/platform/shortcuts'

/** Icon-only button: always has an accessible name and a tooltip with the same text. */
export function IconButton({
  label,
  shortcut,
  children,
  pressed,
  size = 'icon-sm',
  variant = 'ghost',
  ...props
}: Omit<ComponentProps<typeof Button>, 'aria-label'> & {
  label: string
  shortcut?: string
  children: ReactNode
  pressed?: boolean
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            {...props}
            size={size}
            variant={variant}
            aria-label={label}
            // The tooltip is not announced: expose the shortcut in ARIA key names (⌘⇧Z → Meta+Shift+Z).
            aria-keyshortcuts={shortcut ? ariaKeyShortcuts(shortcut) : undefined}
            aria-pressed={pressed}
            data-pressed={pressed ? '' : undefined}
            className={
              pressed
                ? 'bg-selection text-primary hover:bg-selection-strong ' + (props.className ?? '')
                : props.className
            }
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {label}
        {shortcut ? <Kbd>{shortcut}</Kbd> : null}
      </TooltipContent>
    </Tooltip>
  )
}
