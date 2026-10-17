import type { RegionImportSpec } from '@/domain/import/regionImport'
import type { Issue } from '@/domain/model'
import { toast } from '@/components/ui/toast'
import type { Translator } from '@/i18n/translate'
import { importDrafts, replaceDatasetFromDraft } from '@/state/actions/dataset'
import { ui } from '@/state/uiStore'
import { importRegions } from '@/workers/importClient'
import { cancelled, closeImport, rememberImport, run, useImportStore } from '../importFlow'

/**
 * What the picker does with the file it shows. In the picker's chunk: nothing here runs for
 * files with one table per sheet.
 */

/** The sheet tabs: read another sheet of the same file (its blocks and cells). */
export async function pickSheet(sheetName: string) {
  const { source } = useImportStore.getState()
  if (!source) return
  useImportStore.setState({ loading: true, error: null })
  const r = await run(source, { sheetName })
  useImportStore.setState({ loading: false })
  if (!r.ok) return cancelled(r) ? undefined : useImportStore.setState({ error: r.error })
  useImportStore.setState({ sheetDraft: r.value, overrides: { sheetName } })
}

/** "Import whole sheet as one table": the ordinary preview of the whole sheet. */
export function importWholeSheet() {
  const { sheetDraft } = useImportStore.getState()
  if (!sheetDraft) return
  useImportStore.setState({ draft: sheetDraft, regionSpec: null, error: null })
  ui.openDialog('import')
}

/**
 * Blocks chosen in the picker → datasets. The region request goes to the worker as it is: the whole-sheet
 * dialog's header/units/data rows are never forwarded (they are rows of another grid). One resulting
 * draft that the importer is unsure about opens the preview (its header row then re-cuts that block);
 * otherwise every table is imported in one undoable step and one plot tab. Returns the error to show in
 * the picker, if any.
 */
export async function importFromPicker(t: Translator, spec: RegionImportSpec): Promise<Issue | null> {
  const { source, replacing } = useImportStore.getState()
  if (source?.kind !== 'bytes') return null
  useImportStore.setState({ loading: true, error: null })
  const r = await importRegions(source.bytes, source.fileName, spec)
  useImportStore.setState({ loading: false })
  if (!r.ok) {
    if (cancelled(r)) return null
    useImportStore.setState({ error: r.error })
    return r.error
  }
  const drafts = r.value
  const one = drafts.length === 1 ? drafts[0]! : null
  if (one && !one.fastPath) {
    useImportStore.setState({ draft: one, regionSpec: spec, overrides: {} })
    ui.openDialog('import')
    return null
  }
  if (replacing) {
    if (!one) return null
    replaceDatasetFromDraft(replacing, one)
    rememberImport(replacing, { source, overrides: {}, region: spec })
    closeImport()
    return null
  }
  const ids = importDrafts(drafts)
  ids.forEach((id, k) =>
    rememberImport(id, {
      source,
      overrides: {},
      region: spec.mode === 'stack' ? spec : { ...spec, regions: [spec.regions[k]!] },
    }),
  )
  if (drafts.every((d) => d.issues.length === 0))
    toast.add({
      title: t('import.reviewBannerNone', { name: drafts.map((d) => d.suggestedName).join(', ') }),
      type: 'success',
    })
  closeImport()
  return null
}
