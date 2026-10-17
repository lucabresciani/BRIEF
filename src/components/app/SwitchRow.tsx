import { useId, type ReactNode } from 'react'
import { Switch } from '@/components/ui/switch'

export function SwitchRow({
  label,
  checked,
  onChange,
  disabled,
  hint,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  hint?: ReactNode
}) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1">
      <div className="flex min-h-7 items-center justify-between gap-3">
        <label htmlFor={id} className="text-sm text-foreground">
          {label}
        </label>
        <Switch
          id={id}
          checked={checked}
          onCheckedChange={(v) => onChange(v)}
          disabled={disabled}
          aria-describedby={hint ? `${id}-hint` : undefined}
        />
      </div>
      {hint ? (
        <div id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </div>
      ) : null}
    </div>
  )
}
