import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as XLSX from 'xlsx'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { importBytes } from '@/domain/import/importPipeline'
import { importRegions, type RegionImportSpec } from '@/domain/import/regionImport'
import { I18nProvider } from '@/i18n/I18nProvider'
import { emptyProject, loadProject, useProjectStore } from '@/state/projectStore'
import { ui, useUiStore } from '@/state/uiStore'
import { useImportStore } from '../importFlow'
import SheetPickerDialog from './SheetPickerDialog'

const client = vi.hoisted(() => ({ importRegions: vi.fn(), cancelImports: vi.fn() }))
vi.mock('@/workers/importClient', async (orig) => ({ ...(await orig<object>()), ...client }))
vi.mock('@/components/ui/toast', () => ({ toast: { add: () => undefined } }))

const MICRO = 'micro-tables.xlsx'
const data = readFileSync(resolve('tests/fixtures/import', MICRO))
const bytes = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)

function open(sheetName?: string, lang: 'en' | 'it' = 'en') {
  const r = importBytes(new Uint8Array(bytes), MICRO, sheetName ? { sheetName } : {}, { xlsx: XLSX })
  if (!r.ok) throw new Error(r.error.code)
  useImportStore.setState({
    sheetDraft: r.value,
    draft: null,
    source: { kind: 'bytes', bytes, fileName: MICRO },
    overrides: sheetName ? { sheetName } : {},
    replacing: null,
    pickerInit: null,
    error: null,
  })
  ui.openDialog('sheetPicker')
  return render(
    <I18nProvider lang={lang}>
      <SheetPickerDialog />
    </I18nProvider>,
  )
}

// jsdom has no layout: the virtualised grid gets a 900 × 480 viewport (the size it measures).
const offset = (size: number) => ({
  configurable: true,
  get(this: HTMLElement) {
    return this.getAttribute('role') === 'grid' ? size : 0
  },
})
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offset(900))
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offset(480))

beforeEach(() => {
  loadProject(emptyProject('Picker'))
  client.importRegions
    .mockReset()
    .mockImplementation(async (b: ArrayBuffer, name: string, spec: RegionImportSpec, ov) =>
      importRegions(new Uint8Array(b), name, spec, ov, { xlsx: XLSX }),
    )
})

const list = () => screen.getByRole('listbox', { name: 'Tables on this sheet' })
const options = () => within(list()).getAllByRole('option')
const selected = () =>
  options()
    .filter((o) => o.getAttribute('aria-selected') === 'true')
    .map((o) => o.getAttribute('data-key'))
const grid = () => screen.getByRole('grid', { name: 'Sheet Grid' })
/** The dialog puts the focus on the grid once it has opened (deferred): wait for it before moving it. */
const settled = () => waitFor(() => expect(grid()).toHaveFocus())
const active = () => grid().getAttribute('aria-activedescendant')

describe('SheetPickerDialog: blocks, list and selection', () => {
  it('shows the sheet with its tables and lists every block', () => {
    open()
    expect(screen.getByRole('heading', { name: 'Choose the tables to import' })).toBeInTheDocument()
    expect(screen.getByText(/6 tables found on “Grid”/)).toBeInTheDocument()
    expect(options()).toHaveLength(6)
    expect(options()[0]).toHaveTextContent('oak · plank 1')
    expect(options()[0]).toHaveTextContent('B2:E9')
    // Sheet coordinates: column letters from B and sheet row numbers.
    expect(within(grid()).getAllByRole('columnheader')[1]).toHaveTextContent('B')
    expect(within(grid()).getAllByRole('rowheader')[0]).toHaveTextContent('2')
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Grid',
      'Transposed',
      'Paired',
      'Matrix',
    ])
  })

  it('click selects one, Ctrl/Cmd+click toggles, Shift+click selects a range in reading order', async () => {
    const user = userEvent.setup()
    open()
    await user.click(options()[1]!)
    expect(selected()).toEqual(['b2'])
    await user.keyboard('{Control>}')
    await user.click(options()[3]!)
    await user.keyboard('{/Control}')
    expect(selected()).toEqual(['b2', 'b4'])
    await user.keyboard('{Shift>}')
    await user.click(options()[5]!)
    await user.keyboard('{/Shift}')
    expect(selected()).toEqual(['b4', 'b5', 'b6'])
    expect(screen.getByText('3 tables selected: 4, 5, 6.')).toBeInTheDocument()
  })

  it('the keyboard in the grid: arrows move, Space toggles the table, Ctrl+A all, Escape clears then closes', async () => {
    const user = userEvent.setup()
    open()
    await settled()
    expect(active()).toMatch(/-0-0$/) // the first table's corner, B2
    await user.keyboard('{ArrowDown}{ArrowRight}')
    expect(active()).toMatch(/-1-1$/)
    await user.keyboard(' ')
    expect(selected()).toEqual(['b1'])
    await user.keyboard(' ')
    expect(selected()).toEqual([])
    await user.keyboard('{Control>}a{/Control}')
    expect(selected()).toHaveLength(6)
    await user.keyboard('{Escape}')
    expect(selected()).toEqual([])
    expect(useUiStore.getState().dialog).toBe('sheetPicker') // Escape cleared, the dialog stays
    await user.keyboard('{Escape}')
    await waitFor(() => expect(useUiStore.getState().dialog).toBeNull())
  })

  it('Shift+arrows mark a rectangle, announced; Enter adds it as a range of its own', async () => {
    const user = userEvent.setup()
    open()
    await settled()
    await user.keyboard('{ArrowDown}{Shift>}{ArrowDown}{ArrowDown}{ArrowRight}{/Shift}')
    expect(screen.getByText('Range B3:C5. Press Enter to add it.')).toBeInTheDocument()
    await user.keyboard('{Enter}')
    expect(selected()).toEqual(['range:B3:C5'])
    expect(options().at(-1)).toHaveTextContent('Your range')
    // Added: the live region no longer offers to add it.
    expect(screen.queryByText('Range B3:C5. Press Enter to add it.')).toBeNull()
  })

  it('the list from the keyboard: arrows move, Space toggles, Shift+arrows extend, Ctrl+A selects all', async () => {
    const user = userEvent.setup()
    open()
    await settled()
    list().focus()
    await user.keyboard(' ')
    expect(selected()).toEqual(['b1'])
    await user.keyboard('{Shift>}{ArrowDown}{ArrowDown}{/Shift}')
    expect(selected()).toEqual(['b1', 'b2', 'b3'])
    await user.keyboard('{Control>}a{/Control}')
    expect(selected()).toHaveLength(6)
  })
})

describe('SheetPickerDialog: blocks without a title', () => {
  it('a table without a title is listed by its first variable names, not as "Untitled"', () => {
    const xls = readFileSync(resolve('tests/fixtures/import', 'biff8-tables.xls'))
    const b = xls.buffer.slice(xls.byteOffset, xls.byteOffset + xls.byteLength)
    const r = importBytes(new Uint8Array(b), 'biff8-tables.xls', {}, { xlsx: XLSX })
    if (!r.ok) throw new Error(r.error.code)
    useImportStore.setState({
      sheetDraft: r.value,
      draft: null,
      source: { kind: 'bytes', bytes: b, fileName: 'biff8-tables.xls' },
      overrides: {},
      replacing: null,
      pickerInit: null,
      error: null,
    })
    ui.openDialog('sheetPicker')
    render(
      <I18nProvider lang="en">
        <SheetPickerDialog />
      </I18nProvider>,
    )
    expect(options()[0]).toHaveTextContent('Tempo (s), Tensione (µV), Resistenza (Ω), …')
    expect(options()[0]).not.toHaveTextContent('Untitled')
    expect(options()[1]).toHaveTextContent('Pressione è')
  })
})

describe('SheetPickerDialog: the A1 range field', () => {
  it('validates the range and says what is wrong, in English and Italian', async () => {
    const user = userEvent.setup()
    open()
    const field = screen.getByLabelText('Add a range')
    await user.type(field, 'B2:{Enter}')
    expect(screen.getByRole('alert')).toHaveTextContent('Write a range such as B2:E9.')
    await user.clear(field)
    await user.type(field, 'f2:f18{Enter}')
    expect(screen.getByRole('alert')).toHaveTextContent('F2:F18 holds no values.')
    await user.clear(field)
    await user.type(field, 'AA100:AB120{Enter}')
    expect(screen.getByRole('alert')).toHaveTextContent(
      'AA100:AB120 is outside the used part of the sheet (B2:O18).',
    )
    await user.clear(field)
    await user.type(field, 'b3:e9{Enter}')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(selected()).toEqual(['range:B3:E9'])
  })

  it('Italian messages', async () => {
    const user = userEvent.setup()
    open(undefined, 'it')
    await user.type(screen.getByLabelText('Aggiungi un intervallo'), 'B2:{Enter}')
    expect(screen.getByRole('alert')).toHaveTextContent('Scrivi un intervallo come B2:E9.')
  })
})

describe('SheetPickerDialog: orientation and merge', () => {
  it('a transposed table: the detected reading is marked and flips in one click (header column ↔ row)', async () => {
    const user = userEvent.setup()
    open('Transposed')
    await user.click(options()[0]!)
    const panel = screen.getByTestId('selection-panel')
    expect(within(panel).getByText('Header column')).toBeInTheDocument()
    const rows = within(panel).getByRole('button', { name: /Rows/ })
    expect(rows).toHaveTextContent('detected')
    expect(rows).toHaveAttribute('aria-pressed', 'true')
    await user.click(within(panel).getByRole('button', { name: /Columns/ }))
    expect(within(panel).getByText('Header row')).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: /Columns/ })).toHaveAttribute('aria-pressed', 'true')
    // The preview asks the importer for the table read the chosen way.
    await waitFor(() =>
      expect(client.importRegions.mock.calls.at(-1)?.[2]).toMatchObject({
        regions: [{ range: 'B2:F6', orientation: 'columns' }],
      }),
    )
  })

  it('tables with the same columns: the merge proposal, its label columns, a preview, then one dataset', async () => {
    const user = userEvent.setup()
    open()
    await settled()
    list().focus()
    await user.keyboard('{Control>}a{/Control}')
    const proposal = screen.getByTestId('merge-proposal')
    expect(proposal).toHaveTextContent(
      '6 tables share the columns position, Width mm, Depth mm, area: merge them into one dataset?',
    )
    expect(within(proposal).getByRole('checkbox', { name: 'Add the label column Title 1' })).toBeChecked()
    expect(within(proposal).getByRole('checkbox', { name: 'Add the label column Block' })).not.toBeChecked()
    expect(within(proposal).getByText('Values: oak, pine, birch')).toBeInTheDocument()
    // The preview is the merged dataset, read by the importer itself.
    const preview = screen.getByTestId('picker-preview')
    await waitFor(() => expect(within(preview).getByRole('table')).toBeInTheDocument(), { timeout: 3000 })
    expect(
      within(preview)
        .getAllByRole('columnheader')
        .map((c) => c.textContent),
    ).toEqual(['Row', 'Title 1', 'plank', 'position', 'Width mm', 'Depth mm', 'area'])
    // Rename the wood label, leave out the plank one, merge.
    const name = within(proposal).getAllByRole('textbox', { name: 'Name of the label column' })[0]!
    await user.clear(name)
    await user.type(name, 'Wood')
    await user.click(within(proposal).getByRole('checkbox', { name: 'Add the label column plank' }))
    expect(screen.getByTestId('picker-merge')).toHaveClass('bg-primary')
    await act(async () => fireEvent.click(screen.getByTestId('picker-merge')))
    await waitFor(() => expect(useProjectStore.getState().doc.datasets).toHaveLength(1))
    const [ds] = useProjectStore.getState().doc.datasets
    expect(ds!.columns.map((c) => c.name)).toEqual(['Wood', 'position', 'Width mm', 'Depth mm', 'area'])
    expect(ds!.columns[0]!.role).toBe('group')
    expect(useUiStore.getState().dialog).toBeNull()
  })

  it('in Italian, label columns the sheet does not name are named in Italian (they become column names)', async () => {
    const user = userEvent.setup()
    open(undefined, 'it')
    await waitFor(() => expect(screen.getByRole('grid', { name: 'Foglio Grid' })).toHaveFocus())
    screen.getByRole('listbox', { name: 'Tabelle in questo foglio' }).focus()
    await user.keyboard('{Control>}a{/Control}')
    const proposal = screen.getByTestId('merge-proposal')
    expect(
      within(proposal)
        .getAllByRole('textbox', { name: 'Nome della colonna di etichetta' })
        .map((i) => (i as HTMLInputElement).value),
    ).toEqual(['Titolo 1', 'plank', 'Blocco'])
    await act(async () => fireEvent.click(screen.getByTestId('picker-merge')))
    await waitFor(() => expect(useProjectStore.getState().doc.datasets).toHaveLength(1))
    expect(client.importRegions.mock.calls.at(-1)?.[2].labels.map((l: { name: string }) => l.name)).toEqual([
      'Titolo 1',
      'plank',
    ])
    expect(useProjectStore.getState().doc.datasets[0]!.columns[0]!.name).toBe('Titolo 1')
  })

  it('tables read differently cannot be merged; the proposal offers to keep the matching ones', async () => {
    const user = userEvent.setup()
    open()
    await settled()
    list().focus()
    await user.keyboard('{Control>}a{/Control}')
    const panel = screen.getByTestId('selection-panel')
    await user.click(within(panel).getByRole('button', { name: /Rows/ }))
    const proposal = screen.getByTestId('merge-proposal')
    expect(proposal).toHaveTextContent('5 of the 6 selected tables share the columns')
    expect(proposal).toHaveTextContent('Tables with variables in rows and in columns cannot be merged.')
    expect(screen.getByTestId('picker-merge')).toBeDisabled()
    await user.click(within(proposal).getByRole('button', { name: 'Select only these 5' }))
    expect(selected()).toHaveLength(5)
    expect(screen.getByTestId('picker-merge')).toBeEnabled()
  })
})
