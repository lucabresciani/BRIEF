import type { ReactNode } from 'react'
import { ClipboardPaste, FileUp, NotebookPen, ShieldCheck, ArrowRight } from 'lucide-react'
import { Kbd } from '@/components/ui/kbd'
import { useT } from '@/i18n/I18nProvider'
import { ui } from '@/state/uiStore'
import { DATA_FILE_ACCEPT, pickFile } from '@/platform/files'
import { modKeyLabel } from '@/platform/shortcuts'
import { importFromFile } from '@/features/import/importFlow'
import { ExampleList } from './ExampleList'

/**
 * First screen: four equivalent ways to bring data, plus the examples one click away. It teaches the
 * interface (what each path does) instead of saying "nothing here".
 */
export function EmptyWorkspace() {
  const t = useT()
  const mod = modKeyLabel()
  return (
    <main id="main" className="flex min-h-0 flex-1 overflow-auto bg-background">
      <div className="mx-auto grid w-full max-w-5xl gap-10 px-6 py-10 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] md:py-16 lg:gap-16">
        <section aria-labelledby="start-h" className="flex flex-col gap-6">
          <div>
            <h1 id="start-h" className="text-lg font-semibold text-balance">
              {t('empty.title')}
            </h1>
            <p className="mt-1.5 max-w-[52ch] text-sm text-muted-foreground">{t('empty.lead')}</p>
          </div>
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            <StartOption
              icon={<ClipboardPaste aria-hidden />}
              title={t('empty.paste')}
              hint={t('empty.pasteHint')}
              trailing={
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Kbd>{mod}</Kbd>
                  <Kbd>V</Kbd>
                </span>
              }
              onClick={() => ui.openDialog('paste')}
              primary
            />
            <StartOption
              icon={<FileUp aria-hidden />}
              title={t('empty.file')}
              hint={t('empty.fileHint')}
              onClick={async () => {
                const f = await pickFile(DATA_FILE_ACCEPT)
                if (f) void importFromFile(t, f)
              }}
            />
            <StartOption
              icon={<NotebookPen aria-hidden />}
              title={t('empty.notebook')}
              hint={t('empty.notebookHint')}
              onClick={() => ui.openDialog('notebook')}
            />
          </ul>
          <p className="text-xs text-muted-foreground">{t('empty.drop')}</p>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5 text-success" aria-hidden />
            {t('app.privacy')}
          </p>
        </section>

        <section aria-labelledby="examples-h" className="flex flex-col gap-3">
          <div>
            <h2 id="examples-h" className="text-sm font-semibold">
              {t('empty.example')}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">{t('examples.lead')}</p>
          </div>
          <ExampleList />
        </section>
      </div>
    </main>
  )
}

function StartOption({
  icon,
  title,
  hint,
  trailing,
  onClick,
  primary = false,
}: {
  icon: ReactNode
  title: string
  hint: string
  trailing?: ReactNode
  onClick: () => void
  primary?: boolean
}) {
  return (
    <li className="group/option">
      <button
        type="button"
        onClick={onClick}
        className="group flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors duration-(--dur-press) group-first/option:rounded-t-lg group-last/option:rounded-b-lg hover:bg-accent focus-visible:relative"
      >
        <span
          className={
            primary
              ? 'flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground [&_svg]:size-4'
              : 'flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-panel text-foreground [&_svg]:size-4'
          }
        >
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{title}</span>
          <span className="block text-xs text-muted-foreground">{hint}</span>
        </span>
        {trailing ?? (
          <ArrowRight
            className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
            aria-hidden
          />
        )}
      </button>
    </li>
  )
}
