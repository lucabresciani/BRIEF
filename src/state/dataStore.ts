import { create } from 'zustand'
import type { RawTable } from '@/domain/model'

/**
 * Immutable imported tables, outside immer and outside undo (they are large and never edited).
 * Nothing is removed during a session, so undo/redo of an import always finds its table.
 */
interface DataState {
  rawTables: Readonly<Record<string, RawTable>>
}

export const useDataStore = create<DataState>(() => ({ rawTables: {} }))

export function addRawTable(table: RawTable): void {
  useDataStore.setState((s) => ({ rawTables: { ...s.rawTables, [table.id]: table } }))
}

export function replaceRawTables(tables: Record<string, RawTable>): void {
  useDataStore.setState({ rawTables: { ...tables } })
}

export function getRawTables(): Readonly<Record<string, RawTable>> {
  return useDataStore.getState().rawTables
}
