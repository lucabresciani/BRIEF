import { useRef, useState } from 'react'
import {
  BookOpenText,
  ChevronDown,
  ClipboardPaste,
  FileUp,
  FlaskConical,
  FolderOpen,
  HelpCircle,
  History,
  Download,
  Redo2,
  Save,
  Settings,
  Undo2,
  FilePlus2,
  NotebookPen,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { IconButton } from '@/components/app/IconButton'
import { Logo } from '@/components/app/Logo'
import { Choice } from '@/components/app/Choice'
import { useI18n } from '@/i18n/I18nProvider'
import { useProjectStore, undo, redo } from '@/state/projectStore'
import { ui, useUiStore, type Level } from '@/state/uiStore'
import { renameProject, newProject } from '@/state/actions/project'
import { DATA_FILE_ACCEPT, PROJECT_FILE_ACCEPT, pickFile } from '@/platform/files'
import { redoShortcutLabel, shortcutLabel, undoShortcutLabel } from '@/platform/shortcuts'
import { importFromFile, openProjectFile } from '@/features/import/importFlow'
import { saveProjectFile } from '@/features/project/projectFile'
import { confirmAction } from '@/components/app/confirmStore'
import { SaveStatus } from './SaveStatus'
import { CompactMenu } from './CompactMenu'

export function TopBar() {
  const { t, lang, setLang } = useI18n()
  const name = useProjectStore((s) => s.doc.name)
  const hasData = useProjectStore((s) => s.doc.datasets.length > 0)
  const past = useProjectStore((s) => s.past)
  const future = useProjectStore((s) => s.future)
  const readOnly = useProjectStore((s) => s.readOnly)
  const level = useUiStore((s) => s.level)
  const helpOpen = useUiStore((s) => s.helpOpen)
  const historyOpen = useUiStore((s) => s.historyOpen)

  const lastPast = past[past.length - 1]
  const lastFuture = future[future.length - 1]
  const undoLabel = lastPast
    ? t('topbar.undoLabel', { label: t(lastPast.label.key, lastPast.label.params) })
    : t('topbar.nothingToUndo')
  const redoLabel = lastFuture
    ? t('topbar.redoLabel', { label: t(lastFuture.label.key, lastFuture.label.params) })
    : t('topbar.nothingToRedo')

  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-panel px-2.5">
      <div className="flex shrink-0 items-center gap-2 pr-1">
        <Logo className="size-6 shrink-0" />
        {/* A name, not the English word: page translators must leave it as it is. */}
        <span
          className="hidden text-md font-semibold tracking-wide whitespace-nowrap xl:inline"
          translate="no"
        >
          {t('app.name')}
        </span>
      </div>
      <div className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden />
      <ProjectName name={name} placeholder={t('app.untitled')} label={t('topbar.projectName')} />
      <SaveStatus />

      <div className="ml-2 flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button size="sm" variant="outline" className="bg-background" />}>
            <FileUp aria-hidden />
            <span>{t('topbar.import')}</span>
            <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-60">
            <DropdownMenuItem onClick={() => ui.openDialog('paste')}>
              <ClipboardPaste aria-hidden />
              {t('topbar.importPaste')}
              <DropdownMenuShortcut>{shortcutLabel('V')}</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={async () => {
                const f = await pickFile(DATA_FILE_ACCEPT)
                if (f) void importFromFile(t, f)
              }}
            >
              <FileUp aria-hidden />
              {t('topbar.importFile')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => ui.openDialog('examples')}>
              <FlaskConical aria-hidden />
              {t('topbar.importExample')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => ui.openDialog('notebook')}>
              <NotebookPen aria-hidden />
              {t('topbar.importNotebook')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <IconButton
          label={undoLabel}
          shortcut={undoShortcutLabel()}
          onClick={() => undo()}
          disabled={!lastPast || readOnly}
        >
          <Undo2 aria-hidden />
        </IconButton>
        <IconButton
          label={redoLabel}
          shortcut={redoShortcutLabel()}
          onClick={() => redo()}
          disabled={!lastFuture || readOnly}
        >
          <Redo2 aria-hidden />
        </IconButton>
      </div>

      <div className="ml-auto flex items-center sm:hidden">
        <CompactMenu />
      </div>
      <div className="ml-auto hidden items-center gap-1 sm:flex">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button size="sm" variant="ghost" />}>
            <BookOpenText aria-hidden />
            <span className="sr-only lg:not-sr-only">{t('topbar.project')}</span>
            <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-60">
            <DropdownMenuItem onClick={() => void saveProjectFile(t)} disabled={!hasData}>
              <Save aria-hidden />
              {t('topbar.saveProject')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={async () => {
                const f = await pickFile(PROJECT_FILE_ACCEPT)
                if (f) void openProjectFile(t, f)
              }}
            >
              <FolderOpen aria-hidden />
              {t('topbar.openProject')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => ui.openDialog('projects')}>
              <History aria-hidden />
              {t('topbar.recentProjects')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={async () => {
                if (
                  !hasData ||
                  (await confirmAction({
                    title: t('topbar.newProject'),
                    body: t('project.newConfirm'),
                    confirm: t('topbar.newProject'),
                  }))
                )
                  newProject()
              }}
            >
              <FilePlus2 aria-hidden />
              {t('topbar.newProject')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button size="sm" variant="ghost" onClick={() => ui.openDialog('export')} disabled={!hasData}>
          <Download aria-hidden />
          <span className="sr-only lg:not-sr-only">{t('topbar.export')}</span>
        </Button>
        <IconButton
          label={t('topbar.history')}
          onClick={() => ui.set({ historyOpen: !ui.get().historyOpen })}
          disabled={!hasData}
          pressed={historyOpen}
        >
          <History aria-hidden />
        </IconButton>

        <div className="mx-1 hidden h-5 w-px bg-border lg:block" aria-hidden />
        <Choice<Level>
          label={t('topbar.level')}
          hideLabel
          value={level}
          onChange={(v) => ui.set({ level: v })}
          className="hidden w-36 lg:flex"
          items={[
            { value: 'beginner', label: t('level.beginner') },
            { value: 'intermediate', label: t('level.intermediate') },
            { value: 'advanced', label: t('level.advanced') },
          ]}
        />
        <ToggleGroup
          aria-label={t('topbar.language')}
          value={[lang]}
          onValueChange={(v) => {
            const next = v[0]
            if (next === 'en' || next === 'it') setLang(next)
          }}
          size="sm"
          variant="outline"
          spacing={0}
          className="bg-background"
        >
          <ToggleGroupItem value="en" aria-label="English" lang="en" translate="no" className="px-2 text-xs">
            EN
          </ToggleGroupItem>
          <ToggleGroupItem value="it" aria-label="Italiano" lang="it" translate="no" className="px-2 text-xs">
            IT
          </ToggleGroupItem>
        </ToggleGroup>
        <IconButton
          label={t('topbar.help')}
          onClick={() => ui.set({ helpOpen: !ui.get().helpOpen })}
          pressed={helpOpen}
        >
          <HelpCircle aria-hidden />
        </IconButton>
        <IconButton label={t('topbar.settings')} onClick={() => ui.openDialog('settings')}>
          <Settings aria-hidden />
        </IconButton>
      </div>
    </header>
  )
}

function ProjectName({ name, placeholder, label }: { name: string; placeholder: string; label: string }) {
  const [text, setText] = useState(name)
  const [editing, setEditing] = useState(false)
  // Escape restores the name: the blur it triggers must not commit the stale edited text.
  const cancelled = useRef(false)
  if (!editing && text !== name) setText(name)
  return (
    <input
      aria-label={label}
      autoComplete="off"
      className="hidden h-7 w-32 shrink-0 rounded-sm border border-transparent bg-transparent px-1.5 text-sm text-ellipsis text-foreground placeholder:text-muted-foreground hover:border-border focus:border-input focus:bg-background focus-visible:outline-2 sm:block lg:w-56"
      value={text}
      placeholder={placeholder}
      onFocus={() => setEditing(true)}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        setEditing(false)
        if (cancelled.current) cancelled.current = false
        else if (text.trim() !== name) renameProject(text.trim())
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') {
          cancelled.current = true
          setText(name)
          ;(e.target as HTMLInputElement).blur()
        }
      }}
    />
  )
}
