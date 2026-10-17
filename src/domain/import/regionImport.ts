import type * as XLSXNS from 'xlsx'
import {
  NATIVE,
  fail,
  issue,
  ok,
  type Issue,
  type RawRegion,
  type ReasonCode,
  type Result,
  type RowId,
} from '@/domain/model'
import { parseA1Range, sameRange, toGridRange, type GridRange } from './a1'
import { analyseSheet, blockTitle, type DetectedBlock } from './blocks'
import {
  blockLayout,
  buildDraft,
  namesRow,
  sheetContext,
  type ImportDraft,
  type ImportOverrides,
} from './importPipeline'
import { LIMITS, checkFileSize } from './limits'
import { cropRegion, type RegionGrid, type RegionOrientation } from './region'
import {
  formulaNoValueIssue,
  propagateHeaderMerges,
  readWorkbook,
  type NativeColumn,
  type WorkbookGrid,
} from './spreadsheet'
import { baseName, fileExtension, sniffFormat } from './sniff'
import { labelCandidates, labelCells, stackRegions, type LabelSpec, type StackPart } from './stack'

/**
 * Import of blocks cut out of one sheet: the picker's ranges → drafts, through the same
 * buildDraft as whole files. A module of its own so that it ships in the lazy worker chunks only.
 */

/** One block to import: an A1 range of the sheet and how to read it. Row overrides are rows of the block. */
export interface RegionSpec {
  range: string
  orientation: RegionOrientation
  headerRow?: number | null
  unitsRow?: number | null
  dataStartRow?: number
  /**
   * Name of the block (default: its title, else its key/value lines, else its range): its RawRegion label
   * and "Block" label, and in 'separate' mode the dataset name "<file> · <name>".
   */
  name?: string
}

export interface RegionImportSpec {
  sheetName: string
  /** 'separate' = one draft per region; 'stack' = one draft with the rows of every region. */
  mode: 'separate' | 'stack'
  regions: RegionSpec[]
  /** Label columns of a stack (default: the suggested candidates; [] = none). */
  labels?: LabelSpec[]
}

const isRowsOrientation = (r: RegionSpec) => r.orientation === 'rows'

/**
 * Blocks of one sheet → drafts. The sheet is read once, without propagating merges; each region
 * (an A1 range) is cut out, transposed when its variables are in rows (I_BLOCK_TRANSPOSED; the title lines
 * above it are kept as notes), and its own header merges are propagated. 'separate' gives one draft per
 * region; 'stack' gives one draft with label columns (role 'group') and the rows of every region in order
 * (I_STACKED_BLOCKS). Each raw table records its blocks in RawSource.region; sourceRow keeps the real sheet
 * rows (sheet columns for transposed blocks). The row overrides of a region are rows of that region and
 * win over `overrides`, whose other fields do not apply to sheets. An invalid range, no region, or a stack
 * mixing orientations → E_INTERNAL_GUARD (the picker validates first).
 */
export function importRegions(
  bytes: Uint8Array,
  fileName: string,
  spec: RegionImportSpec,
  overrides: ImportOverrides = {},
  deps?: { xlsx?: typeof XLSXNS },
): Result<ImportDraft[]> {
  if (bytes.length === 0) return fail(issue('E_EMPTY_INPUT'))
  const format = sniffFormat(bytes, fileName)
  if (format !== 'xlsx' && format !== 'ods' && format !== 'xls') {
    return fail(
      issue('E_UNSUPPORTED_FORMAT', {
        format: format === 'text' ? fileExtension(fileName) || 'text' : format,
      }),
    )
  }
  const guard = (reason: string) => fail(issue('E_INTERNAL_GUARD', { reason }))
  if (spec.regions.length === 0) return guard('importRegions: no region')
  if (spec.mode === 'stack' && new Set(spec.regions.map(isRowsOrientation)).size > 1)
    return guard('importRegions: a stack mixes orientations')
  const ranges: GridRange[] = []
  for (const r of spec.regions) {
    const range = parseA1Range(r.range)
    if (!range) return guard(`importRegions: invalid range "${r.range}"`)
    ranges.push(range)
  }
  const size = checkFileSize(bytes.length, 'sheet')
  if (size.error) return fail(size.error)
  const fileIssues = size.warning ? [size.warning] : []
  if (!deps?.xlsx) return fail(issue('E_UNSUPPORTED_FORMAT', { format }), fileIssues)
  const read = readWorkbook(deps.xlsx, bytes, {
    sheetName: spec.sheetName,
    maxCells: LIMITS.maxCells,
    propagateMerges: false,
  })
  if (!read.ok) return fail(read.error, [...fileIssues, ...read.warnings])
  const wb = read.value
  const sheet = analyseSheet(wb.grid, { merges: wb.merges, origin: wb.origin, native: wb.native })
  const ctx = sheetContext(format, fileName, bytes.length, wb, fileIssues, overrides)

  const cut = spec.regions.map((r, i) => cutRegion(wb, sheet, ranges[i]!, r))
  const label = (k: number) => spec.regions[k]!.name?.trim() || blockTitle(cut[k]!.block) || null
  const drafts: ImportDraft[] = []

  if (spec.mode === 'separate') {
    for (let k = 0; k < cut.length; k++) {
      const c = cut[k]!
      if (!c.grid) return fail(issue('E_NO_DATA_ROWS', { range: spec.regions[k]!.range }), fileIssues)
      const region: RawRegion = {
        orientation: spec.regions[k]!.orientation,
        blocks: [{ range: c.grid.a1, label: label(k), firstRow: 0, rowCount: c.grid.rows.length }],
        labelColumns: [],
      }
      const d = buildDraft(
        { rows: c.grid.rows, sourceRow: c.grid.sourceRow, native: c.grid.native, sepLineRow: null },
        {
          ...ctx,
          overrides: regionOverrides(overrides, spec.regions[k]!, c.headerGuess),
          readIssues: c.readIssues,
          region,
          notes: c.notes,
          name: `${baseName(fileName)} · ${label(k) ?? c.grid.a1}`,
        },
      )
      // The range as the picker sent it, as for a region outside the grid: it names the region that failed.
      const range = spec.regions[k]!.range
      if (!d.ok) return fail({ ...d.error, params: { ...d.error.params, range } }, d.warnings)
      drafts.push(d.value)
    }
    return ok(drafts)
  }

  // Stack: the layout of every block first (header, units, data rows), then one grid. Its records carry
  // their block's name, so a block named by key/value lines keeps only those that tell it apart.
  const distinct = distinctTitles(cut.map((c) => c.block))
  const stackLabel = (k: number) => spec.regions[k]!.name?.trim() || distinct[k] || label(k)
  const parts: StackPart[] = []
  const notes: string[] = []
  /** Per block: what was read (merges, formulas) and a header that may be wrong. */
  const blockIssues: Issue[][] = []
  for (let k = 0; k < cut.length; k++) {
    const c = cut[k]!
    if (!c.grid) return fail(issue('E_NO_DATA_ROWS', { range: spec.regions[k]!.range }), fileIssues)
    const ov = regionOverrides(overrides, spec.regions[k]!, c.headerGuess)
    const lay = blockLayout(c.grid.rows, c.grid.sourceRow, ov)
    parts.push({ ...c.grid, layout: lay, label: stackLabel(k) })
    for (const n of [...c.notes, ...lay.notes]) notes.push(`${c.grid.a1}: ${n}`)
    blockIssues.push([
      ...c.readIssues.filter((i) => i.code !== 'I_BLOCK_TRANSPOSED'),
      ...lay.issues.filter((i) => i.code === 'W_HEADER_UNCERTAIN'),
    ])
  }
  const blocks = cut.map((c, k) => ({
    titleCells: c.block?.titleCells ?? [],
    titlePos: c.block?.titlePos,
    params: c.block?.params ?? [],
    a1: c.grid!.a1,
    name: spec.regions[k]!.name,
  }))
  const specs = spec.labels ?? labelCandidates(blocks).filter((l) => l.suggested)
  const labels = specs.map((l) => ({ name: l.name, ...labelCells(blocks, l) }))
  const orientation = spec.regions[0]!.orientation
  const stacked = stackRegions(parts, labels, orientation)
  const readIssues: Issue[] = []
  if (orientation === 'rows') {
    readIssues.push(
      issue('I_BLOCK_TRANSPOSED', { range: parts.map((p) => p.a1).join(', '), count: parts.length }),
    )
  }
  // Merge, formula and header warnings of the blocks, with their rows moved to the stacked table.
  readIssues.push(
    ...combineIssues(
      blockIssues.flatMap((list, k) => list.map((i) => ({ issue: i, rowMap: stacked.rowMap[k]! }))),
    ),
  )
  readIssues.push(issue('I_STACKED_BLOCKS', { count: parts.length, labels: labels.length }))
  const d = buildDraft(
    { rows: stacked.rows, sourceRow: stacked.sourceRow, native: stacked.native, sepLineRow: null },
    {
      ...ctx,
      overrides: { headerRow: 0, unitsRow: stacked.unitsRow, dataStartRow: stacked.dataStartRow },
      readIssues,
      region: stacked.region,
      notes,
      name: `${baseName(fileName)} · ${spec.sheetName}`,
    },
  )
  if (!d.ok) return d
  // Label columns tell the blocks apart: role 'group'; a label chosen as text stays text ("0", "2").
  const draft = d.value
  draft.columns = draft.columns.map((col) => {
    const j = col.source.type === 'raw' ? col.source.index : -1
    if (j < 0 || j >= labels.length) return col
    const numericLooking = col.detected.kind === 'numeric' || col.detected.kind === 'datetime'
    return {
      ...col,
      role: 'group',
      uncertaintyOf: null,
      override: labels[j]!.kind === 'text' && numericLooking ? { kind: 'categorical' } : {},
    }
  })
  return ok([draft])
}

const normText = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()

/**
 * Per block of a stack, a name from its title, else from the key/value title lines that differ between
 * the blocks ("Tilt, θ [°] -5" rather than every line above the table); '' when none differ.
 */
function distinctTitles(blocks: readonly (DetectedBlock | null)[]): string[] {
  const titleParams = (b: DetectedBlock | null) => b?.params.filter((p) => p.source === 'title') ?? []
  const textOf = (b: DetectedBlock | null, key: string) =>
    normText(titleParams(b).find((p) => p.key === key)?.text ?? '')
  const keys = new Set(blocks.flatMap((b) => titleParams(b).map((p) => p.key)))
  const varying = [...keys].filter((key) => blocks.some((b) => textOf(b, key) !== textOf(blocks[0]!, key)))
  return blocks.map((b) => {
    const title = b?.titleCells.join(' ').trim()
    if (title) return title
    return titleParams(b)
      .filter((p) => varying.includes(p.key))
      .map((p) => `${p.key} ${p.text}`)
      .join(', ')
  })
}

const SUMMED_PARAMS = new Set(['count', 'header', 'data'])

/**
 * The same warning from several blocks → one warning for the stacked table: counts summed (count, header,
 * data), other params from the first block (W_HEADER_UNCERTAIN's row), rows moved through each block's
 * row map (rows left out of the stack, such as the headers of later blocks, are dropped).
 */
function combineIssues(list: readonly { issue: Issue; rowMap: Int32Array }[]): Issue[] {
  const byCode = new Map<ReasonCode, { params: Record<string, string | number>; rows: Set<number> }>()
  for (const { issue: i, rowMap } of list) {
    let acc = byCode.get(i.code)
    if (!acc) {
      acc = { params: { ...i.params }, rows: new Set() }
      byCode.set(i.code, acc)
    } else {
      for (const [key, v] of Object.entries(i.params ?? {}))
        if (SUMMED_PARAMS.has(key) && typeof v === 'number')
          acc.params[key] = Number(acc.params[key] ?? 0) + v
    }
    for (const r of i.rows ?? []) if (rowMap[r] !== undefined && rowMap[r]! >= 0) acc.rows.add(rowMap[r]!)
  }
  return [...byCode].map(([code, acc]) =>
    issue(code, acc.params, { rows: [...acc.rows].sort((a, b) => a - b) as RowId[] }),
  )
}

interface CutRegion {
  grid: RegionGrid | null
  /** The detected block with exactly this range, else the analysis of the range itself. */
  block: DetectedBlock | null
  notes: string[]
  readIssues: Issue[]
  /**
   * The header row the block analysis found, when the layout heuristics could miss it: the row right after
   * the title lines when it holds names (a title "oak | plank 1" would otherwise pass for a header
   * and the real header for its units row), and the first row of a matrix.
   */
  headerGuess?: number
}

/** Crops one region (transposed for 'rows'), propagates its header merges and collects its issues. */
function cutRegion(
  wb: WorkbookGrid,
  sheet: ReturnType<typeof analyseSheet>,
  sheetRange: GridRange,
  spec: RegionSpec,
): CutRegion {
  const range = toGridRange(sheetRange, wb.origin)
  const block = sheet.detection.blocks.find((b) => sameRange(b.range, range)) ?? sheet.describe(range) ?? null
  const notes: string[] = []
  let body = range
  const transposed = spec.orientation === 'rows'
  // Title lines above a transposed block would become a column: they are kept as notes instead.
  if (transposed && block && block.titleRows > 0 && block.range.r0 >= range.r0) {
    const titleEnd = block.range.r0 + block.titleRows
    for (let r = block.range.r0; r < titleEnd; r++) {
      const line = (wb.grid[r] ?? [])
        .slice(Math.max(range.c0, 0), range.c1 + 1)
        .map((t) => t.trim())
        .filter((t) => t !== '')
        .join(' | ')
      if (line) notes.push(line)
    }
    body = { ...range, r0: titleEnd }
  }
  // Remarks left out of a detected table; a rectangle drawn over them keeps them as data. The notes of a
  // note block are its own cells, imported as data here.
  const table = block?.kind === 'table' || block?.kind === 'matrix'
  if (block && table && sameRange(block.range, range)) notes.push(...block.notes)
  const grid = cropRegion(wb, body, spec.orientation)
  const readIssues: Issue[] = []
  let headerGuess: number | undefined
  if (grid) {
    if (transposed) readIssues.push(issue('I_BLOCK_TRANSPOSED', { range: grid.a1, count: 1 }))
    // The header zone starts after the block's title lines (kept in the crop for 'columns').
    const titleEnd = block && !transposed ? Math.max(0, block.range.r0 + block.titleRows - grid.range.r0) : 0
    const headerEnd = firstValueRow(grid.native, grid.rows.length, titleEnd)
    const merged = propagateHeaderMerges(grid.rows, grid.native, grid.merges, headerEnd, titleEnd)
    if (merged) readIssues.push(merged)
    const formulas = formulaNoValueIssue(grid.formulaCells)
    if (formulas) readIssues.push(formulas)
    if (block && !transposed && titleEnd < grid.rows.length) {
      if (block.kind === 'matrix' || (titleEnd > 0 && namesRow(grid.rows[titleEnd]))) headerGuess = titleEnd
    }
  }
  return { grid, block, notes, readIssues, headerGuess }
}

/** First row at or after `from` holding a number or date (1 past the start when there is none). */
function firstValueRow(native: readonly NativeColumn[], rows: number, from: number): number {
  for (let r = from; r < rows; r++) {
    for (const col of native) {
      const k = col.kind[r]
      if (k === NATIVE.number || k === NATIVE.date) return r
    }
  }
  return from + 1
}

/** Row overrides of one region: its own, else the shared ones, else the header found by the analysis. */
function regionOverrides(
  overrides: ImportOverrides,
  region: RegionSpec,
  headerGuess?: number,
): ImportOverrides {
  const out: ImportOverrides = {}
  for (const k of ['headerRow', 'unitsRow', 'dataStartRow'] as const) {
    const v = region[k] !== undefined ? region[k] : overrides[k]
    if (v !== undefined) (out as Record<string, unknown>)[k] = v
  }
  if (out.headerRow === undefined && headerGuess !== undefined) out.headerRow = headerGuess
  return out
}
