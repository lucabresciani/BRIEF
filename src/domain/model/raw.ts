import type { RawTableId } from './ids'
import type { Issue } from './issues'

/**
 * The imported table exactly as read. IMMUTABLE after import: never edited, never part of undo,
 * kept outside immer. Everything the app shows is derived from it plus the user's settings.
 */
export type SourceKind = 'csv' | 'tsv' | 'text' | 'clipboard' | 'xlsx' | 'xls' | 'ods' | 'example'
export type TextEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252'
export type Delimiter = '\t' | ';' | ',' | '|' | 'none'

/**
 * Provenance of a table cut out of a sheet: the A1 range of each block, its label, and where its
 * rows start in the table. 'rows' = the blocks were transposed (variables in rows on the sheet).
 */
export interface RawRegion {
  readonly orientation: 'columns' | 'rows'
  readonly blocks: readonly {
    readonly range: string
    readonly label: string | null
    readonly firstRow: number
    readonly rowCount: number
  }[]
  /** Positional columns of the table that hold the block labels. */
  readonly labelColumns: readonly number[]
}

export interface RawSource {
  readonly kind: SourceKind
  readonly fileName: string | null
  readonly sheetName: string | null
  readonly encoding: TextEncoding | null
  readonly delimiter: Delimiter | null
  readonly byteSize: number | null
  readonly importedAt: string
  /** Only for tables cut out of a sheet; absent on whole-sheet and text imports (and on v1 tables). */
  readonly region?: RawRegion
}

/** Cell kinds for spreadsheet sources (no enum: erasableSyntaxOnly). */
export const NATIVE = { empty: 0, number: 1, date: 2, boolean: 3, error: 4, text: 5 } as const
export type NativeKind = (typeof NATIVE)[keyof typeof NATIVE]

export interface RawColumn {
  /** Text exactly as imported ('' = empty). Spreadsheets: formatted text w ?? String(v). */
  readonly text: readonly string[]
  /** Spreadsheets only: the native cell kind and numeric value v (never the formatted w). Dates = epoch ms UTC. */
  readonly native: { readonly kind: Uint8Array; readonly num: Float64Array } | null
}

export interface RawTable {
  readonly id: RawTableId
  readonly source: RawSource
  /** All rows of the grid, including header/preamble/blank rows. */
  readonly rowCount: number
  /** Number shown to the user for each grid row: 1-based physical line in the file / row in the sheet. */
  readonly sourceRow: Int32Array
  /** Positional columns; short rows are padded with ''. */
  readonly columns: readonly RawColumn[]
  /** Problems found while tokenising (ragged rows, quotes, encoding…). */
  readonly tokenIssues: readonly Issue[]
}
