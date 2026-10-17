import { safeFileName } from '@/domain/export/filename'
import { toast } from '@/components/ui/toast'
import type { Translator } from '@/i18n/translate'
import { issueTitle } from '@/i18n/translate'
import { issue } from '@/domain/model'
import { downloadText } from '@/platform/download'
import { currentProjectFile } from '@/state/actions/project'
import { useProjectStore } from '@/state/projectStore'

/** Saves the complete project (raw data + analysis + log), never just an image. */
export async function saveProjectFile(t: Translator): Promise<void> {
  try {
    const text = await currentProjectFile()
    // Never hand the user a file that would not reopen (e.g. a NaN written as null).
    // zod (schema validation) is loaded only when a project is saved or opened.
    const { deserializeProject } = await import('@/domain/project/deserialize')
    const check = deserializeProject(text, { maxBytes: Number.MAX_SAFE_INTEGER })
    if (!check.ok) {
      toast.add({
        title: issueTitle(t, issue('E_EXPORT_FAILED', { reason: issueTitle(t, check.error) })),
        type: 'error',
      })
      return
    }
    const name = safeFileName(useProjectStore.getState().doc.name || t('app.untitled'), 'sciplot')
    downloadText(text, name, 'application/octet-stream')
    // Already loaded by currentProjectFile: the same size rule as the one that reopens the file.
    const { checkReopenSize } = await import('@/domain/project/serialize')
    const tooLarge = checkReopenSize(text)
    if (tooLarge) toast.add({ title: issueTitle(t, tooLarge), type: 'warning' })
    toast.add({ title: t('project.saved', { name }), type: 'success' })
  } catch (err) {
    toast.add({
      title: issueTitle(
        t,
        issue('E_EXPORT_FAILED', { reason: err instanceof Error ? err.message : String(err) }),
      ),
      type: 'error',
    })
  }
}
