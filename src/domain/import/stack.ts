import { NATIVE, type RawRegion } from '@/domain/model'
import type { DetectedBlock } from './blocks'
import type { LayoutDetection } from './layout'
import { classifyNumberToken } from './numberToken'
import type { NativeColumn } from './spreadsheet'

/**
 * Stacking blocks of the same structure into one dataset: "oak | plank 1", "oak | plank 2"… become one
 * table with label columns (wood, plank) and the rows of every block, each keeping its real sheet row.
 * Proposed to the user, never applied on its own.
 */

/** Where the value of a label column comes from, per block. */
export type LabelSource =
  { type: 'titleCell'; index: number } | { type: 'param'; key: string } | { type: 'blockName' }

export interface LabelSpec {
  source: LabelSource
  /** Column name (its header text: "flow rate (L/min)" carries a unit). */
  name: string
  /** 'number' reads "plank 1" as 1; 'auto' does so when every block follows the same pattern. */
  kind: 'auto' | 'text' | 'number'
}

/** What a block contributes to its labels. */
export type LabelBlock = Pick<DetectedBlock, 'titleCells' | 'titlePos' | 'params' | 'a1'> & { name?: string }

export interface LabelCandidate {
  source: LabelSource
  name: string
  kind: 'text' | 'number'
  /** The value of each block, in order, as it would be written in the label column. */
  values: string[]
  /** Offered as selected: every title or parameter that varies, else the block name. */
  suggested: boolean
}

export interface LabelCell {
  text: string
  /** Set for numeric labels. */
  value: number | null
}

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()

/**
 * Blocks with the same signature have the same variables in the same order: orientation, number of
 * variables and their names (trimmed, spaces collapsed, case ignored, so "Power" = "power ").
 */
export function structureSignature(block: Pick<DetectedBlock, 'orientation' | 'header'>): string {
  return [block.orientation, block.header.length, ...block.header.map(norm)].join('\u001f')
}

interface Numbered {
  prefix: string
  unit: string
  number: string
  value: number
}

const NUMBERED = /^(.*?)\s*([+\-−]?(?:\d+(?:[.,]\d+)?|[.,]\d+)(?:[eE][+\-−]?\d+)?)\s*([^\d\s][^\d]*)?$/u

/**
 * "plank 1" → {prefix "plank", number "1", value 1}; "v = 2 m/s" → prefix "v", unit "m/s". A number
 * glued to a digit before it is part of a date, a time or a range ("2024-03-15", "10:30", "Run 1-2"), never
 * a value of its own: null.
 */
function numbered(text: string): Numbered | null {
  const m = NUMBERED.exec(text.trim())
  if (!m || /\d[-/.:,]?$/.test(m[1]!)) return null
  const tok = classifyNumberToken(m[2]!)
  const value =
    tok.cls === 'neutral' || tok.cls === 'dot' ? tok.dotValue : tok.cls === 'comma' ? tok.commaValue : NaN
  if (!Number.isFinite(value)) return null
  return { prefix: m[1]!.replace(/\s*[:=]\s*$/, '').trim(), unit: (m[3] ?? '').trim(), number: m[2]!, value }
}

/** Every text follows "<same prefix> <number> <same unit>": the shared prefix and unit, else null. */
function commonPattern(
  texts: readonly string[],
): { prefix: string; unit: string; parsed: Numbered[] } | null {
  const parsed: Numbered[] = []
  for (const t of texts) {
    const p = numbered(t)
    if (!p) return null
    if (
      parsed.length > 0 &&
      (norm(p.prefix) !== norm(parsed[0]!.prefix) || norm(p.unit) !== norm(parsed[0]!.unit))
    )
      return null
    parsed.push(p)
  }
  return parsed.length > 0 ? { prefix: parsed[0]!.prefix, unit: parsed[0]!.unit, parsed } : null
}

const varies = (values: readonly string[]) => values.some((v) => norm(v) !== norm(values[0]!))

/**
 * The title cells of the blocks as columns, one text per block ('' where a block has none). Titles with
 * the same number of cells are compared in order; when a block left a cell blank, cells are matched by
 * their place in the title (row, column), so "run 2" under "run 1" is never read as a colour.
 */
function titleColumns(blocks: readonly LabelBlock[]): string[][] {
  const counts = new Set(blocks.map((b) => b.titleCells.length))
  const placed = blocks.every((b) => b.titlePos?.length === b.titleCells.length)
  if (counts.size <= 1 || !placed) {
    const width = Math.max(0, ...counts)
    return Array.from({ length: width }, (_, i) => blocks.map((b) => b.titleCells[i] ?? ''))
  }
  const slots = [...new Set(blocks.flatMap((b) => b.titlePos!.map((p) => `${p.row}:${p.col}`)))]
  const order = (k: string) => k.split(':').map(Number) as [number, number]
  slots.sort((a, b) => order(a)[0] - order(b)[0] || order(a)[1] - order(b)[1])
  return slots.map((slot) =>
    blocks.map((b) => {
      const j = b.titlePos!.findIndex((p) => `${p.row}:${p.col}` === slot)
      return j < 0 ? '' : b.titleCells[j]!
    }),
  )
}

/** Block names: the given name, else the title, else the A1 range; made unique with the range. */
function blockNames(blocks: readonly LabelBlock[]): string[] {
  const names = blocks.map((b) => b.name?.trim() || b.titleCells.join(' ').trim() || b.a1)
  const unique = new Set(names.map(norm)).size === names.length
  return unique ? names : names.map((n, i) => (n === blocks[i]!.a1 ? n : `${n} · ${blocks[i]!.a1}`))
}

/** The cells of one label column, one per block, and the kind it resolves to. */
export function labelCells(
  blocks: readonly LabelBlock[],
  label: LabelSpec,
): { kind: 'text' | 'number'; cells: LabelCell[] } {
  const src = label.source
  if (src.type === 'blockName') {
    return { kind: 'text', cells: blockNames(blocks).map((text) => ({ text, value: null })) }
  }
  if (src.type === 'param') {
    const found = blocks.map((b) => b.params.find((p) => p.key === src.key) ?? null)
    const numeric = found.every((p) => p !== null && p.value !== null)
    const kind = label.kind === 'auto' ? (numeric ? 'number' : 'text') : label.kind
    return {
      kind,
      cells: found.map((p) => ({
        text: p?.text ?? '',
        value: kind === 'number' ? (p?.value ?? null) : null,
      })),
    }
  }
  const texts = titleColumns(blocks)[src.index] ?? blocks.map(() => '')
  const pattern = commonPattern(texts)
  const kind = label.kind === 'auto' ? (pattern ? 'number' : 'text') : label.kind
  if (kind === 'text') return { kind, cells: texts.map((text) => ({ text, value: null })) }
  // A title that does not follow the pattern keeps its text: the column shows it as an invalid number.
  return {
    kind,
    cells: texts.map((text) => {
      const p = numbered(text)
      return p ? { text: p.number, value: p.value } : { text, value: null }
    }),
  }
}

/** Names of label columns that have no name in the sheet (the picker passes them in the UI language). */
export interface LabelNames {
  /** A title-cell position (0-based) whose texts share no prefix; `only` when blocks have one title cell. */
  title: (index: number, only: boolean) => string
  block: string
}

export const LABEL_NAMES: LabelNames = {
  title: (index, only) => (only ? 'Title' : `Title ${index + 1}`),
  block: 'Block',
}

/**
 * Label columns that tell stacked blocks apart: each title-cell position whose text varies (numeric when
 * every block reads "<same prefix> <number>", named after the prefix: "plank" = 1, 2…), each
 * parameter that varies ("layers" = 0, 2, 4), and last the block name (title or A1 range).
 */
export function labelCandidates(
  blocks: readonly LabelBlock[],
  labelNames: LabelNames = LABEL_NAMES,
): LabelCandidate[] {
  if (blocks.length === 0) return []
  const out: LabelCandidate[] = []
  const columns = titleColumns(blocks)
  const titles = columns.length
  for (let i = 0; i < titles; i++) {
    const texts = columns[i]!
    if (!varies(texts)) continue
    const pattern = commonPattern(texts)
    const fallback = labelNames.title(i, titles === 1)
    const name = pattern
      ? `${pattern.prefix || fallback}${pattern.unit ? ` (${pattern.unit})` : ''}`
      : fallback
    const spec: LabelSpec = { source: { type: 'titleCell', index: i }, name, kind: 'auto' }
    const { kind, cells } = labelCells(blocks, spec)
    out.push({ ...spec, kind, values: cells.map((c) => c.text), suggested: true })
  }
  const keys: string[] = []
  for (const b of blocks) for (const p of b.params) if (!keys.includes(p.key)) keys.push(p.key)
  for (const key of keys) {
    const spec: LabelSpec = { source: { type: 'param', key }, name: key, kind: 'auto' }
    const { kind, cells } = labelCells(blocks, spec)
    if (!varies(cells.map((c) => c.text))) continue
    out.push({ ...spec, kind, values: cells.map((c) => c.text), suggested: true })
  }
  const names = blockNames(blocks)
  out.push({
    source: { type: 'blockName' },
    name: labelNames.block,
    kind: 'text',
    values: names,
    suggested: out.length === 0,
  })
  return out
}

/** One block ready to be stacked: its (cropped, possibly transposed) grid and detected layout. */
export interface StackPart {
  rows: readonly (readonly string[])[]
  native: readonly NativeColumn[]
  sourceRow: Int32Array
  layout: Pick<LayoutDetection, 'layout' | 'names' | 'units' | 'used'>
  /** Sheet A1 range of the block, and its name for the provenance (RawRegion). */
  a1: string
  label: string | null
}

export interface StackLabelColumn {
  name: string
  kind: 'text' | 'number'
  /** One per part. */
  cells: readonly LabelCell[]
}

export interface StackedGrid {
  rows: string[][]
  native: NativeColumn[]
  /** Real sheet rows (or sheet columns, for transposed blocks); 0 for a header built from generated names. */
  sourceRow: Int32Array
  headerRow: 0
  unitsRow: 1 | null
  dataStartRow: number
  region: RawRegion
  /** Per part: the stacked row of each of its rows (-1 for title rows and the headers of later parts). */
  rowMap: Int32Array[]
}

/**
 * One grid from several blocks: the label columns first, then the union of the blocks' columns matched by
 * name and unit (case and spacing ignored; a block without a column has empty cells there, never zeros).
 * Header and units rows come from the first block that has each column; then every data row of every
 * block in order, with its own sourceRow and native cells, and its label cells.
 */
export function stackRegions(
  parts: readonly StackPart[],
  labels: readonly StackLabelColumn[],
  orientation: 'columns' | 'rows',
): StackedGrid {
  type Col = { header: string; unit: string; hasUnit: boolean; at: (number | null)[] }
  const cols: Col[] = []
  const byKey = new Map<string, Col>()
  parts.forEach((p, k) => {
    const { layout, names, units, used } = p.layout
    for (let c = 0; c < used.length; c++) {
      if (!used[c]) continue
      const key = `${norm(names[c]!)}\u001f${norm(units[c] ?? '')}`
      let col = byKey.get(key)
      if (!col) {
        const header = layout.headerRow !== null ? (p.rows[layout.headerRow]?.[c] ?? '') : names[c]!
        col = { header: header.trim() === '' ? names[c]! : header, unit: '', hasUnit: false, at: [] }
        byKey.set(key, col)
        cols.push(col)
      }
      if (col.at[k] === undefined) col.at[k] = c
      if (!col.hasUnit && layout.unitsRow !== null) {
        const u = p.rows[layout.unitsRow]?.[c] ?? ''
        if (u.trim() !== '') {
          col.unit = u
          col.hasUnit = true
        }
      }
    }
  })
  const hasUnits = cols.some((c) => c.hasUnit)
  const width = labels.length + cols.length
  const rows: string[][] = []
  const kinds: number[][] = Array.from({ length: width }, () => [])
  const nums: number[][] = Array.from({ length: width }, () => [])
  const src: number[] = []
  const push = (
    texts: string[],
    kind: (j: number) => number,
    num: (j: number) => number,
    sheetRow: number,
  ) => {
    rows.push(texts)
    for (let j = 0; j < width; j++) {
      kinds[j]!.push(texts[j] === '' ? NATIVE.empty : kind(j))
      nums[j]!.push(num(j))
    }
    src.push(sheetRow)
  }
  const first = parts[0]!
  const headerSource =
    first.layout.layout.headerRow !== null ? first.sourceRow[first.layout.layout.headerRow]! : 0
  push(
    [...labels.map((l) => l.name), ...cols.map((c) => c.header)],
    () => NATIVE.text,
    () => NaN,
    headerSource,
  )
  if (hasUnits) {
    const unitsSource =
      first.layout.layout.unitsRow !== null ? first.sourceRow[first.layout.layout.unitsRow]! : 0
    push(
      [...labels.map(() => ''), ...cols.map((c) => c.unit)],
      () => NATIVE.text,
      () => NaN,
      unitsSource,
    )
  }
  const blocks: RawRegion['blocks'][number][] = []
  const rowMap = parts.map((p) => new Int32Array(p.rows.length).fill(-1))
  if (first.layout.layout.headerRow !== null) rowMap[0]![first.layout.layout.headerRow] = 0
  if (hasUnits && first.layout.layout.unitsRow !== null) rowMap[0]![first.layout.layout.unitsRow] = 1
  parts.forEach((p, k) => {
    const firstRow = rows.length
    const { dataStartRow, dataEndRow } = p.layout.layout
    for (let r = dataStartRow; r <= dataEndRow; r++) {
      rowMap[k]![r] = rows.length
      const at = (j: number) => cols[j - labels.length]!.at[k]
      const texts: string[] = []
      for (let j = 0; j < width; j++) {
        if (j < labels.length) texts.push(labels[j]!.cells[k]?.text ?? '')
        else {
          const c = at(j)
          texts.push(c === null || c === undefined ? '' : (p.rows[r]?.[c] ?? ''))
        }
      }
      push(
        texts,
        (j) => {
          if (j < labels.length) return labels[j]!.cells[k]?.value != null ? NATIVE.number : NATIVE.text
          const c = at(j)
          return c == null ? NATIVE.empty : (p.native[c]?.kind[r] ?? NATIVE.text)
        },
        (j) => {
          if (j < labels.length) return labels[j]!.cells[k]?.value ?? NaN
          const c = at(j)
          return c == null ? NaN : (p.native[c]?.num[r] ?? NaN)
        },
        p.sourceRow[r]!,
      )
    }
    blocks.push({ range: p.a1, label: p.label, firstRow, rowCount: rows.length - firstRow })
  })
  const native: NativeColumn[] = kinds.map((k, j) => ({
    kind: Uint8Array.from(k),
    num: Float64Array.from(nums[j]!),
  }))
  return {
    rows,
    native,
    sourceRow: Int32Array.from(src),
    headerRow: 0,
    unitsRow: hasUnits ? 1 : null,
    dataStartRow: hasUnits ? 2 : 1,
    region: { orientation, blocks, labelColumns: labels.map((_, j) => j) },
    rowMap,
  }
}
