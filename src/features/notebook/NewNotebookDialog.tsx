import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { IconButton } from '@/components/app/IconButton'
import { useI18n } from '@/i18n/I18nProvider'
import { ui, useUiStore } from '@/state/uiStore'
import { createNotebook } from '@/state/actions/notebook'

interface Quantity {
  key: number
  name: string
  unit: string
}

/** Declare the measured quantities (name + unit); the notebook then plots while you type. */
export function NewNotebookDialog() {
  const { t, lang } = useI18n()
  const open = useUiStore((s) => s.dialog === 'notebook')
  const [name, setName] = useState('')
  const [qs, setQs] = useState<Quantity[]>([
    { key: 1, name: '', unit: '' },
    { key: 2, name: '', unit: '' },
  ])
  const [error, setError] = useState<string | null>(null)
  const nextKey = Math.max(0, ...qs.map((q) => q.key)) + 1

  const create = () => {
    const cols = qs.map((q, i) => ({
      name:
        q.name.trim() ||
        (i === 0
          ? t('notebook.defaultX')
          : i === 1
            ? t('notebook.defaultY')
            : `${t('common.column')} ${i + 1}`),
      unit: q.unit.trim() || null,
    }))
    const names = cols.map((c) => c.name)
    if (new Set(names).size !== names.length) {
      setError(t('issues.E_DUPLICATE_COLUMN_NAME.title'))
      return
    }
    createNotebook(name.trim() || t('notebook.defaultName'), cols, lang === 'it' ? 'comma' : 'dot')
    ui.set({ dialog: null, tableOpen: true })
    setName('')
    setQs([
      { key: 1, name: '', unit: '' },
      { key: 2, name: '', unit: '' },
    ])
    setError(null)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && ui.closeDialog()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('notebook.newTitle')}</DialogTitle>
          <DialogDescription>{t('notebook.lead')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1">
          <label htmlFor="nb-name" className="text-xs text-muted-foreground">
            {t('notebook.datasetName')}
          </label>
          <Input
            id="nb-name"
            autoComplete="off"
            value={name}
            placeholder={t('notebook.defaultName')}
            onChange={(e) => setName(e.target.value)}
            className="h-8 bg-background"
          />
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-xs text-muted-foreground">{t('notebook.columnsLabel')}</legend>
          {qs.map((q, i) => (
            <div key={q.key} className="grid grid-cols-[1fr_7rem_2rem] items-end gap-2">
              <div className="flex flex-col gap-1">
                <label htmlFor={`nb-q-${q.key}`} className="sr-only">
                  {t('common.name')} {i + 1}
                </label>
                <Input
                  id={`nb-q-${q.key}`}
                  autoComplete="off"
                  value={q.name}
                  placeholder={i === 0 ? 't' : i === 1 ? 'x' : ''}
                  onChange={(e) =>
                    setQs(qs.map((x) => (x.key === q.key ? { ...x, name: e.target.value } : x)))
                  }
                  className="h-8 bg-background"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor={`nb-u-${q.key}`} className="sr-only">
                  {t('common.unit')} {i + 1}
                </label>
                <Input
                  id={`nb-u-${q.key}`}
                  autoComplete="off"
                  spellCheck={false}
                  value={q.unit}
                  placeholder={i === 0 ? 's' : i === 1 ? 'm' : t('common.unit')}
                  onChange={(e) =>
                    setQs(qs.map((x) => (x.key === q.key ? { ...x, unit: e.target.value } : x)))
                  }
                  className="h-8 bg-background"
                />
              </div>
              <IconButton
                label={`${t('notebook.removeColumn')} ${i + 1}`}
                disabled={qs.length <= 1}
                onClick={() => setQs(qs.filter((x) => x.key !== q.key))}
              >
                <Trash2 aria-hidden />
              </IconButton>
            </div>
          ))}
          <Button
            size="sm"
            variant="ghost"
            className="self-start"
            onClick={() => setQs([...qs, { key: nextKey, name: '', unit: '' }])}
          >
            <Plus aria-hidden />
            {t('notebook.addColumn')}
          </Button>
        </fieldset>
        {error ? (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => ui.closeDialog()}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" onClick={create}>
            {t('notebook.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
