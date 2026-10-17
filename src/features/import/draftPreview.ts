import { useMemo } from 'react'
import { buildDatasetView } from '@/domain/derive/datasetView'
import type { DatasetView } from '@/domain/derive/types'
import type { ImportDraft } from '@/domain/import/importPipeline'
import type { ImportedDataset } from '@/domain/model'
import { datasetFromDraft } from '@/state/actions/dataset'

/** The dataset a draft would create, and its view: what the preview shows is what the import keeps. */
export function useDraftPreview(
  draft: ImportDraft | null,
): { ds: ImportedDataset; view: DatasetView } | null {
  return useMemo(() => {
    if (!draft) return null
    const ds = datasetFromDraft(draft, draft.suggestedName, null)
    return { ds, view: buildDatasetView(ds, draft.rawTable) }
  }, [draft])
}
