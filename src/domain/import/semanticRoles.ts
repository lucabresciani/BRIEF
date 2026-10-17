import type { ColumnKind, ColumnRole } from '@/domain/model'

/**
 * Suggested column roles from names. These are ONLY suggestions shown in the
 * import preview — never applied to an analysis by themselves — used e.g. to keep "u(y)" out of the
 * default y axis.
 *
 * Uncertainty: GUM-style "u(y)", "u_y", "σ", "σ_y", "sigma", "err", "error", "y_err", "±", "δy", "dy" (only
 * when a column "y" exists), "unc", "uncertainty", "SD", "SEM" and their Italian forms. Δ is NEVER read as an
 * uncertainty: "ΔT (K)" is a temperature difference. An explicit reference (u(y)) points at the column
 * named y; a generic name (σ, err) points at the nearest numeric measurement column on its left.
 * Guards against physical symbols: "U_C" is a voltage (the "u_" prefix is lower case and needs an existing
 * column), "Se" is selenium (SE/se/SD/sd only in one case), and a symbol (σ, sigma, δ, d…) or a generic
 * name is accepted only when its unit is compatible with the referenced column — the same unit, none, or
 * '%' — so "σ (MPa)" next to "ε (%)" is a stress and "sigma (S/m)" next to "T (K)" a conductivity.
 * Group: categorical columns ("observer", "group", "sample"). Identifier: "trial", "id", "#", "run",
 * "replicate" with integer values. Everything else: measurement.
 */
export interface RoleInput {
  name: string
  unit: string | null
  kind: ColumnKind
  /** All valid values are integers (when known). Identifiers need integer values; unknown counts as yes. */
  integerValued?: boolean
  /** The values count up by one in row order (1, 2, 3…). A bare "n"/"N" is a row counter only then. */
  consecutive?: boolean
}

export interface RoleSuggestion {
  role: ColumnRole
  /** Index (in the input array) of the column this one is the uncertainty of; null when unknown. */
  uncertaintyOf: number | null
}

const UNC_WORD =
  'σ|sigma|sd|s\\.d\\.|std|stdev|std\\.?\\s*dev\\.?|err|err\\.|error|errors|errore|errori|unc|unc\\.|uncert\\.?|uncertainty|incertezza|incert\\.?|sem|s\\.e\\.m?\\.?|se|std\\.?\\s*err(?:or)?|standard\\s+error|standard\\s+deviation|standard\\s+uncertainty|deviazione\\s+standard|dev\\.?\\s*std\\.?|errore\\s+standard|incertezza\\s+tipo|±|\\+/-|\\+-'

/** Generic uncertainty names without a reference: "σ", "err", "SD", "uncertainty", "±". */
const GENERIC_RE = new RegExp(`^(?:${UNC_WORD})$`, 'i')
/** Generic names that are also physical symbols (stress, conductivity, cross-section…). */
const SYMBOL_GENERIC_RE = /^(?:σ|sigma)$/i
/** Two-letter abbreviations accepted only in one case: "Se" is selenium, not a standard error. */
const ONE_CASE_RE = /^(?:se|sd)$/i
/** "u(y)", "σ(T)", "err(V)", "incertezza(y)" — function notation with an explicit reference. */
const FUNCTION_RE =
  /^(?:u|σ|sigma|sd|std|err|error|errore|unc|uncertainty|incertezza|δ|sem|se)\s*\(\s*(.+?)\s*\)$/i
/** "u_y", "σ_y", "δ_y": symbol prefixes (lower case: "U_C" is a voltage), only with an existing column. */
const SYMBOL_PREFIX_RE = /^(u|σ|δ)[_\s.-]+(.+)$/
/** "± y", "±y": an uncertainty even when the reference is not found. */
const PM_PREFIX_RE = /^(?:±|\+\/-|\+-)\s*(.+)$/
/** "sigma y", "err V", "error_T": word prefixes, accepted only when the rest names another column ("Error rate" is not). */
const WORD_PREFIX_RE = /^(?:sigma|sd|std|err|error|errore|unc|uncertainty|incertezza)[_\s.-]+(.+)$/i
/** "σy", "δy", "dy": an attached prefix, accepted only when the rest names another column. */
const ATTACHED_PREFIX_RE = /^(?:σ|δ|d)(.+)$/
/** "y_err", "y error", "V_unc", "y_sigma", "y±"; and attached "yerr" (only with an existing column). */
const SUFFIX_RE =
  /^(.+?)[_\s.-]+(?:err|error|errore|unc|uncertainty|incertezza|sigma|σ|sd|std|u)$|^(.+?)\s*±$/i
const ATTACHED_SUFFIX_RE = /^(.+?)(?:err|error|unc|sigma|σ|sd)$/i
/** "uncertainty of y", "error on V", "incertezza di T", "errore su y". */
const OF_RE = /^(?:uncertainty|error|err|incertezza|errore)\s+(?:of|in|on|di|su|del|della)\s+(.+)$/i

const IDENTIFIER_RE =
  /^(?:#|no\.?|nr\.?|num\.?|number|id|index|idx|trial|trials|run|runs|replicate|replica|rep|repetition|ripetizione|prova|row|measurement\s*(?:no\.?|#|number|id)|sample\s*(?:no\.?|#|number|id)|campione\s*(?:n\.?|#)|n\.?\s*(?:misura|prova)|misura\s*n\.?)$/i
const GROUP_RE =
  /^(?:group|groups|gruppo|observer|osservatore|operator|operatore|sample|campione|condition|condizione|treatment|trattamento|series|serie|set|class|classe|category|categoria|label|etichetta|type|tipo|material|materiale|student|studente|team|squadra|batch|lotto|instrument|strumento|method|metodo|site|sito|subject|soggetto)$/i

/** Name for matching: trimmed, inner whitespace collapsed, a trailing " (unit)" / " [unit]" removed. */
function clean(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s+[([][^()[\]]{1,24}[)\]]$/, '')
}

/**
 * ref = referenced column name (null for generic names); strict = only when that column exists;
 * symbolic = the name is also a physical symbol, so the units must agree.
 */
type UncertaintyMatch = { ref: string | null; strict: boolean; symbolic: boolean } | null

/** Classifies a name as an uncertainty name. */
function matchUncertainty(name: string): UncertaintyMatch {
  if (/^Δ/.test(name)) return null // a difference, not an uncertainty
  if (ONE_CASE_RE.test(name) && name !== name.toLowerCase() && name !== name.toUpperCase()) return null
  if (GENERIC_RE.test(name)) return { ref: null, strict: false, symbolic: SYMBOL_GENERIC_RE.test(name) }
  let m = FUNCTION_RE.exec(name)
  if (m) return { ref: m[1], strict: false, symbolic: false }
  m = OF_RE.exec(name)
  if (m) return { ref: m[1], strict: false, symbolic: false }
  m = SYMBOL_PREFIX_RE.exec(name)
  if (m) return { ref: m[2], strict: true, symbolic: m[1] !== 'u' }
  m = PM_PREFIX_RE.exec(name)
  if (m) return { ref: m[1], strict: false, symbolic: false }
  m = WORD_PREFIX_RE.exec(name)
  if (m) return { ref: m[1], strict: true, symbolic: /^sigma/i.test(name) }
  m = SUFFIX_RE.exec(name)
  if (m) return { ref: m[1] ?? m[2], strict: false, symbolic: false }
  m = ATTACHED_PREFIX_RE.exec(name)
  if (m) return { ref: m[1], strict: true, symbolic: true }
  m = ATTACHED_SUFFIX_RE.exec(name)
  if (m) return { ref: m[1], strict: true, symbolic: false }
  return null
}

const unitKey = (u: string) => u.trim().replace(/μ/g, 'µ').replace(/Ω/g, 'Ω')

/** An uncertainty unit fits its reference when it is absent, '%' (relative) or the reference's unit. */
function unitsCompatible(u: string | null, ref: string | null): boolean {
  if (u === null || u.trim() === '' || unitKey(u) === '%') return true
  return ref !== null && unitKey(u) === unitKey(ref)
}

/** Index of the column named `ref` (exact first, then case-insensitive if unique), excluding `self`. */
function findColumn(names: readonly string[], ref: string, self: number): number {
  const target = clean(ref)
  for (let j = 0; j < names.length; j++) if (j !== self && names[j] === target) return j
  const lower = target.toLowerCase()
  let found = -1
  for (let j = 0; j < names.length; j++) {
    if (j === self || names[j].toLowerCase() !== lower) continue
    if (found >= 0) return -1 // ambiguous ("t" and "T")
    found = j
  }
  return found
}

/** Suggests a role per column (aligned with the input). Pure function of names, units and kinds. */
export function suggestRoles(columns: readonly RoleInput[]): RoleSuggestion[] {
  const names = columns.map((c) => clean(c.name))
  const out: RoleSuggestion[] = columns.map(() => ({ role: 'measurement', uncertaintyOf: null }))
  const generic: { i: number; symbolic: boolean }[] = []

  for (let i = 0; i < columns.length; i++) {
    const c = columns[i]
    const name = names[i]
    if (c.kind === 'numeric') {
      const m = matchUncertainty(name)
      if (m) {
        if (m.ref === null) {
          out[i] = { role: 'uncertainty', uncertaintyOf: null }
          generic.push({ i, symbolic: m.symbolic })
          continue
        }
        const j = findColumn(names, m.ref, i)
        const fits = j < 0 || !m.symbolic || unitsCompatible(c.unit, columns[j].unit)
        if ((j >= 0 || !m.strict) && fits) {
          out[i] = { role: 'uncertainty', uncertaintyOf: j >= 0 && columns[j].kind === 'numeric' ? j : null }
          continue
        }
      }
      if (IDENTIFIER_RE.test(name) && c.integerValued !== false) {
        out[i] = { role: 'identifier', uncertaintyOf: null }
        continue
      }
      // "N" is as often a count (events, decays) as a row counter: only 1, 2, 3… makes it an identifier.
      if (/^n\.?$/i.test(name) && c.integerValued === true && c.consecutive === true) {
        out[i] = { role: 'identifier', uncertaintyOf: null }
        continue
      }
      if (GROUP_RE.test(name) && c.integerValued !== false) {
        out[i] = { role: 'group', uncertaintyOf: null }
        continue
      }
    } else if (c.kind === 'categorical') {
      out[i] = { role: 'group', uncertaintyOf: null }
    }
  }

  // An uncertainty column whose reference is itself an uncertainty column has no usable reference.
  for (let i = 0; i < out.length; i++) {
    const j = out[i].uncertaintyOf
    if (j !== null && out[j].role === 'uncertainty') out[i] = { role: 'uncertainty', uncertaintyOf: null }
  }
  // Generic names ("σ", "err") refer to the nearest numeric measurement column on their left, if the units
  // fit. Otherwise a word ("err") stays an uncertainty without a target, a symbol ("σ (MPa)") is a measurement.
  for (const { i, symbolic } of generic) {
    let target = -1
    for (let j = i - 1; j >= 0; j--) {
      if (columns[j].kind === 'numeric' && out[j].role === 'measurement') {
        target = j
        break
      }
    }
    if (target >= 0 && unitsCompatible(columns[i].unit, columns[target].unit)) {
      out[i] = { role: 'uncertainty', uncertaintyOf: target }
    } else if (symbolic) out[i] = { role: 'measurement', uncertaintyOf: null }
  }
  return out
}
