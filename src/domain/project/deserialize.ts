/**
 * Opens a .sciplot file. Order matters: size → JSON.parse, then prototype-polluting keys
 * dropped at every depth → format → version (a newer schema is refused WITHOUT parsing it) →
 * migration of an older schema (migrate.ts, reported as I_PROJECT_MIGRATED) → zod → referential
 * integrity (broken references repaired, reported as W_PROJECT_REPAIRED). Never throws: every
 * problem becomes an issue, and the current project of the caller stays untouched because nothing
 * is merged into existing objects.
 */
import type { z } from 'zod'
import {
  SCHEMA_VERSION,
  fail,
  issue,
  ok,
  type Issue,
  type OperationLogEntry,
  type ProjectCode,
  type ProjectDoc,
  type RawTable,
  type RawTableId,
  type Result,
  type WorkspaceState,
} from '@/domain/model'
import { toMB } from '@/domain/import/limits'
import { cascadeRemoval, repairRefs } from '@/domain/model/integrity'
import { migrateProjectJSON } from './migrate'
import { PROJECT_LIMITS, ProjectFileSchema, type RawTableJSONSchema } from './schema'
import { utf8ByteLength } from './serialize'

export interface DeserializedProject {
  doc: ProjectDoc
  /** Keyed by RawTableId; typed arrays restored, null → NaN in native numeric values. */
  rawTables: Record<string, RawTable>
  log: OperationLogEntry[]
  /** Saved layout of the plots; null when the file has none (v1 files, nothing laid out yet). */
  workspace: WorkspaceState | null
  /**
   * What was done to the file to open it, also in the result warnings: I_PROJECT_MIGRATED {from, to}
   * when it came from an older schema, W_PROJECT_REPAIRED {count} when broken references were repaired.
   */
  repaired: Issue[]
  /** File metadata, e.g. to tell the user which app version saved the project. */
  meta: { appVersion: string; savedAt: string }
}

export type ProjectLoadErrorCode = Extract<ProjectCode, `E_${string}`>

const FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype'] as const

/**
 * Deletes "__proto__" / "constructor" / "prototype" keys at every depth, in place, before anything
 * else reads the parsed value. JSON.parse stores "__proto__" as a harmless OWN property, which
 * becomes dangerous only when copied with Object.assign or a deep merge. Same effect as a JSON.parse
 * reviver, but a reviver is called for every value (≈ 11× slower on a 2-million-cell project);
 * this walk only descends into objects. Iterative: no recursion limit on deep input.
 */
function dropForbiddenKeys(root: unknown): void {
  const stack: unknown[] = [root]
  while (stack.length) {
    const v = stack.pop()
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        const e: unknown = v[i]
        if (e !== null && typeof e === 'object') stack.push(e)
      }
    } else if (v !== null && typeof v === 'object') {
      const o = v as Record<string, unknown>
      for (const k of FORBIDDEN_KEYS) if (Object.hasOwn(o, k)) delete o[k]
      for (const k of Object.keys(o)) {
        const e = o[k]
        if (e !== null && typeof e === 'object') stack.push(e)
      }
    }
  }
}

const MAX_PROBLEMS = 5

function formatPath(path: readonly PropertyKey[]): string {
  let out = ''
  for (const p of path)
    out +=
      typeof p === 'number'
        ? `[${p}]`
        : typeof p === 'string' && /^[A-Za-z_$][\w$]*$/.test(p)
          ? (out ? '.' : '') + p
          : `[${JSON.stringify(String(p))}]`
  return out || '(root)'
}

/** At most five problems, "path: message", then how many more there are. */
function summarize(issues: readonly z.core.$ZodIssue[]): string {
  const shown = issues.slice(0, MAX_PROBLEMS).map((i) => `${formatPath(i.path)}: ${i.message}`)
  const more = issues.length - shown.length
  return shown.join('; ') + (more > 0 ? `; … ${more} more` : '')
}

/** Raw table from its validated on-disk form: number[] → Int32Array / Uint8Array, null → NaN. */
export function rawTableFromJSON(t: z.infer<typeof RawTableJSONSchema>): RawTable {
  return {
    id: t.id as RawTableId,
    source: t.source,
    rowCount: t.rowCount,
    sourceRow: Int32Array.from(t.sourceRow),
    columns: t.columns.map((c) => ({
      text: c.text,
      native: c.native
        ? { kind: Uint8Array.from(c.native.kind), num: Float64Array.from(c.native.num, (v) => v ?? NaN) }
        : null,
    })),
    tokenIssues: t.tokenIssues as Issue[],
  }
}

/**
 * References into the raw tables, which checkRefs (document only) cannot see: an imported dataset
 * whose table is missing or empty is unusable and removed with everything that refers to it;
 * layout rows past the end of the table are clamped. Returns the number of repairs.
 */
function repairRawRefs(doc: ProjectDoc, rawTables: Readonly<Record<string, RawTable>>): number {
  let repairs = 0
  for (const d of [...doc.datasets]) {
    if (d.origin !== 'import') continue
    const raw = Object.hasOwn(rawTables, d.rawTableId) ? rawTables[d.rawTableId] : null
    if (!raw || raw.rowCount === 0) {
      repairs += cascadeRemoval(doc, { kind: 'dataset', id: d.id })
      continue
    }
    const last = raw.rowCount - 1
    const l = d.layout
    if (l.headerRow !== null && l.headerRow > last) {
      l.headerRow = null
      repairs++
    }
    if (l.unitsRow !== null && l.unitsRow > last) {
      l.unitsRow = null
      repairs++
    }
    if (l.dataEndRow > last) {
      l.dataEndRow = last
      repairs++
    }
  }
  return repairs
}

function loadError(
  code: ProjectLoadErrorCode,
  params?: Issue['params'],
): Result<never, ProjectLoadErrorCode> {
  return fail({ ...issue(code, params), code })
}

const errorText = (e: unknown) => String(e instanceof Error ? e.message : e).slice(0, 200)

/** Parses, validates and repairs a project file. See the module comment for the order of the checks. */
export function deserializeProject(
  text: string,
  opts?: { maxBytes?: number },
): Result<DeserializedProject, ProjectLoadErrorCode> {
  const maxBytes = opts?.maxBytes ?? PROJECT_LIMITS.maxBytes
  // UTF-8 size ≥ UTF-16 length, and ≤ 3 × it: the exact count is needed only in between.
  if (text.length > maxBytes || (text.length > maxBytes / 3 && utf8ByteLength(text) > maxBytes))
    return loadError('E_PROJECT_TOO_LARGE', { size: toMB(utf8ByteLength(text)), limit: toMB(maxBytes) })

  let json: unknown
  try {
    // A UTF-8 BOM (added by some editors) is not JSON whitespace.
    json = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
  } catch (e) {
    return loadError('E_PROJECT_NOT_JSON', { detail: errorText(e) })
  }
  dropForbiddenKeys(json)

  if (typeof json !== 'object' || json === null || Array.isArray(json))
    return loadError('E_PROJECT_NOT_SCIPLOT')
  const head = json as { format?: unknown; schemaVersion?: unknown }
  if (head.format !== 'sciplot') return loadError('E_PROJECT_NOT_SCIPLOT')
  const v = head.schemaVersion
  if (typeof v === 'number' && Number.isInteger(v) && v > SCHEMA_VERSION)
    return loadError('E_PROJECT_NEWER_VERSION', { v })

  try {
    const migrated = migrateProjectJSON(json)
    const from = migrated.from !== null && migrated.from < SCHEMA_VERSION ? migrated.from : null
    const parsed = ProjectFileSchema.safeParse(migrated.json)
    if (!parsed.success)
      return loadError('E_PROJECT_INVALID', {
        summary: summarize(parsed.error.issues),
        count: parsed.error.issues.length,
      })
    const file = parsed.data

    const rawTables: Record<string, RawTable> = {}
    for (const t of file.rawTables) rawTables[t.id] = rawTableFromJSON(t)
    // Same shape as ProjectDoc up to the id brands (enforced at compile time in schema.ts).
    const doc = file.project as unknown as ProjectDoc
    const log = file.operationLog as unknown as OperationLogEntry[]
    const workspace = (file.workspace ?? null) as WorkspaceState | null

    const repairs = repairRawRefs(doc, rawTables) + repairRefs(doc)
    const repaired: Issue[] = []
    if (from !== null) repaired.push(issue('I_PROJECT_MIGRATED', { from, to: SCHEMA_VERSION }))
    if (repairs > 0) repaired.push(issue('W_PROJECT_REPAIRED', { count: repairs }))
    const meta = { appVersion: file.appVersion, savedAt: file.savedAt }
    return ok({ doc, rawTables, log, workspace, repaired, meta }, repaired)
  } catch (e) {
    // Defensive: the checks above are total, but a damaged file must never crash the app.
    return loadError('E_PROJECT_INVALID', { summary: `unexpected error: ${errorText(e)}`, count: 1 })
  }
}
