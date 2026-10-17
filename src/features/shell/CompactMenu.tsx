import { Download, FolderOpen, HelpCircle, History, MoreHorizontal, Save, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useI18n } from '@/i18n/I18nProvider'
import { useProjectStore } from '@/state/projectStore'
import { ui } from '@/state/uiStore'
import { PROJECT_FILE_ACCEPT, pickFile } from '@/platform/files'
import { openProjectFile } from '@/features/import/importFlow'
import { saveProjectFile } from '@/features/project/projectFile'

/** Phone-width top bar: secondary actions (project, export, history, help, settings, language) in one menu. */
export function CompactMenu() {
  const { t, lang, setLang } = useI18n()
  const hasData = useProjectStore((s) => s.doc.datasets.length > 0)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" aria-label={t('common.more')} />}>
        <MoreHorizontal aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
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
        <DropdownMenuItem onClick={() => ui.openDialog('export')} disabled={!hasData}>
          <Download aria-hidden />
          {t('topbar.export')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => ui.set({ historyOpen: true, helpOpen: false })} disabled={!hasData}>
          <History aria-hidden />
          {t('topbar.history')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => ui.set({ helpOpen: true, historyOpen: false })}>
          <HelpCircle aria-hidden />
          {t('topbar.help')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => ui.openDialog('settings')}>
          <Settings aria-hidden />
          {t('topbar.settings')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={lang} onValueChange={(v) => (v === 'en' || v === 'it') && setLang(v)}>
          <DropdownMenuRadioItem value="en" lang="en" translate="no">
            English
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="it" lang="it" translate="no">
            Italiano
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
