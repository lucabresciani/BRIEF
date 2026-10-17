import { Plus, Trash2 } from 'lucide-react'
import type { ColumnId, Dataset, Filter } from '@/domain/model'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { Section } from '@/components/app/Section'
import { Choice } from '@/components/app/Choice'
import { NumberField } from '@/components/app/NumberField'
import { IconButton } from '@/components/app/IconButton'
import { Hint } from '@/components/app/Feedback'
import { useT } from '@/i18n/I18nProvider'
import { useDerived, useNumberLocale } from '@/state/derived'
import { useProjectStore } from '@/state/projectStore'
import { addFilter, removeFilter, resetFilters, updateFilter } from '@/state/actions/analysis'
import { columnLabel, isNumeric } from '@/features/inspector/columnOptions'

/** Non-destructive filters (inclusive bounds): they change the analysed sample, never the data. */
export function FiltersSection({ dataset }: { dataset: Dataset }) {
  const t = useT()
  const filters = useProjectStore((s) => s.doc.filters).filter((f) => f.datasetId === dataset.id)
  const derived = useDerived()
  const view = derived.views.get(dataset.id)
  const firstNumeric = dataset.columns.find((c) => isNumeric(c))
  const firstCategory = dataset.columns.find((c) => !isNumeric(c) && c.role !== 'ignore')
  const sample = firstNumeric ? derived.columnSample(dataset.id, [firstNumeric.id]) : null
  return (
    <Section
      title={t('filter.title')}
      collapsible
      defaultOpen={filters.length > 0}
      actions={
        filters.length ? (
          <Button size="xs" variant="ghost" onClick={() => resetFilters(dataset.id)}>
            {t('filter.resetAll')}
          </Button>
        ) : null
      }
    >
      <Hint>{t('filter.hint')}</Hint>
      {filters.map((f) => (
        <FilterEditor
          key={f.id}
          dataset={dataset}
          filter={f}
          labels={view?.columns.get(f.column)?.categories?.labels ?? []}
        />
      ))}
      <div className="flex flex-wrap gap-1">
        {firstNumeric ? (
          <Button
            size="xs"
            variant="outline"
            className="bg-background"
            onClick={() =>
              addFilter({
                datasetId: dataset.id,
                enabled: true,
                type: 'range',
                column: firstNumeric.id,
                min: null,
                max: null,
              })
            }
          >
            <Plus aria-hidden />
            {t('filter.range')}
          </Button>
        ) : null}
        {firstCategory ? (
          <Button
            size="xs"
            variant="outline"
            className="bg-background"
            onClick={() =>
              addFilter({
                datasetId: dataset.id,
                enabled: true,
                type: 'category',
                column: firstCategory.id,
                keep: [...(view?.columns.get(firstCategory.id)?.categories?.labels ?? [])],
              })
            }
          >
            <Plus aria-hidden />
            {t('filter.category')}
          </Button>
        ) : null}
      </div>
      {sample && sample.counts.filtered > 0 ? (
        <p className="num text-xs text-muted-foreground">
          {t('filter.summary', { n: sample.counts.filtered })}
        </p>
      ) : null}
    </Section>
  )
}

function FilterEditor({ dataset, filter, labels }: { dataset: Dataset; filter: Filter; labels: string[] }) {
  const t = useT()
  const loc = useNumberLocale()
  const cols =
    filter.type === 'range'
      ? dataset.columns.filter((c) => isNumeric(c))
      : dataset.columns.filter((c) => !isNumeric(c) && c.role !== 'ignore')
  // Several filters can be listed: name each control after its column so they are distinguishable.
  const target = dataset.columns.find((c) => c.id === filter.column)
  const named = (label: string) => (target ? `${label}: ${columnLabel(target)}` : label)
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-background p-2">
      <div className="flex items-center gap-2">
        <Switch
          checked={filter.enabled}
          onCheckedChange={(enabled) => updateFilter(filter.id, { enabled })}
          aria-label={named(t('filter.enabled'))}
        />
        <Choice<ColumnId>
          label={t('filter.column')}
          hideLabel
          className="flex-1"
          value={filter.column}
          onChange={(column) =>
            updateFilter(filter.id, filter.type === 'category' ? { column, keep: [] } : { column })
          }
          items={cols.map((c) => ({ value: c.id, label: columnLabel(c) }))}
        />
        <IconButton label={named(t('filter.remove'))} size="icon-xs" onClick={() => removeFilter(filter.id)}>
          <Trash2 aria-hidden />
        </IconButton>
      </div>
      {filter.type === 'range' ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label={t('filter.min')}
              value={filter.min}
              allowEmpty
              decimal={loc.decimal}
              validate={(v) =>
                filter.max !== null && v > filter.max ? t('issues.E_RANGE_INVERTED.title') : null
              }
              onCommit={(min) => updateFilter(filter.id, { min })}
            />
            <NumberField
              label={t('filter.max')}
              value={filter.max}
              allowEmpty
              decimal={loc.decimal}
              validate={(v) =>
                filter.min !== null && v < filter.min ? t('issues.E_RANGE_INVERTED.title') : null
              }
              onCommit={(max) => updateFilter(filter.id, { max })}
            />
          </div>
          <p className="text-xs text-muted-foreground">{t('filter.inclusive')}</p>
        </>
      ) : (
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-xs text-muted-foreground">{t('filter.keep')}</legend>
          {labels.map((l) => (
            <label key={l} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={filter.keep.includes(l)}
                onCheckedChange={(on) =>
                  updateFilter(filter.id, {
                    keep: on ? [...filter.keep, l] : filter.keep.filter((k) => k !== l),
                  })
                }
              />
              {l}
            </label>
          ))}
        </fieldset>
      )}
    </div>
  )
}
