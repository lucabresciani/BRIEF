import { useId, useState } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/** Text input that commits on blur / Enter (each commit is one undoable step); Escape restores. */
export function TextField({
  label,
  value,
  onCommit,
  placeholder,
  hideLabel = false,
  className,
  inputClassName,
  validate,
  mono = false,
}: {
  label: string
  value: string
  onCommit: (v: string) => void
  placeholder?: string
  hideLabel?: boolean
  className?: string
  inputClassName?: string
  validate?: (v: string) => string | null
  mono?: boolean
}) {
  const id = useId()
  const [text, setText] = useState(value)
  const [error, setError] = useState<string | null>(null)
  // Follow external changes (undo, another control) without an effect.
  const [prev, setPrev] = useState(value)
  if (value !== prev) {
    setPrev(value)
    setText(value)
  }

  const commit = () => {
    const v = text.trim()
    const err = validate?.(v) ?? null
    setError(err)
    if (err) return
    if (v !== value) onCommit(v)
  }
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <label htmlFor={id} className={cn('text-xs text-muted-foreground', hideLabel && 'sr-only')}>
        {label}
      </label>
      <Input
        id={id}
        value={text}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={mono ? false : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') {
            setText(value)
            setError(null)
          }
        }}
        className={cn('h-7 bg-background text-sm', mono && 'font-mono', inputClassName)}
      />
      {error ? (
        <p id={`${id}-err`} className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
