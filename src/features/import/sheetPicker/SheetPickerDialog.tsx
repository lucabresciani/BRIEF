import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { GridRange } from '@/domain/import/a1'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { IssueNote } from '@/components/app/Feedback'
import { useT } from '@/i18n/I18nProvider'
import { intlLocale } from '@/i18n/locale'
import { cn } from '@/lib/utils'
import { useProjectStore } from '@/state/projectStore'
import { useUiStore } from '@/state/uiStore'
import { cancelImport, useImportStore } from '../importFlow'
import { importFromPicker, importWholeSheet, pickSheet } from './pickerActions'
import { useDraftPreview } from '../draftPreview'
import { PreviewTable } from '../PreviewTable'
import { BlockList, RangeField } from './BlockList'
import {
  addRange,
  clearSelection,
  clickBlock,
  EMPTY_PICK,
  fromSpec,
  itemInfo,
  keepOnly,
  mergeCandidates,
  mergeProposal,
  pickerSheet,
  removeItem,
  selectAllTables,
  setActive,
  setLabel,
  setSettings,
  toSpec,
  type ClickMode,
  type PickerState,
} from './pickerState'
import type { LabelNames } from '@/domain/import/stack'
import { MergeProposal, SelectionPanel } from './SelectionPanel'
import { SheetGrid, type SheetGridHandle } from './SheetGrid'
import { useRegionPreview } from './usePreview'

/** Above this many cells, importing the whole sheet is offered first (the grid stays usable). */
const HUGE_SHEET = 500_000
const PREVIEW_ROWS = 20

/**
 * The sheet picker: a sheet holding several small tables is shown as it is, with its tables
 * outlined; the user selects tables (or draws ranges), says how each is read, and imports them one
 * dataset each, merged into one dataset with label columns, or the whole sheet as one table. Lazy chunk.
 */
export default function SheetPickerDialog() {
  const t = useT()
  const open = useUiStore((s) => s.dialog === 'sheetPicker')
  const sheetDraft = useImportStore((s) => s.sheetDraft)
  const loading = useImportStore((s) => s.loading)
  const error = useImportStore((s) => s.error)
  const source = useImportStore((s) => s.source)
  const replacing = useImportStore((s) => s.replacing)
  const pickerInit = useImportStore((s) => s.pickerInit)
  const replacingName = useProjectStore(
    (s) => (replacing && s.doc.datasets.find((d) => d.id === replacing)?.name) || '',
  )
  const gridRef = useRef<SheetGridHandle>(null)
  // Stable: a new function on every render would make the dialog move the focus back to the grid.
  const initialFocus = useCallback(() => gridRef.current?.element() ?? true, [])

  const sheet = useMemo(() => (sheetDraft ? pickerSheet(sheetDraft) : null), [sheetDraft])
  // Label columns the sheet does not name are named in the UI language (they become column names).
  const labelNames = useMemo<LabelNames>(
    () => ({
      title: (i, only) => (only ? t('picker.merge.titleOnly') : t('picker.merge.titleN', { n: i + 1 })),
      block: t('picker.merge.blockName'),
    }),
    [t],
  )
  // A new sheet (or file) starts a new selection; going to the preview and back keeps it.
  const session = sheetDraft?.rawTable.id ?? null
  const [pick, setPick] = useState<PickerState>(EMPTY_PICK)
  const [seen, setSeen] = useState<string | null>(null)
  if (session !== seen) {
    setSeen(session)
    setPick(
      sheet && pickerInit?.sheetName === sheet.name ? fromSpec(sheet, pickerInit, labelNames) : EMPTY_PICK,
    )
  }
  useEffect(() => {
    if (session && pickerInit) useImportStore.setState({ pickerInit: null })
  }, [session, pickerInit])

  const infos = useMemo(() => (sheet ? pick.items.map((i) => itemInfo(sheet, pick, i)) : []), [sheet, pick])
  const active = infos.find((i) => i.item.key === pick.active) ?? infos.at(-1) ?? null
  const proposal = useMemo(() => mergeProposal(infos), [infos])
  const candidates = useMemo(
    () => (infos.length >= 2 ? mergeCandidates(infos, labelNames) : []),
    [infos, labelNames],
  )
  const canMerge = infos.length >= 2 && new Set(infos.map((i) => i.orientation)).size === 1
  const preferMerge = !!proposal?.all && canMerge
  const selectedBlocks = useMemo(
    () => new Set(pick.items.flatMap((i) => (i.blockId ? [i.blockId] : []))),
    [pick.items],
  )
  const selectedKeys = useMemo(() => new Set(pick.items.map((i) => i.key)), [pick.items])
  const drawn = useMemo(
    () => pick.items.filter((i) => !i.blockId).map((i) => ({ key: i.key, range: i.range })),
    [pick.items],
  )

  const previewSpec = useMemo(() => {
    if (!sheet || !active) return null
    return preferMerge
      ? toSpec(sheet, pick, infos, 'stack', labelNames)
      : toSpec(sheet, pick, [active], 'separate')
  }, [sheet, pick, infos, active, preferMerge, labelNames])
  const preview = useRegionPreview(previewSpec, source?.kind === 'bytes' ? source : null)
  const previewView = useDraftPreview(preview.draft)

  const [rectNote, setRectNote] = useState('')
  const rectText = useCallback((a1: string) => t('picker.live.rect', { range: a1 }), [t])
  const selectionNote = infos.length
    ? t('picker.live.selected', {
        count: infos.length,
        list: infos.map((i) => (i.number !== null ? `${i.number}` : i.a1)).join(', '),
      })
    : t('picker.live.none')

  const [busy, setBusy] = useState<'separate' | 'stack' | null>(null)
  const runImport = async (mode: 'separate' | 'stack') => {
    if (!sheet || !infos.length) return
    setBusy(mode)
    await importFromPicker(t, toSpec(sheet, pick, infos, mode, labelNames))
    setBusy(null)
  }

  const onBlock = (id: string, mode: ClickMode) => {
    if (sheet) setPick((p) => clickBlock(p, sheet, id, mode))
  }
  const onRange = (range: GridRange, additive: boolean) => {
    if (sheet) setPick((p) => addRange(p, sheet, range, additive))
  }
  const onClear = () => {
    if (pick.items.length === 0) return false
    setPick(clearSelection)
    return true
  }

  const huge = !!sheet && sheet.rows * sheet.cols > HUGE_SHEET
  const sheets = sheetDraft?.detection.sheets ?? []
  const n = infos.length
  const disabled = loading || busy !== null
  const lead = sheet
    ? sheet.tables > 0
      ? t('picker.lead', { count: sheet.tables, sheet: sheet.name })
      : t('picker.leadNone', { sheet: sheet.name })
    : t('picker.reading')

  return (
    <Dialog open={open} onOpenChange={(o) => !o && cancelImport()}>
      <DialogContent
        initialFocus={initialFocus}
        onKeyDown={(e) => {
          // Ctrl/Cmd+A selects every table from anywhere in the dialog, except inside a text field.
          const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && !typing && sheet) {
            e.preventDefault()
            setPick((p) => selectAllTables(p, sheet))
          }
        }}
        className="flex h-[min(94dvh,62rem)] max-h-[94dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(96vw,92rem)]"
      >
        <DialogHeader className="gap-1.5 border-b border-border px-4 pt-4 pr-12 pb-3">
          <DialogTitle>{t('picker.title')}</DialogTitle>
          <DialogDescription>
            {lead}
            {replacing ? ` ${t('picker.replacing', { name: replacingName })}` : ''}
          </DialogDescription>
        </DialogHeader>
        {sheets.length > 1 && sheet ? (
          <SheetTabs
            label={t('picker.sheets')}
            sheets={sheets.map((s) => s.name)}
            current={sheet.name}
            disabled={disabled}
            onPick={(name) => void pickSheet(name)}
          />
        ) : null}
        {!sheet ? (
          <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground" role="status">
            <Spinner aria-hidden /> {t('picker.reading')}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:grid md:grid-cols-[minmax(0,1fr)_23rem] md:grid-rows-[minmax(0,1fr)] md:overflow-hidden">
            <div className="flex flex-col md:min-h-0">
              <div className="relative h-[19rem] shrink-0 md:h-auto md:min-h-0 md:flex-1">
                {sheet.rows === 0 || sheet.cols === 0 ? (
                  <p className="p-6 text-sm text-muted-foreground">{t('picker.emptySheet')}</p>
                ) : (
                  <SheetGrid
                    key={session ?? ''}
                    ref={gridRef}
                    sheet={sheet}
                    label={t('picker.gridLabel', { sheet: sheet.name })}
                    selectedBlocks={selectedBlocks}
                    drawn={drawn}
                    onBlock={onBlock}
                    onRange={onRange}
                    onSelectAll={() => setPick((p) => selectAllTables(p, sheet))}
                    onClear={onClear}
                    onAnnounce={setRectNote}
                    rectText={rectText}
                  />
                )}
                {loading ? (
                  <div
                    role="status"
                    className="absolute inset-0 z-40 flex items-center justify-center gap-2 bg-background/75 text-sm text-muted-foreground"
                  >
                    <Spinner aria-hidden /> {t('picker.reading')}
                  </div>
                ) : null}
              </div>
              <section
                aria-label={t('picker.preview.title')}
                className="flex h-[14rem] shrink-0 flex-col border-t border-border"
              >
                <div className="flex min-w-0 items-center gap-2 border-b border-border bg-panel px-3 py-1.5 text-xs">
                  <h3 className="font-semibold">{t('picker.preview.title')}</h3>
                  {preview.draft ? (
                    <span className="truncate text-muted-foreground">
                      {preferMerge ? t('picker.preview.merged') : preview.draft.suggestedName}
                    </span>
                  ) : null}
                  {preview.loading || preview.stale ? <Spinner aria-hidden className="size-3" /> : null}
                  {previewView ? (
                    <span className="num ml-auto shrink-0 text-muted-foreground">
                      {t('import.previewRows', {
                        n: Math.min(PREVIEW_ROWS, previewView.view.rowIds.length),
                        total: previewView.view.rowIds.length,
                      })}
                    </span>
                  ) : null}
                </div>
                <div
                  className={cn(
                    'min-h-0 flex-1 overflow-auto overscroll-contain bg-background',
                    preview.stale && 'opacity-60',
                  )}
                  aria-busy={preview.loading || preview.stale || undefined}
                  data-testid="picker-preview"
                >
                  {!active ? (
                    <p className="p-3 text-xs text-muted-foreground">{t('picker.preview.empty')}</p>
                  ) : preview.error ? (
                    <div className="p-3">
                      <IssueNote issue={preview.error} />
                    </div>
                  ) : preview.draft && previewView ? (
                    <PreviewTable
                      draft={preview.draft}
                      view={previewView.view}
                      rows={PREVIEW_ROWS}
                      label={t('picker.preview.title')}
                    />
                  ) : (
                    <p className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
                      <Spinner aria-hidden className="size-3" /> {t('picker.preview.loading')}
                    </p>
                  )}
                </div>
              </section>
            </div>
            <aside className="flex flex-col gap-4 border-t border-border bg-panel py-3 md:min-h-0 md:overflow-y-auto md:overscroll-contain md:border-t-0 md:border-l">
              <section aria-labelledby="picker-list-title" className="flex flex-col gap-1">
                <h3 id="picker-list-title" className="px-3 text-[0.8125rem] font-semibold">
                  {t('picker.list.title')}
                </h3>
                <BlockList
                  sheet={sheet}
                  selected={selectedKeys}
                  drawn={drawn}
                  onBlock={onBlock}
                  onRemove={(key) => setPick((p) => removeItem(p, key))}
                  onActivate={(key) => setPick((p) => setActive(p, key))}
                  onSelectAll={() => setPick((p) => selectAllTables(p, sheet))}
                  onFocusItem={(range) => gridRef.current?.reveal(range)}
                />
                {sheet.overflow > 0 ? (
                  <p className="px-3 text-xs text-muted-foreground">
                    {t('picker.overflow', { count: sheet.overflow })}
                  </p>
                ) : null}
                {huge ? (
                  <p className="px-3 text-xs text-warning">
                    {t('picker.hugeSheet', {
                      cells: (sheet.rows * sheet.cols).toLocaleString(intlLocale(t.lang)),
                    })}
                  </p>
                ) : null}
              </section>
              <RangeField sheet={sheet} onAdd={(range) => onRange(range, true)} />
              {proposal ? (
                <MergeProposal
                  proposal={proposal}
                  total={infos.length}
                  candidates={candidates}
                  state={pick}
                  onLabel={(c, patch) => setPick((p) => setLabel(p, c, patch))}
                  onKeepOnly={(keys) => setPick((p) => keepOnly(p, keys))}
                />
              ) : null}
              <section aria-labelledby="picker-selection-title" className="flex flex-col gap-2">
                <h3 id="picker-selection-title" className="px-3 text-[0.8125rem] font-semibold">
                  {t('picker.selection.title')}
                </h3>
                <SelectionPanel
                  sheet={sheet}
                  infos={infos}
                  active={active}
                  onActive={(key) => setPick((p) => setActive(p, key))}
                  onSettings={(key, patch) => setPick((p) => setSettings(p, key, patch))}
                  onRemove={(key) => setPick((p) => removeItem(p, key))}
                  onJoin={(range, keys) =>
                    setPick((p) => addRange(keys.reduce(removeItem, p), sheet, range, true))
                  }
                />
              </section>
            </aside>
          </div>
        )}
        <p className="sr-only" aria-live="polite">
          {selectionNote}
        </p>
        <p className="sr-only" aria-live="polite">
          {rectNote}
        </p>
        {error ? (
          <div className="border-t border-border px-4 py-2">
            <IssueNote issue={error} />
          </div>
        ) : null}
        <DialogFooter className="mx-0 mb-0 rounded-none border-t border-border bg-panel p-3 sm:items-center">
          {replacing && n > 1 && !canMerge ? (
            <p className="text-xs text-muted-foreground sm:mr-2">
              {t('picker.footer.oneToReplace', { name: replacingName })}
            </p>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={() => cancelImport()}
            // On a phone the close button in the corner does the same; the actions keep the room.
            className="hidden sm:mr-auto sm:inline-flex"
          >
            {t('common.cancel')}
          </Button>
          <Button
            variant={huge && n === 0 ? 'default' : 'outline'}
            size="sm"
            disabled={disabled || !sheet}
            onClick={() => importWholeSheet()}
          >
            {t('picker.footer.wholeSheet')}
          </Button>
          <Button
            variant={preferMerge || (huge && n === 0) ? 'outline' : 'default'}
            size="sm"
            disabled={disabled || n === 0 || (!!replacing && n > 1)}
            onClick={() => void runImport('separate')}
            data-testid="picker-separate"
          >
            {busy === 'separate' ? <Spinner aria-hidden /> : null}
            {t('picker.footer.separate', { n: Math.max(1, n) })}
          </Button>
          <Button
            variant={preferMerge ? 'default' : 'outline'}
            size="sm"
            disabled={disabled || !canMerge}
            onClick={() => void runImport('stack')}
            data-testid="picker-merge"
          >
            {busy === 'stack' ? <Spinner aria-hidden /> : null}
            {t('picker.footer.merge')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The sheets of the file (WAI-ARIA tabs, manual activation): another sheet is read when chosen. */
function SheetTabs({
  label,
  sheets,
  current,
  disabled,
  onPick,
}: {
  label: string
  sheets: string[]
  current: string
  disabled: boolean
  onPick: (name: string) => void
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const tabs = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    const at = tabs.indexOf(document.activeElement as HTMLButtonElement)
    if (at < 0) return
    const next =
      e.key === 'ArrowRight'
        ? at + 1
        : e.key === 'ArrowLeft'
          ? at - 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? tabs.length - 1
              : null
    if (next === null) return
    e.preventDefault()
    tabs[(next + tabs.length) % tabs.length]?.focus()
  }
  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-panel px-3 pt-1.5"
    >
      {sheets.map((name) => {
        const on = name === current
        return (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            disabled={disabled && !on}
            onClick={() => !on && onPick(name)}
            className={cn(
              '-mb-px shrink-0 rounded-t-[4px] border border-b-0 px-3 py-1 text-xs whitespace-nowrap transition-colors duration-120 motion-reduce:transition-none',
              'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
              on
                ? 'border-border bg-background font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:bg-panel-sunken hover:text-foreground',
            )}
          >
            {name}
          </button>
        )
      })}
    </div>
  )
}
