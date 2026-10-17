import { beforeEach, describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { importText } from '@/domain/import/importPipeline'
import { asRowId, type DatasetId } from '@/domain/model'
import { I18nProvider } from '@/i18n/I18nProvider'
import { makeTranslator } from '@/i18n/translate'
import { importDraft, replaceDatasetFromDraft } from '@/state/actions/dataset'
import { deriveNow } from '@/state/derived'
import { emptyProject, loadProject, useProjectStore } from '@/state/projectStore'
import { ui, useUiStore } from '@/state/uiStore'
import { TablePanel } from './TablePanel'

// jsdom has no layout: the virtualised table needs a viewport to render its rows.
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
  configurable: true,
  get(this: HTMLElement) {
    return this.getAttribute('role') === 'grid' ? 600 : 0
  },
})

const t = makeTranslator('en')

/** A pasted table of `rows` measurements. */
function draftOf(rows: number, name: string) {
  const lines = Array.from({ length: rows }, (_, i) => `${i},${i * 2}`)
  const r = importText(`t (s),x (m)\n${lines.join('\n')}\n`, { kind: 'clipboard', fileName: name })
  if (!r.ok) throw new Error(r.error.code)
  return r.value
}

const rowIds = (id: DatasetId) => deriveNow().views.get(id)!.rowIds

/** Shows a dataset in the table panel by selecting its first record. */
function show(id: DatasetId) {
  const first = rowIds(id)[0]!
  act(() => ui.select({ datasetId: id, rowIds: new Set([first]), origin: 'table', anchor: asRowId(first) }))
}

const grid = () => screen.getByRole('grid', { name: t('table.title') })
const cursorRow = () =>
  grid()
    .getAttribute('aria-activedescendant')
    ?.replace(/^.*-row-/, '')

function moveDown(times: number) {
  for (let i = 0; i < times; i++) fireEvent.keyDown(grid(), { key: 'ArrowDown' })
}

beforeEach(() => loadProject(emptyProject('Table')))

describe('the keyboard cursor of the table', () => {
  it('starts at the first row of another dataset', () => {
    const a = importDraft(draftOf(10, 'a.csv'))
    const b = importDraft(draftOf(10, 'b.csv'))
    show(a)
    render(
      <I18nProvider lang="en">
        <TablePanel />
      </I18nProvider>,
    )
    moveDown(5)
    expect(cursorRow()).toBe('5')
    show(b)
    expect(cursorRow()).toBe('0')
  })

  it('stays on the last row when the dataset is re-read with fewer rows', () => {
    const a = importDraft(draftOf(10, 'a.csv'))
    show(a)
    render(
      <I18nProvider lang="en">
        <TablePanel />
      </I18nProvider>,
    )
    moveDown(9)
    expect(cursorRow()).toBe('9')
    act(() => replaceDatasetFromDraft(a, draftOf(3, 'a.csv')))
    act(() => ui.clearSelection())
    expect(cursorRow()).toBe('2')
    // Space toggles the row under the cursor: a real record, never one past the end.
    fireEvent.keyDown(grid(), { key: ' ' })
    const sel = useUiStore.getState().selection
    expect(sel?.datasetId).toBe(a)
    expect([...(sel?.rowIds ?? [])]).toEqual([rowIds(a)[2]])
    expect(useProjectStore.getState().doc.datasets).toHaveLength(1)
  })
})

describe('the dataset the table shows by default', () => {
  it("is the focused plot's dataset, also for box, bar and histogram plots", () => {
    importDraft(draftOf(4, 'first.csv'))
    const second = importDraft(draftOf(6, 'second.csv'))
    // Turn the focused plot (the second dataset's tab) into a box plot of that dataset.
    const doc = useProjectStore.getState().doc
    const plots = doc.plots.map((p) =>
      p.series.some((s) => s.datasetId === second)
        ? { ...p, type: 'box' as const, box: { ...p.box, datasetId: second, value: p.series[0]!.y } }
        : p,
    )
    act(() => useProjectStore.setState({ doc: { ...doc, plots } }))
    render(
      <I18nProvider lang="en">
        <TablePanel />
      </I18nProvider>,
    )
    expect(screen.getByText(t('data.rowsColumns', { rows: 6, cols: 2 }))).toBeInTheDocument()
  })
})
