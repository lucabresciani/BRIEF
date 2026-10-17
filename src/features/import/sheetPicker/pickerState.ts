/**
 * The sheet picker's model, pure and testable: which blocks and drawn ranges are selected,
 * how each one is read (name, orientation, header row), the merge proposal and its label columns, and
 * the RegionImportSpec sent to the importer. Grid coordinates are those of the whole-sheet draft's raw
 * table: cell (r, c) is sheet cell (origin.row + r, origin.col + c).
 */
import type { ImportDraft } from '@/domain/import/importPipeline'
import type { RegionImportSpec, RegionSpec } from '@/domain/import/regionImport'
import {
  clipRange,
  formatA1,
  parseA1Range,
  sameRange,
  toGridRange,
  toSheetRange,
  type GridOrigin,
  type GridRange,
} from '@/domain/import/a1'
import { analyseSheet, blockTitle, type BlockKind, type DetectedBlock } from '@/domain/import/blocks'
import {
  labelCandidates,
  structureSignature,
  type LabelCandidate,
  type LabelNames,
  type LabelSource,
  type LabelSpec,
} from '@/domain/import/stack'
import { NATIVE, type NativeKind } from '@/domain/model'

export type Orientation = 'columns' | 'rows'

/** The sheet as the picker reads it, straight from the whole-sheet draft (nothing is copied). */
export interface PickerSheet {
  name: string
  rows: number
  cols: number
  origin: GridOrigin
  /** Merged areas, grid coordinates. */
  merges: GridRange[]
  blocks: DetectedBlock[]
  /** Table and matrix blocks (including any beyond the listed ones), and blocks not listed. */
  tables: number
  overflow: number
  text: (r: number, c: number) => string
  kind: (r: number, c: number) => NativeKind
  /** The native number of a cell (NaN when it is not one). */
  num: (r: number, c: number) => number
  /** 1-based sheet row of grid row r. */
  sheetRow: (r: number) => number
}

const isTable = (k: BlockKind) => k === 'table' || k === 'matrix'

export function pickerSheet(draft: ImportDraft): PickerSheet {
  const raw = draft.rawTable
  const det = draft.detection.sheet
  const origin = det?.origin ?? { row: 0, col: 0 }
  return {
    name: draft.detection.sheetName ?? '',
    rows: raw.rowCount,
    cols: raw.columns.length,
    origin,
    merges: det?.merges ?? [],
    blocks: det?.blocks ?? [],
    tables: det?.tables ?? 0,
    overflow: det?.overflow ?? 0,
    text: (r, c) => raw.columns[c]?.text[r] ?? '',
    kind: (r, c) => (raw.columns[c]?.native?.kind[r] ?? NATIVE.text) as NativeKind,
    num: (r, c) => raw.columns[c]?.native?.num[r] ?? NaN,
    sheetRow: (r) => raw.sourceRow[r] ?? origin.row + r + 1,
  }
}

/** A selected block, or a range the user drew or typed (blockId null). */
export interface PickItem {
  key: string
  blockId: string | null
  /** Grid coordinates. */
  range: GridRange
}

export interface ItemSettings {
  name?: string
  orientation?: Orientation
  /** A row of the block as it is cut (a sheet column for 'rows'); null = no header; absent = detected. */
  headerRow?: number | null
}

export interface LabelChoice {
  on: boolean
  name: string
  kind: LabelSpec['kind']
}

export interface PickerState {
  /** In reading order of their ranges (the order of the merged rows). */
  items: PickItem[]
  /** Block of the last plain or Ctrl/Cmd click: one end of a Shift range. */
  anchor: string | null
  /** The item whose settings are shown. */
  active: string | null
  settings: Readonly<Record<string, ItemSettings>>
  /** Label columns of a merge, by labelKey of their source; absent = the suggestion. */
  labels: Readonly<Record<string, LabelChoice>>
}

export const EMPTY_PICK: PickerState = { items: [], anchor: null, active: null, settings: {}, labels: {} }

export const sheetA1 = (sheet: Pick<PickerSheet, 'origin'>, range: GridRange) =>
  formatA1(toSheetRange(range, sheet.origin))

const blockItem = (b: DetectedBlock): PickItem => ({ key: b.id, blockId: b.id, range: b.range })
const byReading = (a: PickItem, b: PickItem) =>
  a.range.r0 - b.range.r0 || a.range.c0 - b.range.c0 || a.key.localeCompare(b.key)
const sorted = (items: PickItem[]) => [...items].sort(byReading)

function withItems(s: PickerState, items: PickItem[], active: string | null, anchor = s.anchor) {
  const kept = sorted(items)
  const has = (k: string | null) => k !== null && kept.some((i) => i.key === k)
  return {
    ...s,
    items: kept,
    anchor,
    active: has(active) ? active : (kept[kept.length - 1]?.key ?? null),
  }
}

export type ClickMode = 'single' | 'toggle' | 'range'

/**
 * A click on a block (in the sheet or in the list): alone selects it, Ctrl/Cmd adds or removes it, Shift
 * selects from the anchor to it in reading order (the tables between, and both ends).
 */
export function clickBlock(
  s: PickerState,
  sheet: Pick<PickerSheet, 'blocks'>,
  blockId: string,
  mode: ClickMode,
): PickerState {
  const index = sheet.blocks.findIndex((b) => b.id === blockId)
  if (index < 0) return s
  const block = sheet.blocks[index]!
  if (mode === 'toggle') {
    const on = s.items.some((i) => i.key === blockId)
    const items = on ? s.items.filter((i) => i.key !== blockId) : [...s.items, blockItem(block)]
    return withItems(s, items, on ? s.active : blockId, blockId)
  }
  const from = s.anchor === null ? -1 : sheet.blocks.findIndex((b) => b.id === s.anchor)
  if (mode === 'range' && from >= 0) {
    const [a, b] = from <= index ? [from, index] : [index, from]
    const items = sheet.blocks
      .slice(a, b + 1)
      .filter((x, k) => k === 0 || k === b - a || isTable(x.kind))
      .map(blockItem)
    return withItems(s, items, blockId, s.anchor)
  }
  return withItems(s, [blockItem(block)], blockId, blockId)
}

/**
 * A range drawn (drag, Shift+arrows) or typed (A1 field). Clipped to the grid; a range that is exactly a
 * block selects that block. `additive` adds it to the selection, else it replaces the selection.
 */
export function addRange(
  s: PickerState,
  sheet: Pick<PickerSheet, 'blocks' | 'rows' | 'cols' | 'origin'>,
  range: GridRange,
  additive: boolean,
): PickerState {
  const clipped = clipRange(range, sheet.rows, sheet.cols)
  if (!clipped) return s
  const block = sheet.blocks.find((b) => sameRange(b.range, clipped))
  const item: PickItem = block
    ? blockItem(block)
    : { key: `range:${sheetA1(sheet, clipped)}`, blockId: null, range: clipped }
  if (!additive) return withItems(s, [item], item.key, block ? block.id : s.anchor)
  const rest = s.items.filter((i) => i.key !== item.key)
  return withItems(s, [...rest, item], item.key, block ? block.id : s.anchor)
}

/** Ctrl+A: every table and matrix of the sheet. */
export function selectAllTables(s: PickerState, sheet: Pick<PickerSheet, 'blocks'>): PickerState {
  const items = sheet.blocks.filter((b) => isTable(b.kind)).map(blockItem)
  return withItems(s, items, items[0]?.key ?? null, items[0]?.key ?? s.anchor)
}

export const clearSelection = (s: PickerState): PickerState => ({ ...s, items: [], active: null })

export const removeItem = (s: PickerState, key: string): PickerState =>
  withItems(
    s,
    s.items.filter((i) => i.key !== key),
    s.active === key ? null : s.active,
  )

export const keepOnly = (s: PickerState, keys: readonly string[]): PickerState =>
  withItems(
    s,
    s.items.filter((i) => keys.includes(i.key)),
    keys.includes(s.active ?? '') ? s.active : (keys[0] ?? null),
  )

export const setActive = (s: PickerState, key: string): PickerState =>
  s.items.some((i) => i.key === key) ? { ...s, active: key } : s

export function setSettings(s: PickerState, key: string, patch: ItemSettings): PickerState {
  const next = { ...s.settings[key], ...patch }
  // Another orientation cuts another grid: the header row chosen for the old one no longer applies.
  if (
    patch.orientation !== undefined &&
    patch.orientation !== s.settings[key]?.orientation &&
    !('headerRow' in patch)
  )
    delete next.headerRow
  if ('headerRow' in patch && patch.headerRow === undefined) delete next.headerRow
  return { ...s, settings: { ...s.settings, [key]: next } }
}

export const labelKey = (src: LabelSource): string =>
  src.type === 'titleCell'
    ? `titleCell:${src.index}`
    : src.type === 'param'
      ? `param:${src.key}`
      : 'blockName'

export function setLabel(
  s: PickerState,
  candidate: LabelCandidate,
  patch: Partial<LabelChoice>,
): PickerState {
  const key = labelKey(candidate.source)
  const base = s.labels[key] ?? defaultChoice(candidate)
  return { ...s, labels: { ...s.labels, [key]: { ...base, ...patch } } }
}

const defaultChoice = (c: LabelCandidate): LabelChoice => ({ on: c.suggested, name: c.name, kind: 'auto' })

export const labelChoice = (s: PickerState, c: LabelCandidate): LabelChoice =>
  s.labels[labelKey(c.source)] ?? defaultChoice(c)

// ---- reading of one item ----------------------------------------------------------------------------

/** The cells of a range analysed like a block (rectangles drawn by the user); cached per sheet. */
const analyses = new WeakMap<PickerSheet, Map<string, DetectedBlock | null>>()
/** Above this many cells a drawn range is imported as drawn, without analysis in the page. */
const MAX_ANALYSED_CELLS = 250_000
/** Key/value lines up to this many rows above a range give it parameters (blocks.ts: PARAM_GAP + titles). */
const ROWS_ABOVE = 7

export function analyseRange(sheet: PickerSheet, range: GridRange): DetectedBlock | null {
  let cache = analyses.get(sheet)
  if (!cache) analyses.set(sheet, (cache = new Map()))
  const key = `${range.r0},${range.c0},${range.r1},${range.c1}`
  if (cache.has(key)) return cache.get(key)!
  let out: DetectedBlock | null = null
  const area = (range.r1 - range.r0 + 1) * (range.c1 - range.c0 + 1)
  const sub = clipRange({ ...range, r0: range.r0 - ROWS_ABOVE }, sheet.rows, sheet.cols)
  if (sub && area <= MAX_ANALYSED_CELLS) {
    const h = sub.r1 - sub.r0 + 1
    const w = sub.c1 - sub.c0 + 1
    const grid = Array.from({ length: h }, (_, i) =>
      Array.from({ length: w }, (_, j) => sheet.text(sub.r0 + i, sub.c0 + j)),
    )
    const native = Array.from({ length: w }, (_, j) => ({
      kind: Uint8Array.from({ length: h }, (_, i) => sheet.kind(sub.r0 + i, sub.c0 + j)),
      num: Float64Array.from({ length: h }, (_, i) => sheet.num(sub.r0 + i, sub.c0 + j)),
    }))
    const merges = sheet.merges
      .map((m) =>
        clipRange({ r0: m.r0 - sub.r0, c0: m.c0 - sub.c0, r1: m.r1 - sub.r0, c1: m.c1 - sub.c0 }, h, w),
      )
      .filter((m): m is GridRange => m !== null)
    const origin = { row: sheet.origin.row + sub.r0, col: sheet.origin.col + sub.c0 }
    const local = {
      r0: range.r0 - sub.r0,
      c0: range.c0 - sub.c0,
      r1: range.r1 - sub.r0,
      c1: range.c1 - sub.c0,
    }
    const found = analyseSheet(grid, { merges, origin, native }).describe(local)
    if (found) {
      const r = found.range
      out = {
        ...found,
        range: { r0: r.r0 + sub.r0, c0: r.c0 + sub.c0, r1: r.r1 + sub.r0, c1: r.c1 + sub.c0 },
      }
    }
  }
  cache.set(key, out)
  return out
}

export interface ItemInfo {
  item: PickItem
  /** The detected block, or the analysis of the drawn range (null when it was not analysed). */
  block: DetectedBlock | null
  /** 1-based number of the block in the list (reading order); null for a drawn range. */
  number: number | null
  a1: string
  name: string
  /** The name shown when the user has not typed one. */
  defaultName: string
  orientation: Orientation
  detected: Orientation
  confidence: 'high' | 'low'
  headerRow: number | null | undefined
  /** Variable names for this orientation (first row after the titles, or first column). */
  header: string[]
}

export function itemInfo(sheet: PickerSheet, s: PickerState, item: PickItem): ItemInfo {
  const index = item.blockId === null ? -1 : sheet.blocks.findIndex((b) => b.id === item.blockId)
  const block = index >= 0 ? sheet.blocks[index]! : analyseRange(sheet, item.range)
  const set = s.settings[item.key] ?? {}
  const detected = block?.orientation ?? 'columns'
  const orientation = set.orientation ?? detected
  const a1 = sheetA1(sheet, item.range)
  const defaultName = blockTitle(block) || a1
  return {
    item,
    block,
    number: index >= 0 ? index + 1 : null,
    a1,
    name: set.name?.trim() || defaultName,
    defaultName,
    orientation,
    detected,
    confidence: block?.orientationConfidence ?? 'high',
    headerRow: set.headerRow,
    header: block ? headerFor(sheet, block, orientation) : [],
  }
}

/** The variable names of a block read with `orientation` (detection reports them for its own only). */
export function headerFor(sheet: PickerSheet, block: DetectedBlock, orientation: Orientation): string[] {
  if (orientation === block.orientation) return block.header
  const { r0, c0, r1, c1 } = block.range
  const top = r0 + block.titleRows
  const out: string[] = []
  if (orientation === 'rows') for (let r = top; r <= r1; r++) out.push(sheet.text(r, c0).trim())
  else for (let c = c0; c <= c1; c++) out.push(sheet.text(top, c).trim())
  return out
}

/**
 * The rows of an item as it will be cut, for its header-row choice: sheet rows ('columns'), or, for a
 * table read with its variables in rows, the sheet columns (its title rows are left out, as the importer
 * does). `index` is the row of the cut block; `axis` and `pos` say how to name it.
 */
export function headerOptions(
  sheet: PickerSheet,
  info: ItemInfo,
  max = 15,
): { index: number; axis: 'row' | 'column'; pos: string; preview: string }[] {
  const { r0, c0, r1, c1 } = info.item.range
  const out: { index: number; axis: 'row' | 'column'; pos: string; preview: string }[] = []
  const cells = (list: string[]) =>
    list
      .map((t) => t.trim())
      .filter((t) => t !== '')
      .slice(0, 3)
      .join(', ')
  if (info.orientation === 'columns') {
    for (let r = r0; r <= Math.min(r1, r0 + max - 1); r++) {
      const row: string[] = []
      for (let c = c0; c <= c1 && row.length < 6; c++) row.push(sheet.text(r, c))
      out.push({ index: r - r0, axis: 'row', pos: String(sheet.sheetRow(r)), preview: cells(row) })
    }
    return out
  }
  const block = info.block
  const top = block && block.range.r0 >= r0 ? block.range.r0 + block.titleRows : r0
  for (let c = c0; c <= Math.min(c1, c0 + max - 1); c++) {
    const col: string[] = []
    for (let r = top; r <= r1 && col.length < 6; r++) col.push(sheet.text(r, c))
    out.push({
      index: c - c0,
      axis: 'column',
      pos: sheetA1(sheet, { r0: 0, c0: c, r1: 0, c1: c }).replace(/\d+$/, ''),
      preview: cells(col),
    })
  }
  return out
}

// ---- merge proposal and the import request -------------------------------------------------------------

export interface MergeProposal {
  /** The items sharing the largest structure, in reading order. */
  keys: string[]
  /** Their variable names (the first one's). */
  columns: string[]
  /** Every selected item shares it. */
  all: boolean
  /** The selected items mix orientations (the importer cannot stack them). */
  mixed: boolean
}

/** Two or more selected tables with the same variables (structureSignature): a merge is proposed. */
export function mergeProposal(infos: readonly ItemInfo[]): MergeProposal | null {
  if (infos.length < 2) return null
  const groups = new Map<string, ItemInfo[]>()
  for (const i of infos) {
    if (i.header.length === 0) continue
    const sig = structureSignature({ orientation: i.orientation, header: i.header })
    groups.set(sig, [...(groups.get(sig) ?? []), i])
  }
  const best = [...groups.values()].sort((a, b) => b.length - a.length)[0]
  if (!best || best.length < 2) return null
  return {
    keys: best.map((i) => i.item.key),
    columns: best[0]!.header.filter((h) => h !== ''),
    all: best.length === infos.length,
    mixed: new Set(infos.map((i) => i.orientation)).size > 1,
  }
}

/**
 * Label-column candidates of the selected tables (titles and parameters that vary, then the block name);
 * `names` names those the sheet does not name, in the UI language.
 */
export function mergeCandidates(infos: readonly ItemInfo[], names?: LabelNames): LabelCandidate[] {
  return labelCandidates(
    infos.map((i) => ({
      titleCells: i.block?.titleCells ?? [],
      titlePos: i.block?.titlePos,
      params: i.block?.params ?? [],
      a1: i.a1,
      name: i.name,
    })),
    names,
  )
}

function regionOf(info: ItemInfo, s: PickerState): RegionSpec {
  const set = s.settings[info.item.key] ?? {}
  const out: RegionSpec = { range: info.a1, orientation: info.orientation }
  if (set.headerRow !== undefined) out.headerRow = set.headerRow
  if (set.name?.trim()) out.name = set.name.trim()
  return out
}

/**
 * The request for the importer. Only the picker's own settings travel: never the header, units or data
 * rows chosen for the whole sheet. 'stack' sends the label columns as chosen (none = []).
 */
export function toSpec(
  sheet: Pick<PickerSheet, 'name'>,
  s: PickerState,
  infos: readonly ItemInfo[],
  mode: 'separate' | 'stack',
  names?: LabelNames,
): RegionImportSpec {
  const spec: RegionImportSpec = { sheetName: sheet.name, mode, regions: infos.map((i) => regionOf(i, s)) }
  if (mode === 'stack') {
    spec.labels = mergeCandidates(infos, names)
      .map((c) => ({ c, choice: labelChoice(s, c) }))
      .filter(({ choice }) => choice.on)
      .map(({ c, choice }) => ({ source: c.source, name: choice.name.trim() || c.name, kind: choice.kind }))
  }
  return spec
}

/**
 * A request made earlier (Review of a region import) → the selection that produced it: ranges that are
 * blocks select the block, the others are drawn ranges; names, orientations, header rows and labels kept.
 */
export function fromSpec(sheet: PickerSheet, spec: RegionImportSpec, names?: LabelNames): PickerState {
  let s: PickerState = EMPTY_PICK
  for (const r of spec.regions) {
    const range = parseA1Range(r.range)
    if (!range) continue
    s = addRange(s, sheet, toGridRange(range, sheet.origin), true)
    const key = s.active
    if (!key) continue
    const patch: ItemSettings = { orientation: r.orientation }
    if (r.name) patch.name = r.name
    if (r.headerRow !== undefined) patch.headerRow = r.headerRow
    s = setSettings(s, key, patch)
  }
  if (spec.mode === 'stack' && spec.labels) {
    const infos = s.items.map((i) => itemInfo(sheet, s, i))
    for (const c of mergeCandidates(infos, names)) {
      const chosen = spec.labels.find((l) => labelKey(l.source) === labelKey(c.source))
      s = setLabel(s, c, chosen ? { on: true, name: chosen.name, kind: chosen.kind } : { on: false })
    }
  }
  return { ...s, active: s.items[0]?.key ?? null }
}

/** How a block is named in the list and on its chip: its title cells, else its key/value title lines. */
export const blockLabel = (block: Pick<DetectedBlock, 'titleCells' | 'params'>): string =>
  block.titleCells.length ? block.titleCells.join(' · ') : blockTitle(block)

/**
 * A table without a title, in the list: its first variable names ("t (s), x (m), v (m/s), …"),
 * which tell such tables apart better than "Untitled"; '' when it has none.
 */
export function headerSummary(block: Pick<DetectedBlock, 'header'>, max = 3): string {
  const names = block.header.map((h) => h.trim()).filter((h) => h !== '')
  return names.slice(0, max).join(', ') + (names.length > max ? ', …' : '')
}

/** "3 · birch · plank 1": the block's number in the list, then its name, else its range. */
export function chipText(block: Pick<DetectedBlock, 'titleCells' | 'params' | 'a1'>, number: number): string {
  return `${number} · ${blockLabel(block) || block.a1}`
}

/** The block at a cell (the first in reading order whose range holds it). */
export function blockAt(sheet: Pick<PickerSheet, 'blocks'>, r: number, c: number): DetectedBlock | null {
  for (const b of sheet.blocks)
    if (r >= b.range.r0 && r <= b.range.r1 && c >= b.range.c0 && c <= b.range.c1) return b
  return null
}

/** The used part of the sheet as an A1 range (for the range field's message). */
export const usedA1 = (sheet: PickerSheet) =>
  sheetA1(sheet, { r0: 0, c0: 0, r1: Math.max(0, sheet.rows - 1), c1: Math.max(0, sheet.cols - 1) })

/** A1 text typed by the user → grid range, or why not ('invalid' | 'outside' | 'empty'). */
export function parseTypedRange(
  sheet: PickerSheet,
  text: string,
): { ok: true; range: GridRange } | { ok: false; reason: 'invalid' | 'outside' | 'empty' } {
  const parsed = parseA1Range(text)
  if (!parsed) return { ok: false, reason: 'invalid' }
  const clipped = clipRange(toGridRange(parsed, sheet.origin), sheet.rows, sheet.cols)
  if (!clipped) return { ok: false, reason: 'outside' }
  for (let r = clipped.r0; r <= clipped.r1; r++)
    for (let c = clipped.c0; c <= clipped.c1; c++)
      if (sheet.text(r, c).trim() !== '') return { ok: true, range: clipped }
  return { ok: false, reason: 'empty' }
}
