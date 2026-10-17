import { lazy, Suspense, useState, type ReactNode } from 'react'
import { ConfirmHost } from '@/components/app/confirm'
import { PasteDialog } from '@/features/onboarding/PasteDialog'
import { ExamplesDialog } from '@/features/onboarding/ExamplesDialog'
import { ImportDialog } from '@/features/import/ImportDialog'
import { loadSheetPicker } from '@/features/import/importFlow'
import { useUiStore } from '@/state/uiStore'
import { NewNotebookDialog } from '@/features/notebook/NewNotebookDialog'
import { ExclusionDialog } from '@/features/plot/ExclusionDialog'

// Workbooks with several tables per sheet only: the picker loads in its own chunk, then stays mounted
// so that it can play its closing transition like the other dialogs. (The import preview stays in the
// entry: as a chunk of its own it pulls shared code out of the entry and the startup grows.)
const SheetPickerDialog = lazy(loadSheetPicker)
// Opened a few times per session at most: each in its own chunk, precached like every chunk (offline
// they still open). Rolldown then moves the code they share with the app into chunks the entry
// preloads, so what this saves at startup is their own code, measured as the entry plus its preloads.
const ExportDialog = lazy(() =>
  import('@/features/export/ExportDialog').then((m) => ({ default: m.ExportDialog })),
)
const SettingsDialog = lazy(() =>
  import('@/features/settings/SettingsDialog').then((m) => ({ default: m.SettingsDialog })),
)
const DerivedColumnDialog = lazy(() =>
  import('@/features/data/DerivedColumnDialog').then((m) => ({ default: m.DerivedColumnDialog })),
)
const ProjectsDialog = lazy(() =>
  import('@/features/project/ProjectsDialog').then((m) => ({ default: m.ProjectsDialog })),
)
const Walkthrough = lazy(() =>
  import('@/features/help/Walkthrough').then((m) => ({ default: m.Walkthrough })),
)

/** Renders a lazy dialog from the first time it is opened on. */
function useOpenedOnce(open: boolean): boolean {
  const [used, setUsed] = useState(false)
  if (open && !used) setUsed(true)
  return used || open
}

/** A lazy dialog, mounted from its first opening on (then kept, for its closing transition). */
function OnceOpened({ open, children }: { open: boolean; children: ReactNode }) {
  return useOpenedOnce(open) ? <Suspense fallback={null}>{children}</Suspense> : null
}

export function Dialogs() {
  const dialog = useUiStore((s) => s.dialog)
  const walkthrough = useUiStore((s) => s.walkthrough !== null)
  const pickerUsed = useOpenedOnce(dialog === 'sheetPicker')
  return (
    <>
      <PasteDialog />
      <ExamplesDialog />
      <ImportDialog />
      {pickerUsed ? (
        <Suspense fallback={null}>
          <SheetPickerDialog />
        </Suspense>
      ) : null}
      <NewNotebookDialog />
      <OnceOpened open={dialog === 'export'}>
        <ExportDialog />
      </OnceOpened>
      <ExclusionDialog />
      <OnceOpened open={dialog === 'settings'}>
        <SettingsDialog />
      </OnceOpened>
      <OnceOpened open={dialog === 'derived'}>
        <DerivedColumnDialog />
      </OnceOpened>
      <OnceOpened open={dialog === 'projects'}>
        <ProjectsDialog />
      </OnceOpened>
      <OnceOpened open={walkthrough}>
        <Walkthrough />
      </OnceOpened>
      <ConfirmHost />
    </>
  )
}
