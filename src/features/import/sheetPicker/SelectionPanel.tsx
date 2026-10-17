import { useId } from 'react'
import { Columns3, Combine, Rows3, TriangleAlert, X } from 'lucide-react'
import type { LabelCandidate } from '@/domain/import/stack'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Choice } from '@/components/app/Choice'
import { TextField } from '@/components/app/TextField'
import { useT } from '@/i18n/I18nProvider'
import { cn } from '@/lib/utils'
import {
  headerOptions,
  labelChoice,
  type ItemInfo,
  type ItemSettings,
  type LabelChoice,
  type MergeProposal as Proposal,
  type Orientation,
  type PickerSheet,
  type PickerState,
} from './pickerState'

const label = (i: ItemInfo) => (i.number !== null ? `${i.number} · ${i.name}` : `${i.name}`)

/**
 * How the selected table is read: its name, whether its variables are in columns or in rows (detection
 * can be unsure, so the switch is one click away and the detected reading is marked), and its header row.
 * With several tables selected, a chooser says which one is being set.
 */
export function SelectionPanel({
  sheet,
  infos,
  active,
  onActive,
  onSettings,
  onRemove,
  onJoin,
}: {
  sheet: PickerSheet
  infos: readonly ItemInfo[]
  active: ItemInfo | null
  onActive: (key: string) => void
  onSettings: (key: string, patch: ItemSettings) => void
  onRemove: (key: string) => void
  /** Replace a block and the neighbour it seems to belong to by their joined range. */
  onJoin: (range: ItemInfo['item']['range'], keys: string[]) => void
}) {
  const t = useT()
  const orientId = useId()
  if (!active)
    return <p className="px-3 text-xs leading-relaxed text-muted-foreground">{t('picker.selection.none')}</p>
  const key = active.item.key
  const rows = active.orientation === 'rows'
  const options = headerOptions(sheet, active)
  const hint = active.block?.hints[0]
  const partner = hint ? sheet.blocks.findIndex((b) => b.id === hint.with) : -1
  return (
    <div className="flex flex-col gap-3 px-3" data-testid="selection-panel">
      {infos.length > 1 ? (
        <Choice<string>
          label={t('picker.selection.settingsOf')}
          value={key}
          onChange={onActive}
          items={infos.map((i) => ({ value: i.item.key, label: `${label(i)} (${i.a1})` }))}
        />
      ) : (
        <p className="flex min-w-0 items-baseline gap-2 text-xs">
          <span className="truncate font-medium">{label(active)}</span>
          <span className="shrink-0 font-mono text-2xs text-muted-foreground" translate="no">
            {active.a1}
          </span>
        </p>
      )}
      <TextField
        key={key}
        label={t('picker.selection.name')}
        value={active.name === active.defaultName ? '' : active.name}
        placeholder={active.defaultName}
        onCommit={(name) => onSettings(key, { name })}
      />
      <div className="flex flex-col gap-1">
        <span id={orientId} className="text-xs text-muted-foreground">
          {t('picker.selection.orientation')}
        </span>
        <ToggleGroup
          aria-labelledby={orientId}
          value={[active.orientation]}
          onValueChange={(v) => {
            const next = v[0] as Orientation | undefined
            if (next && next !== active.orientation) onSettings(key, { orientation: next })
          }}
          variant="outline"
          size="sm"
          spacing={0}
          className="w-full"
          data-testid="orientation"
        >
          {(['columns', 'rows'] as const).map((o) => (
            <ToggleGroupItem key={o} value={o} className="flex-1 gap-1.5" data-orientation-option={o}>
              {o === 'columns' ? <Columns3 aria-hidden /> : <Rows3 aria-hidden />}
              {t(`picker.selection.${o}`)}
              {active.detected === o ? (
                <span className="rounded-[3px] bg-panel-sunken px-1 text-2xs font-normal text-muted-foreground">
                  {t('picker.selection.detected')}
                </span>
              ) : null}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {active.confidence === 'low' ? (
          <p className="flex items-start gap-1 text-xs text-warning">
            <TriangleAlert aria-hidden className="mt-0.5 size-3 shrink-0" />
            {t('picker.selection.ambiguous')}
          </p>
        ) : null}
      </div>
      <Choice<string>
        label={rows ? t('picker.selection.headerColumn') : t('picker.selection.headerRow')}
        value={
          active.headerRow === undefined
            ? 'auto'
            : active.headerRow === null
              ? 'none'
              : String(active.headerRow)
        }
        onChange={(v) =>
          onSettings(key, { headerRow: v === 'auto' ? undefined : v === 'none' ? null : Number(v) })
        }
        items={[
          { value: 'auto', label: t('picker.selection.auto') },
          { value: 'none', label: t('picker.selection.noHeader') },
          ...options.map((o) => ({
            value: String(o.index),
            label: `${t('table.record', { axis: o.axis, pos: o.pos })}${o.preview ? ` · ${o.preview}` : ''}`,
          })),
        ]}
      />
      {hint && partner >= 0 ? (
        <div className="flex flex-col items-start gap-1.5 rounded-[4px] border border-dotted border-warning px-2 py-1.5 text-xs">
          <p>{t('picker.selection.joinHint', { n: partner + 1 })}</p>
          <Button
            variant="outline"
            size="xs"
            className="bg-background"
            onClick={() => onJoin(hint.range, [key, hint.with])}
          >
            {t('picker.selection.join', { range: hint.a1 })}
          </Button>
        </div>
      ) : null}
      <Button
        variant="ghost"
        size="xs"
        className="self-start text-muted-foreground"
        onClick={() => onRemove(key)}
      >
        <X aria-hidden />
        {t('picker.selection.remove')}
      </Button>
    </div>
  )
}

/**
 * "6 tables share the columns position, Width mm, Depth mm, area: merge them into one dataset?", with
 * the label columns that will tell the tables apart (titles or parameters that vary, else the block name):
 * each can be left out, renamed and read as text or number.
 */
export function MergeProposal({
  proposal,
  total,
  candidates,
  state,
  onLabel,
  onKeepOnly,
}: {
  proposal: Proposal
  total: number
  candidates: readonly LabelCandidate[]
  state: PickerState
  onLabel: (c: LabelCandidate, patch: Partial<LabelChoice>) => void
  onKeepOnly: (keys: string[]) => void
}) {
  const t = useT()
  const columns = proposal.columns.slice(0, 6).join(', ') + (proposal.columns.length > 6 ? ', …' : '')
  const chosen = candidates.filter((c) => labelChoice(state, c).on).length
  return (
    <section
      aria-labelledby="merge-title"
      data-testid="merge-proposal"
      className="mx-3 flex flex-col gap-2.5 rounded-md border border-primary/40 bg-selection/50 p-2.5"
    >
      <h3 id="merge-title" className="flex items-start gap-1.5 text-xs leading-snug font-medium text-pretty">
        <Combine aria-hidden className="mt-0.5 size-3.5 shrink-0 text-primary" strokeWidth={1.75} />
        {proposal.all
          ? t('picker.merge.title', { count: proposal.keys.length, columns })
          : t('picker.merge.partial', { count: proposal.keys.length, total, columns })}
      </h3>
      {!proposal.all ? (
        <Button
          variant="outline"
          size="xs"
          className="self-start bg-background"
          onClick={() => onKeepOnly(proposal.keys)}
        >
          {t('picker.merge.keepOnly', { count: proposal.keys.length })}
        </Button>
      ) : null}
      {proposal.mixed ? (
        <p className="flex items-start gap-1 text-xs text-warning">
          <TriangleAlert aria-hidden className="mt-0.5 size-3 shrink-0" />
          {t('picker.merge.mixed')}
        </p>
      ) : null}
      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="mb-1 text-xs text-muted-foreground">
          {t('picker.merge.labels')}: {t('picker.merge.labelsHint')}
        </legend>
        {candidates.map((c) => {
          const choice = labelChoice(state, c)
          const name = choice.name || c.name
          return (
            <div key={JSON.stringify(c.source)} className="flex flex-col gap-1" data-label-candidate={c.name}>
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={choice.on}
                  onCheckedChange={(on) => onLabel(c, { on: on === true })}
                  aria-label={t('picker.merge.use', { name })}
                />
                <Input
                  name="label-name"
                  autoComplete="off"
                  value={choice.name}
                  onChange={(e) => onLabel(c, { name: e.target.value })}
                  aria-label={t('picker.merge.labelName')}
                  disabled={!choice.on}
                  className="h-7 min-w-0 flex-1 bg-background text-sm"
                />
                <Choice<LabelChoice['kind']>
                  label={t('picker.merge.kind', { name })}
                  hideLabel
                  value={choice.kind}
                  onChange={(kind) => onLabel(c, { kind })}
                  disabled={!choice.on}
                  className="w-28 shrink-0"
                  items={(['auto', 'text', 'number'] as const).map((k) => ({
                    value: k,
                    label: t(`picker.merge.kinds.${k}`),
                  }))}
                />
              </div>
              <p className={cn('truncate pl-6 text-2xs text-muted-foreground', !choice.on && 'opacity-60')}>
                {t('picker.merge.values', {
                  values:
                    [...new Set(c.values)].slice(0, 6).join(', ') + (new Set(c.values).size > 6 ? ', …' : ''),
                })}
              </p>
            </div>
          )
        })}
        {chosen === 0 ? <p className="text-xs text-muted-foreground">{t('picker.merge.noLabels')}</p> : null}
      </fieldset>
    </section>
  )
}
