/**
 * Brings project data saved by an older schema up to SCHEMA_VERSION, for .sciplot files (before zod)
 * and for IndexedDB records (which are never validated). Pure, total and idempotent: it never
 * throws, never mutates its input and only ADDS fields that are missing, each with the value that
 * reproduces how the old version behaved. A field that is present is left alone, even when
 * malformed, and anything not shaped as expected is passed through unchanged: judging the result is
 * the job of the schema (files) or of repairRefs (records), never of the migration.
 *
 * 1 → 2: plots get a name ('' = automatic label) and per-group options (all off), series a split
 * (null = one curve), fits a style (following the series, as before) and perGroup = false, log
 * entries a plotId (null = unknown). Raw tables need nothing: RawSource.region is optional.
 */
import { DEFAULT_FIT_STYLE, SCHEMA_VERSION } from '@/domain/model'

type Json = Record<string, unknown>

const isRecord = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Copy of `o` with every missing (absent or undefined) field set; `o` itself when nothing is missing. */
function fill(o: Json, defaults: Readonly<Record<string, () => unknown>>): Json {
  let out: Json | null = null
  for (const key of Object.keys(defaults))
    if (!Object.hasOwn(o, key) || o[key] === undefined) {
      out ??= { ...o }
      out[key] = defaults[key]()
    }
  return out ?? o
}

/** Applies `f` to the record items of `list`; the same array when no item changed. */
function mapRecords(list: unknown, f: (item: Json) => Json): unknown {
  if (!Array.isArray(list)) return list
  let changed = false
  const out = list.map((item: unknown) => {
    if (!isRecord(item)) return item
    const next = f(item)
    if (next !== item) changed = true
    return next
  })
  return changed ? out : list
}

/** Replaces the field `key` of `o` with `f(o[key])` when the field is a record (copy on change). */
function inField(o: Json, key: string, f: (v: Json) => Json): Json {
  const v = o[key]
  if (!isRecord(v)) return o
  const next = f(v)
  return next === v ? o : { ...o, [key]: next }
}

function inList(o: Json, key: string, f: (v: Json) => Json): Json {
  const v = o[key]
  const next = mapRecords(v, f)
  return next === v ? o : { ...o, [key]: next }
}

const PLOT_V2 = { name: () => '' }
const SERIES_V2 = { split: () => null }
const HISTOGRAM_V2 = { groupBy: () => null, groupMode: () => 'overlay' }
const BOX_V2 = { colorByGroup: () => false }
const BAR_V2 = { colorByCategory: () => false }
const FIT_V2 = {
  style: () => ({ ...DEFAULT_FIT_STYLE, color: { ...DEFAULT_FIT_STYLE.color } }),
  perGroup: () => false,
}
const LOG_V2 = { plotId: () => null }

function plotV2(p: Json): Json {
  let out = fill(p, PLOT_V2)
  out = inList(out, 'series', (s) => fill(s, SERIES_V2))
  out = inField(out, 'histogram', (h) => fill(h, HISTOGRAM_V2))
  out = inField(out, 'box', (b) => fill(b, BOX_V2))
  return inField(out, 'bar', (b) => fill(b, BAR_V2))
}

/** A ProjectDoc saved by schema `from`, completed to the current schema. */
export function migrateDoc(doc: unknown, from: number): unknown {
  if (!(from < SCHEMA_VERSION) || !isRecord(doc)) return doc
  let out = inList(doc, 'plots', plotV2)
  out = inList(out, 'fits', (f) => fill(f, FIT_V2))
  return out
}

/** An operation log saved by schema `from`, completed to the current schema. */
export function migrateLog(log: unknown, from: number): unknown {
  if (!(from < SCHEMA_VERSION)) return log
  return mapRecords(log, (e) => fill(e, LOG_V2))
}

/**
 * A parsed .sciplot file brought to the current schema. `from` is the version the file declared
 * (null when it declares none, or not an integer). Only version 1 is migrated; any other version is
 * returned unchanged, so that the schema refuses what it does not know.
 */
export function migrateProjectJSON(json: unknown): { json: unknown; from: number | null } {
  if (!isRecord(json)) return { json, from: null }
  const v = json.schemaVersion
  const from = typeof v === 'number' && Number.isInteger(v) ? v : null
  if (from !== 1) return { json, from }
  const out: Json = { ...json, schemaVersion: SCHEMA_VERSION }
  if (Object.hasOwn(json, 'project')) out.project = migrateDoc(json.project, from)
  if (Object.hasOwn(json, 'operationLog')) out.operationLog = migrateLog(json.operationLog, from)
  return { json: out, from }
}
