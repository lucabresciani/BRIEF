import { beforeEach, describe, expect, it, vi } from 'vitest'
import { importText } from '@/domain/import/importPipeline'
import { LIMITS } from '@/domain/import/limits'
import { issue } from '@/domain/model'
import { issueTitle, makeTranslator } from '@/i18n/translate'
import { emptyProject, loadProject, useProjectStore } from '@/state/projectStore'
import { importFromFile, importFromText, openProjectFile, reinterpret, useImportStore } from './importFlow'

const client = vi.hoisted(() => ({
  parseText: vi.fn(),
  reparseBytes: vi.fn(),
  importRegions: vi.fn(),
  openProjectText: vi.fn(),
  cancelImports: vi.fn(),
}))
vi.mock('@/workers/importClient', () => client)
const toasts = vi.hoisted(() => [] as { title: string; description?: string; type?: string }[])
vi.mock('@/components/ui/toast', () => ({
  toast: { add: (x: (typeof toasts)[number]) => void toasts.push(x) },
}))

const t = makeTranslator('en')
const MB = 2 ** 20

/** A chosen file: only name, size and the read methods are used. */
function file(name: string, size: number, read: Partial<Pick<File, 'arrayBuffer' | 'text'>> = {}) {
  return {
    name,
    size,
    arrayBuffer: vi.fn(read.arrayBuffer ?? (async () => new ArrayBuffer(8))),
    text: vi.fn(read.text ?? (async () => '{}')),
  } as unknown as File & { arrayBuffer: ReturnType<typeof vi.fn>; text: ReturnType<typeof vi.fn> }
}

const tooLarge = (size: number, limit: number) =>
  issueTitle(t, issue('E_FILE_TOO_LARGE', { size: Math.round((size / MB) * 10) / 10, limit: limit / MB }))

beforeEach(() => {
  toasts.length = 0
  loadProject(emptyProject('Robust'))
  useImportStore.setState({ loading: false, error: null, draft: null, source: null, regionSpec: null })
  for (const f of Object.values(client)) f.mockReset()
  client.parseText.mockImplementation(async (text: string, source) => importText(text, source))
})

describe('file size limits are checked before a file is read', () => {
  it('a data file above the text limit is refused without reading it', async () => {
    const f = file('huge.csv', 30 * MB)
    await importFromFile(t, f)
    expect(f.arrayBuffer).not.toHaveBeenCalled()
    expect(client.reparseBytes).not.toHaveBeenCalled()
    expect(toasts).toEqual([
      expect.objectContaining({ title: tooLarge(30 * MB, LIMITS.maxTextBytes), type: 'error' }),
    ])
    expect(useImportStore.getState().loading).toBe(false)
  })

  it('a workbook is held to the spreadsheet limit, a text file of the same size is read', async () => {
    const book = file('big.xlsx', 22 * MB)
    await importFromFile(t, book)
    expect(book.arrayBuffer).not.toHaveBeenCalled()
    expect(toasts[0]?.title).toBe(tooLarge(22 * MB, LIMITS.maxSheetBytes))

    client.reparseBytes.mockResolvedValue({ ok: false, error: issue('E_EMPTY_INPUT'), warnings: [] })
    const text = file('big.csv', 22 * MB)
    await importFromFile(t, text)
    expect(text.arrayBuffer).toHaveBeenCalled()
  })

  it('a project file above the project limit is refused before the replace question and the read', async () => {
    loadProject({ ...emptyProject('Work'), datasets: [{} as never] })
    const f = file('huge.sciplot', LIMITS.maxProjectBytes + 1)
    await openProjectFile(t, f)
    expect(f.text).not.toHaveBeenCalled()
    expect(client.openProjectText).not.toHaveBeenCalled()
    expect(toasts).toHaveLength(1)
    expect(toasts[0]).toMatchObject({ type: 'error' })
    expect(toasts[0]!.title).toBe(
      issueTitle(t, issue('E_PROJECT_TOO_LARGE', { size: 100, limit: LIMITS.maxProjectBytes / MB })),
    )
    expect(useProjectStore.getState().doc.name).toBe('Work')
  })
})

describe('a failure never leaves the import loading', () => {
  it('a file the browser can no longer read: an explanation, and the loading flag comes down', async () => {
    const f = file('gone.csv', 10, {
      arrayBuffer: async () => Promise.reject(new DOMException('x', 'NotReadableError')),
    })
    await importFromFile(t, f)
    expect(useImportStore.getState().loading).toBe(false)
    expect(toasts).toEqual([
      { title: t('import.readFailed'), description: t('import.readFailedHint'), type: 'error' },
    ])
  })

  it('a project file that cannot be read is reported the same way', async () => {
    const f = file('gone.sciplot', 10, { text: async () => Promise.reject(new Error('gone')) })
    await openProjectFile(t, f)
    expect(client.openProjectText).not.toHaveBeenCalled()
    expect(toasts.map((x) => x.title)).toEqual([t('import.readFailed')])
  })

  it('an exception from the reader is an internal error, not an endless spinner', async () => {
    client.reparseBytes.mockRejectedValue(new Error('boom'))
    await importFromFile(t, file('a.csv', 10))
    expect(useImportStore.getState().loading).toBe(false)
    expect(toasts.map((x) => x.title)).toEqual([issueTitle(t, issue('E_INTERNAL_GUARD', { reason: 'boom' }))])

    toasts.length = 0
    client.parseText.mockRejectedValue(new Error('boom'))
    await importFromText(t, 'x\n1\n')
    expect(useImportStore.getState().loading).toBe(false)
    expect(toasts).toHaveLength(1)
  })

  it('re-reading with other settings: the error shows in the dialog and the loading flag comes down', async () => {
    useImportStore.setState({
      source: { kind: 'text', text: 'x\n1\n', sourceKind: 'clipboard', fileName: null },
      overrides: {},
    })
    client.parseText.mockRejectedValue(new Error('boom'))
    await reinterpret({ delimiter: ';' })
    const s = useImportStore.getState()
    expect(s.loading).toBe(false)
    expect(s.error?.code).toBe('E_INTERNAL_GUARD')
  })
})
