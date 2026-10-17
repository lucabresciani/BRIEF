import { useId, useState } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useT } from '@/i18n/I18nProvider'
import { parseUserNumber, formatPlain } from '@/lib/numberInput'

/**
 * Number input that accepts "1.5" and "1,5", shows the value in the UI locale and validates on blur/Enter.
 * Invalid text is never saved: the field shows the error and keeps the previous value.
 */
export function NumberField({
  label,
  value,
  onCommit,
  decimal,
  min,
  allowEmpty = false,
  validate,
  className,
  hideLabel = false,
  inputClassName,
}: {
  label: string
  value: number | null
  onCommit: (v: number | null) => void
  decimal: '.' | ','
  min?: number
  allowEmpty?: boolean
  /** Return an error message (already translated) or null. */
  validate?: (v: number) => string | null
  className?: string
  hideLabel?: boolean
  inputClassName?: string
}) {
  const t = useT()
  const id = useId()
  const [text, setText] = useState(() => (value === null ? '' : formatPlain(value, decimal)))
  const [error, setError] = useState<string | null>(null)

  // Follow external changes (undo, locale) without an effect.
  const [prev, setPrev] = useState({ value, decimal })
  if (value !== prev.value || decimal !== prev.decimal) {
    setPrev({ value, decimal })
    setText(value === null ? '' : formatPlain(value, decimal))
    setError(null)
  }

  const commit = () => {
    const trimmed = text.trim()
    if (!trimmed) {
      if (allowEmpty) {
        setError(null)
        if (value !== null) onCommit(null)
      } else {
        setText(value === null ? '' : formatPlain(value, decimal))
      }
      return
    }
    const v = parseUserNumber(trimmed)
    if (v === null) {
      setError(t('issues.E_NOT_A_NUMBER.title', { example: decimal === ',' ? '0,05' : '0.05' }))
      return
    }
    if (min !== undefined && v < min) {
      setError(t('issues.E_UNCERTAINTY_NEGATIVE.title'))
      return
    }
    const custom = validate?.(v) ?? null
    if (custom) {
      setError(custom)
      return
    }
    setError(null)
    if (v !== value) onCommit(v)
  }

  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <label htmlFor={id} className={cn('text-xs text-muted-foreground', hideLabel && 'sr-only')}>
        {label}
      </label>
      <Input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        value={text}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') {
            setText(value === null ? '' : formatPlain(value, decimal))
            setError(null)
          }
        }}
        className={cn('num h-7 bg-background font-mono text-sm', inputClassName)}
      />
      {error ? (
        <p id={`${id}-err`} className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
