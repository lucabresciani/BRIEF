import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as XLSX from 'xlsx'
import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { importRegions, type RegionImportSpec } from '@/domain/import/regionImport'
import type { RowId } from '@/domain/model'
import { I18nProvider } from '@/i18n/I18nProvider'
import { importDrafts } from '@/state/actions/dataset'
import { excludeRows } from '@/state/actions/analysis'
import { deriveNow } from '@/state/derived'
import { emptyProject, loadProject, useProjectStore } from '@/state/projectStore'
import { ui } from '@/state/uiStore'
import { ExclusionDialog } from '@/features/plot/ExclusionDialog'
import { DataGrid } from './DataGrid'

const MICRO = 'micro-tables.xlsx'
const bytes = new Uint8Array(readFileSync(resolve('tests/fixtures/import', MICRO)))

// jsdom has no layout: the virtualised table needs a viewport to render its rows.
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
  configurable: true,
  get(this: HTMLElement) {
    return this.getAttribute('role') === 'grid' ? 600 : 0
  },
})

function load(spec: RegionImportSpec) {
  const r = importRegions(bytes, MICRO, spec, {}, { xlsx: XLSX })
  if (!r.ok) throw new Error(r.error.code)
  importDrafts(r.value)
  const ds = useProjectStore.getState().doc.datasets[0]!
  const view = deriveNow().views.get(ds.id)!
  return { ds, view }
}

beforeEach(() => loadProject(emptyProject('Records')))

describe('records named as in the source, in the table and in the exclusion dialog', () => {
  it('a transposed table: the column "Column" and the sheet column letters of each record', () => {
    const { ds, view } = load({
      sheetName: 'Transposed',
      mode: 'separate',
      regions: [{ range: 'B2:F6', orientation: 'rows' }],
    })
    render(
      <I18nProvider lang="en">
        <DataGrid dataset={ds} view={view} />
      </I18nProvider>,
    )
    const grid = screen.getByRole('grid', { name: 'Data table' })
    expect(within(grid).getAllByRole('columnheader')[0]).toHaveTextContent('Column')
    expect(
      within(grid)
        .getAllByRole('rowheader')
        .map((h) => h.textContent),
    ).toEqual(['C', 'D', 'E', 'F'])
  })

  it('a merged dataset: each row header names its table (the sheet rows repeat)', () => {
    const { ds, view } = load({
      sheetName: 'Grid',
      mode: 'stack',
      regions: ['B2:E9', 'G2:J9'].map((range) => ({ range, orientation: 'columns' as const })),
    })
    render(
      <I18nProvider lang="en">
        <DataGrid dataset={ds} view={view} />
      </I18nProvider>,
    )
    const headers = within(screen.getByRole('grid', { name: 'Data table' })).getAllByRole('rowheader')
    expect(headers[0]).toHaveAccessibleName('oak plank 1 · row 4')
    expect(headers[6]).toHaveAccessibleName('pine plank 1 · row 4')
    expect(headers[6]).toHaveTextContent('4')
  })

  it('a merged dataset: an excluded record still says so in its row header name', () => {
    const { ds } = load({
      sheetName: 'Grid',
      mode: 'stack',
      regions: ['B2:E9', 'G2:J9'].map((range) => ({ range, orientation: 'columns' as const })),
    })
    const before = deriveNow().views.get(ds.id)!
    excludeRows(ds.id, [before.rowIds[1]! as RowId], 'measurement-problem', '')
    const view = deriveNow().views.get(ds.id)!
    render(
      <I18nProvider lang="en">
        <DataGrid dataset={useProjectStore.getState().doc.datasets[0]!} view={view} />
      </I18nProvider>,
    )
    const headers = within(screen.getByRole('grid', { name: 'Data table' })).getAllByRole('rowheader')
    expect(headers[1]).toHaveAccessibleName('oak plank 1 · row 5, Excluded')
    expect(headers[0]).toHaveAccessibleName('oak plank 1 · row 4')
  })

  it('the exclusion dialog lists sheet columns for a transposed table, never fake row numbers', () => {
    const { ds, view } = load({
      sheetName: 'Transposed',
      mode: 'separate',
      regions: [{ range: 'B2:F6', orientation: 'rows' }],
    })
    ui.select({
      datasetId: ds.id,
      rowIds: new Set([view.rowIds[1]!, view.rowIds[0]!]),
      origin: 'table',
      anchor: view.rowIds[0]! as RowId,
    })
    ui.openDialog('exclusion')
    render(
      <I18nProvider lang="it">
        <ExclusionDialog />
      </I18nProvider>,
    )
    expect(
      screen.getByText(/Esclusione dall’unica serie di “micro-tables · layers 0”: Colonne C, D\./),
    ).toBeInTheDocument()
  })
})
