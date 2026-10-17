import type { Issue } from '@/domain/model'
import { en } from './en'
import { it } from './it'

export type Lang = 'en' | 'it'
export type TParams = Readonly<Record<string, string | number>>

/** Same shape as the source dictionary, with every string literal widened to string. */
export type Widen<T> = T extends string
  ? string
  : T extends readonly (infer U)[]
    ? readonly Widen<U>[]
    : { [K in keyof T]: Widen<T[K]> }

type Leaves<T, P extends string = ''> = T extends string
  ? P
  : T extends readonly unknown[]
    ? P
    : { [K in keyof T & string]: Leaves<T[K], P extends '' ? K : `${P}.${K}`> }[keyof T & string]

/** Every translatable key, checked at compile time. */
export type TKey = Leaves<typeof en>

export const DICTIONARIES: Record<Lang, Widen<typeof en>> = { en, it }

/** Index of the '}' that closes the '{' at `open` (nested braces counted); -1 when unbalanced. */
function closingBrace(s: string, open: number): number {
  let depth = 0
  for (let i = open; i < s.length; i++) {
    if (s[i] === '{') depth++
    else if (s[i] === '}' && --depth === 0) return i
  }
  return -1
}

/** Splits the options of a form at the '|' that are not inside a nested {…}. */
function splitOptions(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '{') depth++
    else if (s[i] === '}') depth--
    else if (s[i] === '|' && depth === 0) {
      out.push(s.slice(start, i))
      start = i + 1
    }
  }
  out.push(s.slice(start))
  return out
}

const FORM = /^(\w+)(?:\|([^]*))?$/
const SELECT_OPTION = /^(\w+)=([^]*)$/

/** Text of one {…} form, or null when it cannot be filled (the form is then kept as written). */
function expand(body: string, params: TParams): string | null {
  const m = FORM.exec(body)
  if (!m || !(m[1] in params)) return null
  const value = params[m[1]]
  if (m[2] === undefined) return String(value)
  const options = splitOptions(m[2])
  const select = options.map((o) => SELECT_OPTION.exec(o))
  if (select.every((o) => o !== null)) {
    const hit = select.find((o) => o[1] === String(value)) ?? select.find((o) => o[1] === 'other')
    return hit ? interpolate(hit[2], params) : null
  }
  if (options.length < 2) return null
  return interpolate(Number(value) === 1 ? options[0] : options.slice(1).join('|'), params)
}

/**
 * {name} → value.
 * {name|one|other} → "one" when the value is 1, otherwise "other" (a minimal plural form that covers
 * English and Italian count phrases).
 * {name|a=text|b=text|other=text} → the text whose label equals the value, else the 'other' text (select;
 * every option is label=text).
 * Option texts may hold further placeholders; parameter values are inserted as they are and never read
 * as templates. A form whose parameter is absent (or a select without a matching label) is kept as
 * written, so a missing value stays visible.
 */
export function interpolate(template: string, params?: TParams): string {
  if (!params || !template.includes('{')) return template
  let out = ''
  let i = 0
  while (i < template.length) {
    const open = template.indexOf('{', i)
    if (open < 0) break
    out += template.slice(i, open)
    const close = closingBrace(template, open)
    const text = close < 0 ? null : expand(template.slice(open + 1, close), params)
    if (text === null) {
      // Not a fillable form: keep the brace and look for placeholders inside it.
      out += '{'
      i = open + 1
    } else {
      out += text
      i = close + 1
    }
  }
  return out + template.slice(i)
}

function lookup(dict: unknown, key: string): unknown {
  let node: unknown = dict
  const parts = key.split('.')
  for (let i = 0; i < parts.length; i++) {
    if (!node || typeof node !== 'object') return undefined
    const obj = node as Record<string, unknown>
    if (parts[i] in obj) node = obj[parts[i]]
    else {
      // A key that holds dots is looked up whole: history.ops['plot.remove'] (the operation kind).
      const rest = parts.slice(i).join('.')
      return rest in obj ? obj[rest] : undefined
    }
  }
  return node
}

export type Translator = ((key: TKey | (string & {}), params?: TParams) => string) & { lang: Lang }

/** Missing keys fall back to English, then to the key itself (visible in development). */
export function makeTranslator(lang: Lang): Translator {
  const dict = DICTIONARIES[lang]
  const fn = ((key: string, params?: TParams) => {
    const v = lookup(dict, key) ?? lookup(en, key)
    if (typeof v !== 'string') {
      if (import.meta.env?.DEV) console.warn(`[i18n] missing key ${key}`)
      return key
    }
    return interpolate(v, params)
  }) as Translator
  fn.lang = lang
  return fn
}

/** String array entries (e.g. walkthrough steps). */
export function tList(lang: Lang, key: string): readonly string[] {
  const v = lookup(DICTIONARIES[lang], key) ?? lookup(en, key)
  return Array.isArray(v) ? (v as string[]) : []
}

/**
 * Maps a RowId to the position shown to the user: the file line or sheet row, the sheet column of a
 * transposed table ("D"), with the table it came from in a stacked dataset. `axis` says which of the two
 * the labels are; issue texts read it as {axis|column=…|other=…}.
 */
export type RowLabeler = ((rowId: number) => string | number) & { axis?: 'row' | 'column' }

type IssueLike = Pick<Issue, 'code' | 'params'> & { rows?: readonly number[] }

export function issueTitle(t: Translator, i: IssueLike, rowLabel?: RowLabeler): string {
  return t(`issues.${i.code}.title`, formatIssueParams(i, rowLabel, t.lang))
}
export function issueHint(t: Translator, i: IssueLike, rowLabel?: RowLabeler): string {
  return t(`issues.${i.code}.hint`, formatIssueParams(i, rowLabel, t.lang))
}

const MAX_LISTED_ROWS = 8

const DECIMAL_MARK: Record<Lang, string> = { en: '.', it: ',' }

/**
 * A number parameter as the language writes it: a number written with a decimal point gets the
 * language's decimal mark ("12,71", "1,5e+21" in Italian). Numbers written without one (counts, row
 * numbers, n, df) are returned unchanged, so plural forms still read them.
 */
function localNumber(v: number, lang: Lang | undefined): string | number {
  const s = String(v)
  if (!s.includes('.')) return v
  const mark = DECIMAL_MARK[lang ?? 'en'] ?? '.'
  return mark === '.' ? s : s.replace('.', mark)
}

/**
 * Issue.params for the messages: numbers in the language's notation (localNumber), lists joined with
 * ", ", {rows} filled from Issue.rows (as file row numbers) when the domain could not know them, and
 * {axis} ('row' unless the domain or the row labeler says 'column'), so a text can always select on it.
 */
function formatIssueParams(i: IssueLike, rowLabel?: RowLabeler, lang?: Lang): TParams | undefined {
  const out: Record<string, string | number> = {}
  for (const [k, v] of Object.entries(i.params ?? {}))
    out[k] = Array.isArray(v) ? (v as unknown[]).join(', ') : typeof v === 'number' ? localNumber(v, lang) : v
  if (out.rows === undefined && i.rows?.length) {
    const labels = i.rows.slice(0, MAX_LISTED_ROWS).map((r) => (rowLabel ? rowLabel(r) : r + 1))
    out.rows = labels.join(', ') + (i.rows.length > MAX_LISTED_ROWS ? ', …' : '')
    if (out.axis === undefined && rowLabel?.axis) out.axis = rowLabel.axis
  }
  out.axis ??= 'row'
  return out
}
