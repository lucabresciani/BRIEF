/**
 * Writes the .sciplot project file (UTF-8 JSON, schema version 2). Typed arrays become plain arrays
 * and NaN becomes an explicit null (JSON.stringify would turn a Float64Array into an index-keyed
 * object). Only the raw tables referenced by imported datasets are written; undo patches never are.
 */
import {
  SCHEMA_VERSION,
  issue,
  type Issue,
  type OperationLogEntry,
  type ProjectDoc,
  type ProjectFile,
  type RawTable,
  type RawTableJSON,
  type WorkspaceState,
} from '@/domain/model'
import { toMB } from '@/domain/import/limits'
import { PROJECT_LIMITS } from './schema'

/** On-disk form of a raw table: Int32Array/Uint8Array → number[], Float64Array → number | null (NaN → null). */
export function rawTableToJSON(t: RawTable): RawTableJSON {
  return {
    id: t.id,
    source: { ...t.source },
    rowCount: t.rowCount,
    sourceRow: Array.from(t.sourceRow),
    columns: t.columns.map((c) => ({
      text: Array.from(c.text),
      native: c.native ? { kind: Array.from(c.native.kind), num: nullForNonFinite(c.native.num) } : null,
    })),
    tokenIssues: Array.from(t.tokenIssues),
  }
}

function nullForNonFinite(values: Float64Array): (number | null)[] {
  const out = new Array<number | null>(values.length)
  for (let i = 0; i < values.length; i++) out[i] = Number.isFinite(values[i]) ? values[i] : null
  return out
}

/**
 * Serialises a project. `rawTables` may contain more tables than the document uses (the data store
 * only grows during a session): only those referenced by an imported dataset are written, once each.
 * Pretty-printed with a one-space indent; arrays of primitives (cell text, row ids, native values)
 * stay on one line so that a 2-million-cell table does not cost 2 million indented lines.
 * `workspace` (how the plots are laid out) is written next to the project, never inside it.
 */
export function serializeProject(
  doc: ProjectDoc,
  rawTables: Readonly<Record<string, RawTable>>,
  log: readonly OperationLogEntry[],
  appVersion: string,
  savedAt: string = new Date().toISOString(),
  opts: { workspace?: WorkspaceState | null } = {},
): string {
  const used: string[] = []
  for (const d of doc.datasets)
    if (d.origin === 'import' && !used.includes(d.rawTableId) && Object.hasOwn(rawTables, d.rawTableId))
      used.push(d.rawTableId)
  const file: ProjectFile = {
    format: 'sciplot',
    schemaVersion: SCHEMA_VERSION,
    appVersion,
    savedAt,
    project: doc,
    rawTables: used.map((id) => rawTableToJSON(rawTables[id])),
    operationLog: Array.from(log),
  }
  if (opts.workspace) file.workspace = opts.workspace
  return prettyJSON(file, '') + '\n'
}

/** Exact UTF-8 size of a string (lone surrogates count as U+FFFD, 3 bytes, as TextEncoder writes them). */
export function utf8ByteLength(text: string): number {
  let bytes = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c < 0x80) bytes += 1
    else if (c < 0x800) bytes += 2
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const d = text.charCodeAt(i + 1)
      if (d >= 0xdc00 && d <= 0xdfff) {
        bytes += 4
        i++
      } else bytes += 3
    } else bytes += 3
  }
  return bytes
}

/**
 * W_PROJECT_TOO_LARGE_TO_REOPEN when a serialised project exceeds the size that deserializeProject
 * accepts: a warning at save time rather than a file that cannot be reopened.
 */
export function checkReopenSize(text: string, maxBytes: number = PROJECT_LIMITS.maxBytes): Issue | null {
  if (text.length <= maxBytes / 3) return null
  const bytes = utf8ByteLength(text)
  return bytes > maxBytes
    ? issue('W_PROJECT_TOO_LARGE_TO_REOPEN', { size: toMB(bytes), limit: toMB(maxBytes) })
    : null
}

function isPrimitive(v: unknown): boolean {
  return v === null || typeof v !== 'object'
}

/** JSON.stringify(value, null, 1) except that arrays of primitives are written on one line. */
function prettyJSON(value: unknown, indent: string): string {
  if (isPrimitive(value)) return JSON.stringify(value) ?? 'null'
  if (ArrayBuffer.isView(value)) return prettyJSON(Array.from(value as unknown as ArrayLike<number>), indent)
  const inner = indent + ' '
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    if (value.every(isPrimitive)) return JSON.stringify(value)
    const items = value.map((v) => inner + (v === undefined ? 'null' : prettyJSON(v, inner)))
    return '[\n' + items.join(',\n') + '\n' + indent + ']'
  }
  const entries: string[] = []
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === undefined || typeof v === 'function' || typeof v === 'symbol') continue
    entries.push(inner + JSON.stringify(k) + ': ' + prettyJSON(v, inner))
  }
  return entries.length ? '{\n' + entries.join(',\n') + '\n' + indent + '}' : '{}'
}
