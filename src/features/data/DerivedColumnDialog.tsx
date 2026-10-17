import { useState } from 'react'
import type { Draft } from 'immer'
import { wouldCreateCycle } from '@/domain/model/integrity'
import { newId, type ColumnId, type ColumnMeta, type DatasetId, type TransformSpec } from '@/domain/model'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Choice } from '@/components/app/Choice'
import { NumberField } from '@/components/app/NumberField'
import { TextField } from '@/components/app/TextField'
import { Hint } from '@/components/app/Feedback'
import { useT } from '@/i18n/I18nProvider'
import { useDerived, useNumberLocale } from '@/state/derived'
import { ui, useUiStore } from '@/state/uiStore'
import { commit } from '@/state/projectStore'
import { isNumeric, columnLabel } from '@/features/inspector/columnOptions'
import { formatPlain } from '@/lib/numberInput'
import { plotDatasetIds } from '@/features/plot/plotLabels'

type Op = TransformSpec['op']
const UNARY: Op[] = ['ln', 'log10', 'sqrt', 'reciprocal', 'square', 'affine']
const BINARY: Op[] = ['difference', 'ratio', 'product']

function addDerivedColumn(datasetId: DatasetId, spec: TransformSpec, name: string, unit: string | null) {
  const column: ColumnMeta = {
    id: newId<'ColumnId'>('col') as ColumnId,
    source: { type: 'derived', spec },
    name,
    unit,
    unitSource: unit ? 'user' : null,
    role: 'measurement',
    uncertaintyOf: null,
    detected: { kind: 'numeric', decimal: 'dot', percent: 'display', confidence: 'high', explanations: [] },
    override: {},
  }
  commit(
    'column.derive',
    (d) => {
      d.datasets.find((x) => x.id === datasetId)?.columns.push(column as Draft<ColumnMeta>)
    },
    { datasetId, params: { name } },
  )
}

/** Non-destructive transformation: a new column computed from existing ones. */
export function DerivedColumnDialog() {
  const t = useT()
  const loc = useNumberLocale()
  const open = useUiStore((s) => s.dialog === 'derived')
  const selection = useUiStore((s) => s.selection)
  const derived = useDerived()
  const dataset =
    derived.doc.datasets.find((d) => d.id === selection?.datasetId) ??
    derived.doc.datasets.find((d) => d.id === plotDatasetIds(derived.plot)[0]) ??
    derived.doc.datasets[0]
  const numeric = dataset ? dataset.columns.filter(isNumeric) : []
  const [op, setOp] = useState<Op>('ln')
  const [input, setInput] = useState<ColumnId | null>(null)
  const [right, setRight] = useState<ColumnId | null>(null)
  const [a, setA] = useState(1)
  const [b, setB] = useState(0)
  const [name, setName] = useState('')
  const [unit, setUnit] = useState('')
  if (!dataset) return null
  const left = input ?? numeric[0]?.id ?? null
  const rightId = right ?? numeric[1]?.id ?? numeric[0]?.id ?? null
  const leftName = numeric.find((c) => c.id === left)?.name ?? 'x'
  const rightName = numeric.find((c) => c.id === rightId)?.name ?? 'x₂'
  const spec: TransformSpec | null = !left
    ? null
    : BINARY.includes(op)
      ? rightId
        ? { op: op as 'difference' | 'ratio' | 'product', left, right: rightId }
        : null
      : op === 'affine'
        ? { op: 'affine', input: left, a, b }
        : { op: op as 'ln' | 'log10' | 'sqrt' | 'reciprocal' | 'square', input: left }
  const suggested =
    op === 'ln'
      ? `ln(${leftName})`
      : op === 'log10'
        ? `log10(${leftName})`
        : op === 'sqrt'
          ? `√${leftName}`
          : op === 'reciprocal'
            ? `1/${leftName}`
            : op === 'square'
              ? `${leftName}²`
              : op === 'affine'
                ? `${formatPlain(a, loc.decimal)}·${leftName} + ${formatPlain(b, loc.decimal)}`
                : op === 'difference'
                  ? `${leftName} − ${rightName}`
                  : op === 'ratio'
                    ? `${leftName}/${rightName}`
                    : `${leftName}·${rightName}`
  const finalName = name.trim() || suggested
  const duplicate = dataset.columns.some((c) => c.name === finalName)
  const cycle = spec ? wouldCreateCycle(dataset, '' as ColumnId, spec) : false
  return (
    <Dialog open={open} onOpenChange={(o) => !o && ui.closeDialog()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('derived.title')}</DialogTitle>
          <DialogDescription>{t('derived.lead')}</DialogDescription>
        </DialogHeader>
        <Choice<Op>
          label={t('derived.operation')}
          value={op}
          onChange={setOp}
          items={[...UNARY, ...BINARY].map((o) => ({ value: o, label: t(`derived.ops.${o}`) }))}
        />
        <div className="grid grid-cols-2 gap-2">
          <Choice<ColumnId>
            label={BINARY.includes(op) ? t('derived.left') : t('derived.input')}
            value={left}
            onChange={setInput}
            items={numeric.map((c) => ({ value: c.id, label: columnLabel(c) }))}
          />
          {BINARY.includes(op) ? (
            <Choice<ColumnId>
              label={t('derived.right')}
              value={rightId}
              onChange={setRight}
              items={numeric.map((c) => ({ value: c.id, label: columnLabel(c) }))}
            />
          ) : null}
        </div>
        {op === 'affine' ? (
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label={t('derived.a')}
              value={a}
              decimal={loc.decimal}
              onCommit={(v) => v !== null && setA(v)}
            />
            <NumberField
              label={t('derived.b')}
              value={b}
              decimal={loc.decimal}
              onCommit={(v) => v !== null && setB(v)}
            />
          </div>
        ) : null}
        <div className="grid grid-cols-[1fr_6rem] gap-2">
          <TextField label={t('derived.name')} value={name} placeholder={suggested} onCommit={setName} />
          <TextField label={t('derived.unit')} value={unit} onCommit={setUnit} />
        </div>
        {numeric.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('derived.noNumeric')}</p>
        ) : null}
        {duplicate ? (
          <p className="text-xs text-destructive" role="alert">
            {t('issues.E_DUPLICATE_COLUMN_NAME.title')}
          </p>
        ) : null}
        {cycle ? (
          <p className="text-xs text-destructive" role="alert">
            {t('derived.cycle')}
          </p>
        ) : null}
        <Hint>{t('derived.noUncertainty')}</Hint>
        <DialogFooter>
          <Button size="sm" variant="outline" onClick={() => ui.closeDialog()}>
            {t('common.cancel')}
          </Button>
          <Button
            size="sm"
            disabled={!spec || duplicate || cycle}
            onClick={() => {
              if (!spec) return
              addDerivedColumn(dataset.id, spec, finalName, unit.trim() || null)
              setName('')
              setUnit('')
              ui.closeDialog()
            }}
          >
            {t('derived.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
