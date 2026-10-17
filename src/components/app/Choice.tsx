import { Select as SelectPrimitive } from '@base-ui/react/select'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

export interface ChoiceItem<V extends string> {
  value: V
  label: string
  disabled?: boolean
  /** Shown as a tooltip-free secondary line (e.g. why an option is disabled). */
  hint?: string
}

/**
 * Labelled single choice built on Base UI Select. Passing `items` makes the trigger show the label
 * (Base UI otherwise shows the raw value). `id` is the trigger's id (for an external `htmlFor`).
 */
export function Choice<V extends string>({
  label,
  value,
  items,
  onChange,
  className,
  hideLabel = false,
  disabled,
  placeholder,
  id,
}: {
  label: string
  value: V | null
  items: readonly ChoiceItem<V>[]
  onChange: (value: V) => void
  className?: string
  hideLabel?: boolean
  disabled?: boolean
  placeholder?: string
  id?: string
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <Select
        id={id}
        items={items.map((i) => ({ value: i.value, label: i.label }))}
        value={value}
        onValueChange={(v) => {
          if (v !== null) onChange(v as V)
        }}
        disabled={disabled}
      >
        {/* Base UI's label names the trigger and, like a native <label>, focuses it on click. */}
        <SelectPrimitive.Label className={cn('text-xs text-muted-foreground', hideLabel && 'sr-only')}>
          {label}
        </SelectPrimitive.Label>
        <SelectTrigger size="sm" className="w-full min-w-0 bg-background">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {items.map((i) => (
            <SelectItem key={i.value} value={i.value} disabled={i.disabled}>
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{i.label}</span>
                {i.hint ? (
                  <span className="text-xs whitespace-normal text-muted-foreground">{i.hint}</span>
                ) : null}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
