import type { ColumnId, ColumnKind, ColumnMeta, ColumnRole, Dataset, DecimalMode } from '@/domain/model'
import { effectiveSettings } from '@/domain/model'
import type { ParseReport } from '@/domain/derive/types'
import { Choice } from '@/components/app/Choice'
import { TextField } from '@/components/app/TextField'
import { Hint, IssueList } from '@/components/app/Feedback'
import { useT } from '@/i18n/I18nProvider'
import { setColumnParse, updateColumn } from '@/state/actions/dataset'

const KINDS: ColumnKind[] = ['numeric', 'categorical', 'datetime', 'text']
const ROLES: ColumnRole[] = ['measurement', 'uncertainty', 'group', 'identifier', 'ignore']
const DECIMALS: DecimalMode[] = ['dot', 'comma', 'mixed']

/** Name, unit, role and how the column is read. Every change is undoable; raw data never changes. */
export function ColumnEditor({
  dataset,
  column,
  report,
}: {
  dataset: Dataset
  column: ColumnMeta
  report?: ParseReport
}) {
  const t = useT()
  const s = effectiveSettings(column)
  const others = dataset.columns.filter((c) => c.id !== column.id)
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-semibold">{t('data.editColumn')}</p>
      <div className="grid grid-cols-[1fr_6rem] gap-2">
        <TextField
          label={t('data.columnName')}
          value={column.name}
          validate={(v) =>
            !v
              ? t('issues.E_EMPTY_NAME.title')
              : others.some((c) => c.name === v)
                ? t('issues.E_DUPLICATE_COLUMN_NAME.title')
                : null
          }
          onCommit={(name) => updateColumn(dataset.id, column.id, { name })}
        />
        <TextField
          label={t('data.columnUnit')}
          value={column.unit ?? ''}
          onCommit={(u) => updateColumn(dataset.id, column.id, { unit: u || null })}
        />
      </div>
      {/* Imported cells are checked against the unit read from the file, not this label (datasetView);
          typed notebook cells are checked against the label, so the note would be false there. */}
      {column.source.type === 'raw' ? <Hint>{t('data.unitLabelOnly')}</Hint> : null}
      <Choice<ColumnRole>
        label={t('data.columnRole')}
        value={column.role}
        onChange={(role) => updateColumn(dataset.id, column.id, { role })}
        items={ROLES.map((r) => ({ value: r, label: t(`import.roles.${r}`) }))}
      />
      {column.role === 'uncertainty' ? (
        <Choice<ColumnId | '__none__'>
          label={t('data.uncertaintyOf')}
          value={column.uncertaintyOf ?? '__none__'}
          onChange={(v) =>
            updateColumn(dataset.id, column.id, { uncertaintyOf: v === '__none__' ? null : (v as ColumnId) })
          }
          items={[
            { value: '__none__' as const, label: t('common.none') },
            // Uncertainty is not propagated to a derived column (the pipeline refuses it: E_DERIVED_UNCERTAINTY).
            ...others.map((c) =>
              c.source.type === 'derived'
                ? { value: c.id, label: c.name, disabled: true, hint: t('derived.noUncertainty') }
                : { value: c.id, label: c.name },
            ),
          ]}
        />
      ) : null}
      {column.source.type !== 'derived' ? (
        <div className="grid grid-cols-2 gap-2">
          <Choice<ColumnKind>
            label={t('import.columnKind')}
            value={s.kind}
            onChange={(kind) => setColumnParse(dataset.id, column.id, { kind })}
            items={KINDS.map((k) => ({ value: k, label: t(`import.kinds.${k}`) }))}
          />
          {s.kind === 'numeric' ? (
            <Choice<DecimalMode>
              label={t('import.decimal')}
              value={s.decimal}
              onChange={(decimal) => setColumnParse(dataset.id, column.id, { decimal })}
              items={DECIMALS.map((d) => ({ value: d, label: t(`import.decimals.${d}`) }))}
            />
          ) : null}
        </div>
      ) : null}
      {report ? (
        <p className="num text-xs text-muted-foreground">
          {t('data.validValues', { n: report.nValid })},{' '}
          {t('data.missingValues', { n: report.nMissing + report.nSheetError })},{' '}
          {t('data.invalidValues', { n: report.nInvalid })}
        </p>
      ) : null}
      <IssueList issues={column.detected.explanations} compact />
    </div>
  )
}
