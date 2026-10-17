import { useId, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { Check, Grid3x3, Rows3, SquareDashed, StickyNote, Table2, Text } from 'lucide-react'
import type { GridRange } from '@/domain/import/a1'
import type { BlockKind, DetectedBlock } from '@/domain/import/blocks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useT } from '@/i18n/I18nProvider'
import { cn } from '@/lib/utils'
import {
  blockLabel,
  headerSummary,
  parseTypedRange,
  sheetA1,
  usedA1,
  type ClickMode,
  type PickerSheet,
} from './pickerState'

const KIND_ICON: Record<BlockKind, typeof Table2> = {
  table: Table2,
  matrix: Grid3x3,
  keyValue: Text,
  note: StickyNote,
}

/** One option: a detected block, or a range the user drew (listed after the blocks). */
interface Option {
  key: string
  block: DetectedBlock | null
  number: number | null
  range: GridRange
}

/**
 * Every block of the sheet as a multi-select listbox (the keyboard twin of the grid): click selects one,
 * Ctrl/Cmd+click toggles, Shift+click selects a range; arrows move, Space toggles, Shift+arrows extend,
 * Ctrl/Cmd+A selects every table. Drawn ranges are listed too; toggling one off removes it.
 */
export function BlockList({
  sheet,
  selected,
  drawn,
  onBlock,
  onRemove,
  onActivate,
  onSelectAll,
  onFocusItem,
}: {
  sheet: PickerSheet
  selected: ReadonlySet<string>
  drawn: readonly { key: string; range: GridRange }[]
  onBlock: (blockId: string, mode: ClickMode) => void
  onRemove: (key: string) => void
  /** A drawn range clicked: its settings are shown. */
  onActivate: (key: string) => void
  onSelectAll: () => void
  /** The option under the keyboard focus or the pointer: the grid scrolls to it. */
  onFocusItem: (range: GridRange) => void
}) {
  const t = useT()
  const id = useId()
  const options: Option[] = [
    ...sheet.blocks.map((b, i) => ({ key: b.id, block: b, number: i + 1, range: b.range })),
    ...drawn.map((d) => ({ key: d.key, block: null, number: null, range: d.range })),
  ]
  const [focus, setFocus] = useState(0)
  const at = Math.min(focus, Math.max(0, options.length - 1))

  const activate = (k: number, mode: ClickMode) => {
    const o = options[k]
    if (!o) return
    if (o.block) onBlock(o.block.id, mode)
    else if (mode === 'toggle') onRemove(o.key)
    else onActivate(o.key)
  }
  const move = (k: number, shift: boolean) => {
    const next = Math.max(0, Math.min(options.length - 1, k))
    setFocus(next)
    const o = options[next]
    if (!o) return
    if (shift && o.block) onBlock(o.block.id, 'range')
    onFocusItem(o.range)
    document.getElementById(`${id}-${next}`)?.scrollIntoView({ block: 'nearest' })
  }
  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      onSelectAll()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      move(at + (e.key === 'ArrowDown' ? 1 : -1), e.shiftKey)
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      move(e.key === 'Home' ? 0 : options.length - 1, e.shiftKey)
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      activate(at, 'toggle')
    }
  }
  const onClick = (e: MouseEvent, k: number) => {
    setFocus(k)
    activate(k, e.shiftKey ? 'range' : e.ctrlKey || e.metaKey ? 'toggle' : 'single')
    onFocusItem(options[k]!.range)
  }

  if (options.length === 0)
    return <p className="px-3 text-xs text-muted-foreground">{t('picker.list.empty')}</p>
  return (
    <ul
      role="listbox"
      aria-label={t('picker.list.title')}
      aria-multiselectable="true"
      aria-activedescendant={`${id}-${at}`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      data-testid="block-list"
      // The focused option carries the focus ring (outline below), not the whole list.
      className="group/list max-h-64 overflow-y-auto overscroll-contain py-1 outline-none"
    >
      {options.map((o, k) => {
        const on = selected.has(o.key)
        const b = o.block
        const Icon = b ? KIND_ICON[b.kind] : SquareDashed
        const h = o.range.r1 - o.range.r0 + 1
        const w = o.range.c1 - o.range.c0 + 1
        const table = !b || b.kind === 'table' || b.kind === 'matrix'
        const named = b ? blockLabel(b) : ''
        const columns = b && !named && table ? headerSummary(b) : ''
        // A note is shown by its text, as in the sheet.
        const note = b?.kind === 'note' ? (b.notes[0] ?? '') : ''
        const title = b ? named || columns || note || t('picker.list.untitled') : t('picker.list.kinds.range')
        return (
          <li
            key={o.key}
            id={`${id}-${k}`}
            role="option"
            aria-selected={on}
            data-key={o.key}
            onClick={(e) => onClick(e, k)}
            className={cn(
              'mx-1 flex cursor-pointer items-start gap-2 rounded-[4px] px-2 py-1.5 text-xs select-none',
              on ? 'bg-selection' : 'hover:bg-panel-sunken',
              k === at &&
                'group-focus-visible/list:outline-2 group-focus-visible/list:-outline-offset-2 group-focus-visible/list:outline-ring',
              !table && !on && 'text-muted-foreground',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'mt-px flex size-4 shrink-0 items-center justify-center rounded-[3px] border',
                on ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/70',
              )}
            >
              {on ? <Check className="size-3" /> : null}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                {o.number !== null ? (
                  <span className="font-mono text-2xs text-muted-foreground tabular-nums">{o.number}</span>
                ) : null}
                <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                <span
                  className={cn(
                    'truncate',
                    table && 'font-medium text-foreground',
                    // Variable names standing in for a missing title: not set like a title.
                    columns && 'font-normal',
                  )}
                >
                  {title}
                </span>
              </span>
              <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-2xs text-muted-foreground">
                <span className="font-mono" translate="no">
                  {b ? b.a1 : sheetA1(sheet, o.range)}
                </span>
                <span className="tabular-nums">{t('picker.list.size', { rows: h, cols: w })}</span>
                {b && !table ? <span>{t(`picker.list.kinds.${b.kind}`)}</span> : null}
                {b?.orientation === 'rows' ? (
                  <span className="inline-flex items-center gap-0.5">
                    <Rows3 aria-hidden className="size-3" strokeWidth={1.75} />
                    {t('picker.list.rows')}
                  </span>
                ) : null}
                {b?.hints.length ? <span className="text-warning">{t('picker.list.joinable')}</span> : null}
              </span>
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/** "B2:E9" typed by the user: validated against the sheet, with the problem said in words. */
export function RangeField({ sheet, onAdd }: { sheet: PickerSheet; onAdd: (range: GridRange) => void }) {
  const t = useT()
  const id = useId()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const submit = () => {
    const v = text.trim()
    if (!v) return
    const r = parseTypedRange(sheet, v)
    if (!r.ok) {
      setError(
        r.reason === 'invalid'
          ? t('picker.range.invalid')
          : r.reason === 'outside'
            ? t('picker.range.outside', { range: v.toUpperCase(), used: usedA1(sheet) })
            : t('picker.range.empty', { range: v.toUpperCase() }),
      )
      return
    }
    setError(null)
    setText('')
    onAdd(r.range)
  }
  return (
    <form
      className="flex flex-col gap-1 px-3"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <label htmlFor={id} className="text-xs text-muted-foreground">
        {t('picker.range.label')}
      </label>
      <div className="flex gap-1.5">
        <Input
          id={id}
          name="range"
          value={text}
          placeholder="B2:E9"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-err` : undefined}
          onChange={(e) => {
            setText(e.target.value)
            if (error) setError(null)
          }}
          className="h-7 bg-background font-mono text-sm uppercase placeholder:normal-case"
        />
        <Button type="submit" variant="outline" size="sm" disabled={!text.trim()}>
          {t('picker.range.add')}
        </Button>
      </div>
      {error ? (
        <p id={`${id}-err`} className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  )
}
