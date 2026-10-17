declare const brand: unique symbol
export type Brand<T, B extends string> = T & { readonly [brand]: B }

export type ProjectId = Brand<string, 'ProjectId'>
export type DatasetId = Brand<string, 'DatasetId'>
export type RawTableId = Brand<string, 'RawTableId'>
export type ColumnId = Brand<string, 'ColumnId'>
export type PlotId = Brand<string, 'PlotId'>
export type SeriesId = Brand<string, 'SeriesId'>
export type FitId = Brand<string, 'FitId'>
export type ExclusionId = Brand<string, 'ExclusionId'>
export type FilterId = Brand<string, 'FilterId'>

/**
 * Stable row identity, never reused.
 * Imported datasets: 0-based index of the row in the tokenised grid (RawTable).
 * Notebook datasets: a monotonic counter.
 * It is NOT the row number shown to users: that is RawTable.sourceRow[rowId] (1-based, as in the file).
 */
export type RowId = Brand<number, 'RowId'>

let counter = 0
/** Short unique id; deterministic prefix keeps ids readable in project files. */
export function newId<T extends string>(prefix: string): Brand<string, T> {
  counter = (counter + 1) % 1_000_000
  const rnd =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.floor(Math.random() * 0xffffffff)
          .toString(16)
          .padStart(8, '0')
  return `${prefix}_${rnd}${counter.toString(36)}` as Brand<string, T>
}

export const asRowId = (n: number) => n as RowId
