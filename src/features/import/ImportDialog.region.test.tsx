import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as XLSX from 'xlsx'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { importBytes } from '@/domain/import/importPipeline'
import { importRegions, type RegionImportSpec } from '@/domain/import/regionImport'
import { I18nProvider } from '@/i18n/I18nProvider'
import { ui, useUiStore } from '@/state/uiStore'
import { ImportDialog } from './ImportDialog'
import { useImportStore } from './importFlow'

vi.mock('@/components/ui/toast', () => ({ toast: { add: () => undefined } }))

const MICRO = 'micro-tables.xlsx'
const data = readFileSync(resolve('tests/fixtures/import', MICRO))
const bytes = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)

function show(spec: RegionImportSpec) {
  const sheet = importBytes(new Uint8Array(bytes), MICRO, { sheetName: spec.sheetName }, { xlsx: XLSX })
  const r = importRegions(new Uint8Array(bytes), MICRO, spec, {}, { xlsx: XLSX })
  if (!r.ok || !sheet.ok) throw new Error('import failed')
  useImportStore.setState({
    draft: r.value[0]!,
    sheetDraft: sheet.value,
    regionSpec: spec,
    source: { kind: 'bytes', bytes, fileName: MICRO },
    overrides: {},
    replacing: null,
    error: null,
  })
  ui.openDialog('import')
  render(
    <I18nProvider lang="en">
      <ImportDialog />
    </I18nProvider>,
  )
}

beforeEach(() => ui.closeDialog())

describe('ImportDialog for tables cut out by the sheet picker', () => {
  it('a transposed table: its records are sheet columns, and so are its header choices', () => {
    show({ sheetName: 'Transposed', mode: 'separate', regions: [{ range: 'B2:F6', orientation: 'rows' }] })
    expect(screen.getByText(/Table B2:F6 of the sheet “Transposed”\./)).toBeInTheDocument()
    const table = screen.getByRole('table', { name: 'Preview' })
    expect(within(table).getAllByRole('columnheader')[0]).toHaveTextContent('Column')
    expect(
      within(table)
        .getAllByRole('rowheader')
        .map((h) => h.textContent),
    ).toEqual(['C', 'D', 'E', 'F'])
    expect(screen.getByText('Header column')).toBeInTheDocument()
    expect(screen.queryByText('Sheet')).toBeNull() // a cut table belongs to its sheet
  })

  it('a merged dataset: its header is built, so only its columns can be adjusted', () => {
    show({
      sheetName: 'Grid',
      mode: 'stack',
      regions: ['B2:E9', 'G2:J9'].map((range) => ({ range, orientation: 'columns' as const })),
    })
    expect(screen.getByText(/2 tables of the sheet “Grid”, merged into one dataset\./)).toBeInTheDocument()
    expect(screen.queryByText('Header row')).toBeNull()
    expect(screen.queryByText('Units row')).toBeNull()
  })

  it('"Choose tables" goes back to the picker with its selection', async () => {
    const user = userEvent.setup()
    show({ sheetName: 'Grid', mode: 'separate', regions: [{ range: 'B2:E9', orientation: 'columns' }] })
    await user.click(screen.getByRole('button', { name: 'Choose tables' }))
    expect(useUiStore.getState().dialog).toBe('sheetPicker')
    expect(useImportStore.getState().regionSpec).toBeNull()
    expect(useImportStore.getState().sheetDraft?.detection.sheetName).toBe('Grid')
  })
})
