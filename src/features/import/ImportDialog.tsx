import { ArrowLeft, Table2 } from 'lucide-react'
import { columnLetters } from '@/domain/derive/recordPosition'
import type { ColumnKind, ColumnMeta, ColumnRole, DecimalMode, Delimiter, TextEncoding } from '@/domain/model'
import { effectiveSettings } from '@/domain/model'
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
import { Choice } from '@/components/app/Choice'
import { IssueList } from '@/components/app/Feedback'
import { SwitchRow } from '@/components/app/SwitchRow'
import { Section } from '@/components/app/Section'
import { useT } from '@/i18n/I18nProvider'
import { useUiStore } from '@/state/uiStore'
import { LIMITS } from '@/domain/import/limits'
import { isSpreadsheetKind } from '@/domain/import/sniff'
import {
  backToPicker,
  cancelImport,
  confirmImport,
  needsPicker,
  reinterpret,
  useImportStore,
} from './importFlow'
import { useDraftPreview } from './draftPreview'
import { PreviewTable } from './PreviewTable'

const DELIMS: { value: Delimiter; key: 'tab' | 'semicolon' | 'comma' | 'pipe' | 'none' }[] = [
  { value: '\t', key: 'tab' },
  { value: ';', key: 'semicolon' },
  { value: ',', key: 'comma' },
  { value: '|', key: 'pipe' },
  { value: 'none', key: 'none' },
]
const DELIM_SAFE: Record<Delimiter, string> = {
  '\t': 'tab',
  ';': 'semicolon',
  ',': 'comma',
  '|': 'pipe',
  none: 'none',
}
const FROM_SAFE: Record<string, Delimiter> = {
  tab: '\t',
  semicolon: ';',
  comma: ',',
  pipe: '|',
  none: 'none',
}

/**
 * Blocking preview used only when the importer is unsure (or when the user asks to review). A table cut
 * out of a sheet by the picker shows its block: its header row is a row (or, transposed, a column) of
 * that block, and changing it re-cuts the block only; a merged dataset has a built header, so only its
 * columns can be adjusted.
 */
export function ImportDialog() {
  const t = useT()
  const open = useUiStore((s) => s.dialog === 'import')
  const { draft, loading, error, source, overrides, replacing, regionSpec, sheetDraft } = useImportStore()
  const preview = useDraftPreview(draft)

  const updateColumn = (id: string, patch: Partial<ColumnMeta>) => {
    const d = useImportStore.getState().draft
    if (!d) return
    useImportStore.setState({
      draft: { ...d, columns: d.columns.map((c) => (c.id === id ? { ...c, ...patch } : c)) },
    })
  }

  const hasError = !!error || (draft?.issues.some((i) => i.severity === 'error') ?? false)
  // A transposed block: its grid rows are sheet columns (sourceRow holds their numbers).
  const columnsAxis = draft?.rawTable.source.region?.orientation === 'rows'
  const rowOptions = draft
    ? Array.from({ length: Math.min(draft.rawTable.rowCount, 15) }, (_, i) => {
        const n = draft.rawTable.sourceRow[i]!
        return {
          value: String(i),
          label: columnsAxis
            ? t('table.record', { axis: 'column', pos: columnLetters(n) })
            : t('table.record', { axis: 'row', pos: n }),
        }
      })
    : []
  const stacked = regionSpec?.mode === 'stack'
  const region = regionSpec?.mode === 'separate' ? regionSpec.regions[0] : undefined
  const canPick = regionSpec ? !!sheetDraft : !!draft && needsPicker(draft)
  const isText = source?.kind === 'text' || !isSpreadsheetKind(draft?.rawTable.source.kind)
  const n = preview?.view.rowIds.length ?? 0
  const shown = Math.min(n, LIMITS.previewRows)
  const quotesProblem =
    draft?.issues.some((i) => i.code === 'E_QUOTES_UNCLOSED') || error?.code === 'E_QUOTES_UNCLOSED'

  return (
    <Dialog open={open} onOpenChange={(o) => !o && cancelImport()}>
      <DialogContent className="flex max-h-[min(92dvh,56rem)] flex-col gap-0 p-0 sm:max-w-5xl">
        <DialogHeader className="border-b border-border p-4">
          <DialogTitle>{t('import.title')}</DialogTitle>
          <DialogDescription>
            {regionSpec && region
              ? t('import.fromRegion', { range: region.range, sheet: regionSpec.sheetName })
              : regionSpec
                ? t('import.fromStack', { count: regionSpec.regions.length, sheet: regionSpec.sheetName })
                : null}{' '}
            {t('import.lead')}
          </DialogDescription>
        </DialogHeader>
        {!draft ? (
          <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground" role="status">
            <Spinner aria-hidden /> {t('import.reading')}
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[17rem_minmax(0,1fr)]">
            <div className="min-h-0 overflow-auto overscroll-contain border-b border-border bg-panel md:border-r md:border-b-0">
              <Section title={t('import.preview')}>
                {isText && draft.detection.delimiter ? (
                  <Choice<string>
                    label={t('import.delimiter')}
                    value={DELIM_SAFE[overrides.delimiter ?? draft.detection.delimiter]}
                    onChange={(v) => void reinterpret({ delimiter: FROM_SAFE[v] })}
                    items={DELIMS.map((d) => ({
                      value: DELIM_SAFE[d.value],
                      label: t(`import.delimiters.${d.key}`),
                    }))}
                  />
                ) : null}
                {draft.detection.encoding ? (
                  <Choice<TextEncoding>
                    label={t('import.encoding')}
                    value={overrides.encoding ?? draft.detection.encoding}
                    onChange={(encoding) => void reinterpret({ encoding })}
                    items={(['utf-8', 'windows-1252', 'utf-16le', 'utf-16be'] as const).map((e) => ({
                      value: e,
                      label: e.toUpperCase(),
                    }))}
                  />
                ) : null}
                {!regionSpec && draft.detection.sheets && draft.detection.sheets.length > 1 ? (
                  <Choice<string>
                    label={t('import.sheet')}
                    value={draft.detection.sheetName}
                    onChange={(sheetName) => void reinterpret({ sheetName })}
                    items={draft.detection.sheets.map((s) => ({ value: s.name, label: s.name }))}
                  />
                ) : null}
                {stacked ? null : (
                  <>
                    <Choice<string>
                      label={columnsAxis ? t('import.headerColumn') : t('import.headerRow')}
                      value={draft.layout.headerRow === null ? 'none' : String(draft.layout.headerRow)}
                      onChange={(v) =>
                        void reinterpret({
                          headerRow: v === 'none' ? null : Number(v),
                          dataStartRow: undefined,
                        })
                      }
                      items={[{ value: 'none', label: t('import.noHeader') }, ...rowOptions]}
                    />
                    <Choice<string>
                      label={columnsAxis ? t('import.unitsColumn') : t('import.unitsRow')}
                      value={draft.layout.unitsRow === null ? 'none' : String(draft.layout.unitsRow)}
                      onChange={(v) => void reinterpret({ unitsRow: v === 'none' ? null : Number(v) })}
                      items={[{ value: 'none', label: t('import.noUnitsRow') }, ...rowOptions]}
                    />
                    <Choice<string>
                      label={columnsAxis ? t('import.dataStartColumn') : t('import.dataStart')}
                      value={String(draft.layout.dataStartRow)}
                      onChange={(v) => void reinterpret({ dataStartRow: Number(v) })}
                      items={rowOptions}
                    />
                  </>
                )}
                {quotesProblem ? (
                  <SwitchRow
                    label={t('import.ignoreQuotes')}
                    checked={!!overrides.ignoreQuotes}
                    onChange={(ignoreQuotes) => void reinterpret({ ignoreQuotes })}
                  />
                ) : null}
              </Section>
              <Section title={t('import.issues')}>
                <IssueList
                  issues={[...(error ? [error] : []), ...draft.issues]}
                  empty={<p className="text-xs text-muted-foreground">{t('import.noIssues')}</p>}
                />
              </Section>
            </div>
            <div className="flex min-h-0 flex-col overflow-hidden">
              <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
                {preview ? (
                  <PreviewTable
                    draft={draft}
                    view={preview.view}
                    rows={shown}
                    label={t('import.preview')}
                    header={(c) => <ColumnHeader column={c} onChange={(p) => updateColumn(c.id, p)} />}
                  />
                ) : null}
              </div>
              <p className="num border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
                {t('import.previewRows', { n: shown, total: n })}
              </p>
            </div>
          </div>
        )}
        <DialogFooter className="border-t border-border p-3">
          <Button variant="outline" size="sm" onClick={() => cancelImport()}>
            {loading ? t('import.cancelImport') : t('common.cancel')}
          </Button>
          {canPick ? (
            <Button variant="outline" size="sm" disabled={loading} onClick={() => backToPicker()}>
              {regionSpec ? <ArrowLeft aria-hidden /> : <Table2 aria-hidden />}
              {t('import.chooseTables')}
            </Button>
          ) : null}
          <Button
            size="sm"
            disabled={!draft || hasError || loading}
            onClick={() => confirmImport(t)}
            data-testid="confirm-import"
          >
            {loading ? <Spinner aria-hidden /> : null}
            {replacing ? t('common.apply') : t('import.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ColumnHeader({
  column,
  onChange,
}: {
  column: ColumnMeta
  onChange: (p: Partial<ColumnMeta>) => void
}) {
  const t = useT()
  const s = effectiveSettings(column)
  return (
    <div className="flex max-w-56 min-w-32 flex-col gap-1">
      <span className="truncate text-xs font-semibold" title={column.name}>
        {column.name}
        {column.unit ? <span className="ml-1 font-normal text-muted-foreground">({column.unit})</span> : null}
      </span>
      <Choice<ColumnKind>
        label={`${t('import.columnKind')} (${column.name})`}
        hideLabel
        value={s.kind}
        onChange={(kind) => onChange({ override: { ...column.override, kind } })}
        items={(['numeric', 'categorical', 'datetime', 'text'] as const).map((k) => ({
          value: k,
          label: t(`import.kinds.${k}`),
        }))}
      />
      {s.kind === 'numeric' ? (
        <Choice<DecimalMode>
          label={`${t('import.decimal')} (${column.name})`}
          hideLabel
          value={s.decimal}
          onChange={(decimal) => onChange({ override: { ...column.override, decimal } })}
          items={(['dot', 'comma', 'mixed'] as const).map((d) => ({
            value: d,
            label: t(`import.decimals.${d}`),
          }))}
        />
      ) : null}
      <Choice<ColumnRole>
        label={`${t('import.role')} (${column.name})`}
        hideLabel
        value={column.role}
        onChange={(role) => onChange({ role })}
        items={(['measurement', 'uncertainty', 'group', 'identifier', 'ignore'] as const).map((r) => ({
          value: r,
          label: t(`import.roles.${r}`),
        }))}
      />
      {column.detected.confidence === 'low' ? (
        <span className="text-2xs font-normal text-warning">{t('import.checkColumn')}</span>
      ) : null}
    </div>
  )
}
