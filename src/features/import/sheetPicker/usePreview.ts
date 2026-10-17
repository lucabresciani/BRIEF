import { useEffect, useState } from 'react'
import type { ImportDraft } from '@/domain/import/importPipeline'
import type { RegionImportSpec } from '@/domain/import/regionImport'
import { issue, type Issue } from '@/domain/model'
import { importRegions } from '@/workers/importClient'

export interface PreviewState {
  /** The request this result answers ('' = none). */
  key: string
  draft: ImportDraft | null
  error: Issue | null
  loading: boolean
  /** The result shown answers an older request (the selection changed since). */
  stale: boolean
}

const NONE: PreviewState = { key: '', draft: null, error: null, loading: false, stale: false }

/**
 * The draft the importer would make for `spec`, computed in the worker by the same importRegions as the
 * import itself (so the preview is what the import keeps). Debounced while the selection changes; a
 * stale answer is dropped.
 */
export function useRegionPreview(
  spec: RegionImportSpec | null,
  source: { bytes: ArrayBuffer; fileName: string } | null,
): PreviewState {
  const key = spec && source ? JSON.stringify(spec) : ''
  const [state, setState] = useState<PreviewState>(NONE)
  useEffect(() => {
    if (!key || !source) return
    let live = true
    const timer = setTimeout(() => {
      setState((s) => ({ ...s, loading: true }))
      const show = (draft: ImportDraft | null, error: Issue | null) => {
        if (live) setState({ key, draft, error, loading: false, stale: false })
      }
      importRegions(source.bytes, source.fileName, JSON.parse(key) as RegionImportSpec).then(
        (r) => show(r.ok ? (r.value[0] ?? null) : null, r.ok ? null : r.error),
        // The preview says why it is missing instead of loading forever.
        (err: unknown) =>
          show(null, issue('E_INTERNAL_GUARD', { reason: err instanceof Error ? err.message : String(err) })),
      )
    }, 250)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [key, source])
  return key ? { ...state, stale: state.key !== key } : NONE
}
