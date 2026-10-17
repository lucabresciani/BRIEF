import { useState } from 'react'
import { ClipboardPaste } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/components/ui/toast'
import { useT } from '@/i18n/I18nProvider'
import { issueTitle } from '@/i18n/translate'
import { ui, useUiStore } from '@/state/uiStore'
import { readClipboardText } from '@/platform/clipboard'
import { importFromText, useImportStore } from '@/features/import/importFlow'

export function PasteDialog() {
  const t = useT()
  const open = useUiStore((s) => s.dialog === 'paste')
  const loading = useImportStore((s) => s.loading)
  const [text, setText] = useState('')
  const submit = async () => {
    if (!text.trim()) return
    ui.closeDialog()
    await importFromText(t, text, 'clipboard')
    setText('')
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && ui.closeDialog()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('paste.title')}</DialogTitle>
          <DialogDescription>{t('paste.lead')}</DialogDescription>
        </DialogHeader>
        <div data-paste-scope>
          <label htmlFor="paste-area" className="sr-only">
            {t('paste.label')}
          </label>
          <Textarea
            id="paste-area"
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('paste.placeholder')}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            className="h-56 resize-y overscroll-contain bg-background font-mono text-xs leading-relaxed whitespace-pre"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void submit()
            }}
          />
        </div>
        <DialogFooter className="sm:justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              const r = await readClipboardText()
              if (r.ok) setText(r.text)
              else
                toast.add({
                  title: issueTitle(t, {
                    code: r.reason === 'empty' ? 'E_CLIPBOARD_EMPTY' : 'E_CLIPBOARD_DENIED',
                  }),
                  type: 'warning',
                })
            }}
          >
            <ClipboardPaste aria-hidden />
            {t('paste.readClipboard')}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => ui.closeDialog()}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" disabled={!text.trim() || loading} onClick={() => void submit()}>
              {t('paste.import')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
