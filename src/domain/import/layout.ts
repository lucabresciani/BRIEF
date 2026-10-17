import { asRowId, issue, type DatasetLayout, type Issue, type RowId } from '@/domain/model'

/**
 * Where the table is inside the tokenised grid: preamble lines, header row, units row, data rows, and the
 * column names/units read from the header. Every decision is reversible metadata: the raw grid keeps all rows.
 */
export interface LayoutDetection {
  layout: DatasetLayout
  /** One per grid column; generated "Column n" when there is no header or the cell is empty; duplicates " (2)". */
  names: string[]
  units: (string | null)[]
  unitSources: ('header' | 'unitsRow' | null)[]
  /** Preamble lines (rows before the table), non-empty cells joined per row. */
  notes: string[]
  headerConfidence: 'high' | 'low'
  /**
   * Per grid column: false when the column has no non-empty cell from the header (or first data row) to the
   * last data row, e.g. the empty column created by a trailing delimiter. Such columns are not offered as
   * dataset columns (I_TRIMMED_EMPTY) but stay in the raw table.
   */
  used: boolean[]
  issues: Issue[]
}

export interface LayoutOptions {
  /** Overrides (import dialog): a grid row, null = no header / no units row, undefined = detect. */
  headerRow?: number | null
  unitsRow?: number | null
  dataStartRow?: number
  /** Grid row holding Excel's "sep=;" line: never part of the table or of the notes. */
  sepLineRow?: number | null
  /** Cell classifier; the import pipeline passes the locale-aware number classifier. */
  isNumericLike?: (s: string) => boolean
  /**
   * Unit tail of a number-like cell ("12 mV" → "mV", "12%" → "%", "1st" → "st"), null without one. A cell
   * whose tail never appears in the body of its column is a word for the heuristics ("1st", "2Theta").
   */
  unitTail?: (s: string) => string | null
  /** Missing-value / spreadsheet-error tokens ("NA", "#DIV/0!"): neither text nor numbers for the heuristics. */
  isMissing?: (s: string) => boolean
  /** Row numbers shown in messages (RawTable.sourceRow); default grid index + 1. */
  sourceRow?: ArrayLike<number>
}

const LOOSE_NUMBER =
  /^[+\-−]?(?:\d[\d.,'’\u00a0\u2009\u202f ]*|[.,]\d+)(?:[eE][+\-−]?\d+)?\s*(%|[\p{L}µΩ°][\p{L}\p{N}µΩ°·/^*\-−⁻⁺.²³]{0,15})?$/u

/** Permissive "could be a number" test (any decimal convention, optional unit or %): the default classifier. */
export function looseNumericLike(s: string): boolean {
  const t = s.trim()
  return t !== '' && LOOSE_NUMBER.test(t)
}

/** Unit tail of a looseNumericLike cell ("12 mV" → "mV"), null when there is none. */
function looseUnitTail(s: string): string | null {
  const m = LOOSE_NUMBER.exec(s.trim())
  return m?.[1] ?? null
}

const DEFAULT_MISSING = new Set([
  'na',
  'n/a',
  'nan',
  'null',
  'none',
  'missing',
  '-',
  '--',
  '—',
  '–',
  '?',
  '.',
  'n.d.',
  'nd',
  'n.a.',
  'n.v.',
])
function defaultIsMissing(s: string): boolean {
  const t = s.trim().toLowerCase()
  return DEFAULT_MISSING.has(t) || /^#[a-z/0!?_]+[!?]?$/i.test(t)
}

/**
 * Non-numeric flags written in place of a measurement: below the detection / quantification limit,
 * instrument overload, error. A data row holding one is still a data row, never a units row or a header.
 */
const FLAG_WORDS = new Set([
  'BDL',
  'BLD',
  'BLQ',
  'LOD',
  'LOQ',
  '<LOD',
  '<LOQ',
  '<DL',
  'DNQ',
  'NQ',
  'ERR',
  'OVER',
  'UNDER',
  'OVERFLOW',
  'UNDERFLOW',
  'OOR',
  'OL',
  'SAT',
  'INF',
  '+INF',
  '-INF',
  'TRACE',
])
/** A flag word ("BDL", "ERR") or a censored value ("<0.5", "> 1000"). */
export function isFlagCell(s: string): boolean {
  const t = s.trim()
  return FLAG_WORDS.has(t.toUpperCase()) || /^[<>≤≥]\s*[\d.,]/.test(t) || /^[<>]\s*(?:LOD|LOQ|DL)$/i.test(t)
}

/** Character-class shape of a label: "B" → "A", "Rod B" → "Aaa A", "S01" → "A99". */
function shape(s: string): string {
  return s
    .trim()
    .replace(/\p{Lu}/gu, 'A')
    .replace(/\p{Ll}/gu, 'a')
    .replace(/\d/g, '9')
}

const UNIT_TOKEN = /^(?:[\p{L}\p{Sc}µΩ°%‰℃]|1\/)[\p{L}\p{N}\p{Sc}µΩ°℃·⋅*/^_\-−⁻⁺.²³%]{0,15}$/u

/**
 * A unit symbol with an optional SI prefix, case-sensitive: "m", "mA", "kPa", "µS", "nm", "hPa", "mM".
 * The atto prefix is left out on purpose: "am" and "as" are words far more often than units.
 */
const SI_UNIT =
  /^(?:[TGMkdcmµμunpf]|h(?=Pa$|L$))?(?:m|g|s|A|K|mol|cd|Hz|N|Pa|J|W|Wh|Ah|C|V|F|Ω|S|Wb|T|H|lm|lx|Bq|Gy|Sv|kat|L|l|eV|bar|rad|sr|M|t)$/u

/** Unit words and symbols outside the SI pattern (currencies included), compared in lower case. */
const UNIT_WORDS = new Set(
  [
    '% ‰ ° º ℃ ℉ °c °f °k ºc deg degc degf degree degrees rad sr rev revs rpm rps cps cpm count counts cts',
    'ppm ppb ppt sec secs second seconds min mins minute minutes hr hrs hour hours h d day days week weeks',
    'yr yrs year years ms us ns ps kg g gram grams kilogram kilograms tonne tonnes lb lbs oz ct meter meters',
    'metre metres in inch inches ft feet foot yd mi mph kph kmh knot knots kn kt ha acre acres cc gal liter',
    'liters litre litres ml cl dl ul µl psi psia psig atm torr mmhg inhg h2o mmh2o cmh2o inh2o hg cal kcal',
    'btu hp kwh mah ohm ohms kohm mohm volt volts amp amps ampere amperes watt watts joule joules newton',
    'newtons pascal pascals kelvin celsius fahrenheit hertz lux db dbm dba au a.u a.u. arb arb.u arb.u. unit',
    'units px pixel pixels dpi fps bpm percent pct molar mol/l bit bits byte bytes kb mb ntu fnu psu cfu iu',
    'rfu € $ £ ¥ ₹ eur usd gbp chf secondi minuti ore giorni gradi metri grammi litri giri',
  ]
    .join(' ')
    .split(' '),
)

/** One factor of a unit, without its exponent: "m" of "m2", "s" of "s^-1", "kg" of "kg·m⁻³". */
function unitFactor(f: string): boolean {
  if (f === '') return true
  if (UNIT_WORDS.has(f.toLowerCase()) || UNIT_WORDS.has(f.toLowerCase().replace(/\.$/, ''))) return true
  const m = /^(.*?)(?:\^?[-−⁻⁺]?[\d¹²³⁰⁴⁵⁶⁷⁸⁹]+)?$/u.exec(f)
  const base = m?.[1] ?? f
  return base !== '' && (SI_UNIT.test(base) || UNIT_WORDS.has(base.toLowerCase()))
}

/** One whitespace-separated token: "mg/L", "m^2", "N/m2", "1/K", "a.u.", "counts". */
function unitToken(p: string): boolean {
  if (!UNIT_TOKEN.test(p)) return false
  if (UNIT_WORDS.has(p.toLowerCase())) return true
  const factors = p.replace(/^1\//, '').split(/[/·⋅*.]/)
  return factors.some((f) => f !== '') && factors.every(unitFactor)
}

/**
 * Short unit text: 1–3 tokens, each made of unit symbols (with an SI prefix and an exponent), known unit
 * words or symbols: "s", "mg/L", "°C", "m s^-1", "a.u.", "1/K", "N/m2", "mm H2O", "counts". A word that
 * merely sits in brackets ("calibrated", "max") or a name ("Width mm") is not a unit.
 */
export function looksLikeUnit(s: string): boolean {
  const t = s.trim()
  if (t === '' || t.length > 24 || /[,;|\t]/.test(t)) return false
  const parts = t.split(/\s+/)
  if (parts.length > 3 || !parts.every(unitToken)) return false
  // Units of several tokens are written with symbols ("m s^-1", "deg C"); a spelled-out unit word next to
  // a symbol is a name and its unit ("Amps mA").
  return parts.length === 1 || !parts.some((p) => /^\p{L}{4,}$/u.test(p) && !SI_UNIT.test(p))
}

/** Strips one pair of wrapping brackets: "(m)" → "m", "[V]" → "V". */
function unwrap(s: string): string {
  const t = s.trim()
  return /^\(.*\)$/.test(t) || /^\[.*\]$/.test(t) ? t.slice(1, -1).trim() : t
}

/** Names written as functions of another quantity, "u(y)", "σ(x)", "err(y)", "ln(c)": not "name(unit)". */
const FUNCTION_NAMES = new Set([
  'u',
  'σ',
  'δ',
  'Δ',
  'err',
  'error',
  'errore',
  'unc',
  'uncertainty',
  'incertezza',
  'sd',
  'se',
  'sem',
  'sigma',
  'std',
  'stdev',
  'dev',
  'delta',
  'f',
  'g',
  'ln',
  'log',
  'exp',
  'sqrt',
  'sin',
  'cos',
  'tan',
  'abs',
])

function unitPart(raw: string): string | null {
  const u = unwrap(raw)
  if (u === '' || u.length > 24 || /[,;|\t]/.test(u) || u.split(/\s+/).length > 3) return null
  return u
}

/**
 * Bracket text that is a unit notation looksLikeUnit cannot read ("10^-3 A", "A&B"): its words are all
 * unit symbols. Never a bare number ("Measurement (2)") nor a qualifier with a number ("V (trial 2)"),
 * which would leave two columns with the same name.
 */
function unitNotation(x: string): boolean {
  if (!/[^\d\s.,+\-−]/u.test(x)) return false
  return x.split(/\s+/).every((tok) => !/^\p{L}+$/u.test(tok) || unitToken(tok))
}

/**
 * Header text → name + unit. Accepted forms: "Voltage (V)", "V [V]", "V / V" (ISO 80000), and "t(s)" without
 * a space unless the name is a function of another quantity ("u(y)" stays a name). Round brackets also hold
 * qualifiers: words give a unit only when they are units ("(watts)", "(in)"), so "force (calibrated)" and
 * "V (trial 2)" stay names, which also keeps them apart from a "force" or "V" column; a notation made of
 * unit symbols stays a unit ("(m^2)", "(10^-3 A)"). Square brackets and "/" are unit notations. Only the LAST
 * bracketed group is a unit: "u(y) (m)" → name "u(y)", unit "m". Anything else → the whole text is the name.
 */
export function splitNameUnit(header: string): { name: string; unit: string | null } {
  const h = header.trim()
  const forms: [RegExp, (m: RegExpExecArray) => boolean][] = [
    [/^(.*\S)\s+\/\s+(\S.*)$/, () => true],
    [/^(.*\S)\s*\[([^[\]]+)\]$/, () => true],
    [/^(.*\S)\s+\(([^()]+)\)$/, (m) => looksLikeUnit(m[2]!) || unitNotation(m[2]!)],
    [/^(.*[^\s(])\(([^()]+)\)$/, (m) => !FUNCTION_NAMES.has(m[1]!.toLowerCase()) && looksLikeUnit(m[2]!)],
  ]
  for (const [re, accept] of forms) {
    const m = re.exec(h)
    if (!m || !accept(m)) continue
    const unit = unitPart(m[2]!)
    if (unit !== null) return { name: m[1]!.trim(), unit }
  }
  return { name: h, unit: null }
}

const isPlaceholder = (s: string) => s === '-' || s === '—' || s === '–'

/**
 * The unit of one column from its header cell and its units-row cell (null = no such row): the header's
 * "(unit)" wins, else the units-row cell (brackets removed; "-" means dimensionless, no unit). The single
 * rule shared by detectLayout and the dataset view, so both agree on the imported unit.
 */
export function columnUnit(
  headerCell: string | null,
  unitsCell: string | null,
): { unit: string | null; source: 'header' | 'unitsRow' | null } {
  if (headerCell !== null) {
    const u = splitNameUnit(headerCell).unit
    if (u !== null) return { unit: u, source: 'header' }
  }
  if (unitsCell !== null) {
    const u = unwrap(unitsCell)
    if (u !== '' && !isPlaceholder(u)) return { unit: u, source: 'unitsRow' }
  }
  return { unit: null, source: null }
}

const nonEmptyCount = (r: readonly string[]) => r.reduce((k, c) => (c.trim() !== '' ? k + 1 : k), 0)

/** Share of number cells (from a column's first number down) above which a column counts as numeric. */
const BODY_NUMERIC_SHARE = 0.6
/** Rows at the end of the file used for the body profile (bounded work on large files). */
const PROFILE_ROWS = 500

type CellKind = 'empty' | 'missing' | 'num' | 'text'

/**
 * Detects the layout of a padded grid. The data block is found first, from the bottom, where
 * measurements dominate a file:
 * - body profile: in the lower half of the non-empty rows, columns with ≥ 60 % numbers are numeric, the
 *   others hold labels (their shapes, "B" / "Rod B", are remembered);
 * - first data row: the first row whose numeric columns hold more numbers than words, followed by another
 *   data row; the rows just above it still belong to the data when their words are only flags ("BDL",
 *   "ERR") or missing tokens next to a label of the right shape ("A,BDL", "NA,NA"), when a stray word sits
 *   between data rows ("1,2 / 2,n/r / 3,4"), or when they mix words and numbers right under the header
 *   (then W_HEADER_UNCERTAIN: "Sample rate,1000" may be metadata);
 * - header: the closest row above the data whose numeric columns hold words only (names may be missing:
 *   "Time,V,," is a header). A one-cell row in a multi-column table is a title, not a header. A row of
 *   units between that header and the data is the units row (I_UNITS_ROW) when every cell looks like a
 *   unit, none is a flag or a body label, and the numeric columns mostly have one;
 * - preamble: every row above the header (I_PREAMBLE_KEPT, kept as notes). A preamble row that looks like
 *   data (numbers dominate its numeric columns) gives W_HEADER_UNCERTAIN, so it is never dropped silently;
 * - no numeric block (an all-text table): the first row as wide as the table is the header, W_HEADER_UNCERTAIN;
 * - dataEndRow = last row with a non-empty cell.
 * Duplicate names get " (2)" (I_DUPLICATE_HEADER_RENAMED), empty names "Column n" (I_EMPTY_HEADER_NAMED).
 */
export function detectLayout(
  rows: readonly (readonly string[])[],
  opts: LayoutOptions = {},
): LayoutDetection {
  const isNum = opts.isNumericLike ?? looseNumericLike
  const isMissing = opts.isMissing ?? defaultIsMissing
  const unitTail = opts.unitTail ?? (opts.isNumericLike ? () => null : looseUnitTail)
  const shown = (i: number) => (opts.sourceRow ? opts.sourceRow[i]! : i + 1)
  const sep = opts.sepLineRow ?? null
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0)
  const cell = (r: number, c: number) => rows[r]?.[c] ?? ''
  for (const k of ['headerRow', 'unitsRow', 'dataStartRow'] as const) {
    const v = opts[k]
    if (v != null && (!Number.isInteger(v) || v < 0 || v > rows.length))
      throw new RangeError(`${k} out of range: ${v}`)
  }

  const nonEmpty = rows.map(nonEmptyCount)
  const candidates: number[] = []
  for (let i = 0; i < rows.length; i++) if (i !== sep && nonEmpty[i]! > 0) candidates.push(i)
  const dataEndRow = candidates.length ? candidates[candidates.length - 1]! : -1
  const issues: Issue[] = []

  if (candidates.length === 0) {
    return {
      layout: { headerRow: null, unitsRow: null, dataStartRow: opts.dataStartRow ?? rows.length, dataEndRow },
      names: Array.from({ length: width }, (_, c) => `Column ${c + 1}`),
      units: Array.from({ length: width }, () => null),
      unitSources: Array.from({ length: width }, () => null),
      notes: [],
      headerConfidence: 'high',
      used: Array.from({ length: width }, () => false),
      issues,
    }
  }

  const baseKind = (s: string): CellKind => {
    if (s.trim() === '') return 'empty'
    if (isMissing(s)) return 'missing'
    return isNum(s) ? 'num' : 'text'
  }

  // ---- body profile, from the last rows of the file ----
  // Numeric share of a column: from its first number down (headers and preambles sit above the data, so a
  // tiny file "title / header / one row" is still recognised). Unit tails and label shapes: lower half.
  const window = candidates.slice(-PROFILE_ROWS)
  const tail = window.slice(Math.floor(window.length / 2))
  const bodyTails = Array.from({ length: width }, () => new Set<string>())
  const bodyShapes = Array.from({ length: width }, () => new Set<string>())
  const numericCols: number[] = []
  const labelCols: number[] = []
  for (let c = 0; c < width; c++) {
    let num = 0
    let all = 0
    for (const r of window) {
      const k = baseKind(cell(r, c))
      if (k === 'num') num++
      else if (k !== 'text' || num === 0) continue
      all++
    }
    let lowerNum = 0
    let lowerText = 0
    for (const r of tail) {
      const s = cell(r, c)
      const k = baseKind(s)
      if (k === 'num') {
        lowerNum++
        const u = unitTail(s)
        if (u !== null) bodyTails[c]!.add(u)
      } else if (k === 'text') {
        lowerText++
        bodyShapes[c]!.add(shape(s))
      }
    }
    if (num > 0 && num / all >= BODY_NUMERIC_SHARE) numericCols.push(c)
    else if (lowerText > lowerNum) labelCols.push(c)
  }
  const numericSet = new Set(numericCols)

  /** A number whose unit tail never appears in the body of its column is a word ("1st", "2Theta"). */
  const kindAt = (r: number, c: number): CellKind => {
    const s = cell(r, c)
    const k = baseKind(s)
    if (k !== 'num') return k
    const u = unitTail(s)
    return u === null || bodyTails[c]!.has(u) ? 'num' : 'text'
  }
  const countsN = (r: number) => {
    let num = 0
    let text = 0
    let flags = 0
    let missing = 0
    for (const c of numericCols) {
      const k = kindAt(r, c)
      if (k === 'num') num++
      else if (k === 'missing') missing++
      else if (k === 'text') {
        text++
        if (isFlagCell(cell(r, c))) flags++
      }
    }
    return { num, text, flags, missing }
  }
  /** Do the labels of row r look like the labels of the data ("A" over "B", "C")? */
  const labelsMatch = (r: number): 'match' | 'mismatch' | 'none' => {
    let seen = false
    for (const c of labelCols) {
      const s = cell(r, c)
      const k = baseKind(s)
      if (k === 'empty' || k === 'missing') continue
      seen = true
      if (!bodyShapes[c]!.has(shape(s))) return 'mismatch'
    }
    return seen ? 'match' : 'none'
  }
  /** Numbers dominate the numeric columns. */
  const strictData = (r: number) => {
    const { num, text } = countsN(r)
    return num > text
  }
  /** A data row, possibly with flags, missing values or empty cells. */
  const dataLike = (r: number) => {
    const { num, text, flags, missing } = countsN(r)
    if (num > text) return true
    if (text !== flags) return false
    const lm = labelsMatch(r)
    if (num > 0) return lm !== 'mismatch'
    if (lm === 'match') return true
    return text === 0 && missing > 0 && lm === 'none'
  }
  const mostlyNumeric = (r: number) => {
    let num = 0
    let all = 0
    for (let c = 0; c < width; c++) {
      const k = kindAt(r, c)
      if (k === 'num' || k === 'text') {
        all++
        if (k === 'num') num++
      }
    }
    return all > 0 && num / all > 0.5
  }
  const next = (r: number) => candidates.find((i) => i > r)

  /**
   * Units-row shape: the row right after `header`, every non-empty cell unit-like or a dimensionless
   * placeholder ("-"), none numeric, missing, a flag or a label of the data; at least one numeric column
   * has a unit, and most numeric columns have a cell.
   */
  const unitShaped = (r: number | undefined, header: number) => {
    if (r === undefined || r !== header + 1 || r > dataEndRow || nonEmpty[r] === 0) return false
    let units = 0
    let filled = 0
    for (let c = 0; c < width; c++) {
      const s = cell(r, c).trim()
      if (s === '') continue
      if (numericSet.has(c)) filled++
      if (isPlaceholder(s)) continue
      if (isNum(s) || isMissing(s) || isFlagCell(s) || !looksLikeUnit(unwrap(s))) return false
      if (!numericSet.has(c) && bodyShapes[c]!.has(shape(s))) return false
      if (numericSet.has(c)) units++
    }
    return numericCols.length === 0 ? false : units > 0 && filled * 2 >= numericCols.length
  }

  // ---- automatic detection ----
  let autoHeader: number | null = null
  let autoUnits: number | null = null
  let autoStart: number
  let uncertain = false
  let s0 = -1
  if (numericCols.length > 0) {
    for (let k = 0; k < candidates.length; k++) {
      if (!strictData(candidates[k]!)) continue
      const nx = candidates[k + 1]
      if (nx === undefined || dataLike(nx)) {
        s0 = k
        break
      }
    }
  }
  if (s0 >= 0) {
    const used = new Set<number>()
    for (const r of candidates.slice(s0, s0 + 200))
      for (let c = 0; c < width; c++) if (cell(r, c).trim() !== '') used.add(c)
    const title = (r: number) => nonEmpty[r] === 1 && used.size >= 2
    /** Words only in the numeric columns, at least one of them, and not a title line. */
    const headerLike = (r: number) => {
      const { num, text } = countsN(r)
      return text > 0 && num === 0 && !title(r)
    }
    let k = s0
    for (;;) {
      while (k > 0 && dataLike(candidates[k - 1]!)) k--
      const p = candidates[k - 1]
      if (p === undefined) break
      const q = candidates[k - 2]
      if (q !== undefined && headerLike(q) && unitShaped(p, q)) {
        autoHeader = q
        autoUnits = p
        break
      }
      if (headerLike(p)) {
        autoHeader = p
        break
      }
      if (title(p)) break
      // A row between data rows with a stray word ("2,n/r") is a data row with an invalid cell.
      if (q !== undefined && strictData(q)) {
        k--
        continue
      }
      // Words and numbers mixed in the numeric columns ("Sample rate,1000"): a header only if words win.
      uncertain = true
      const { num, text } = countsN(p)
      if (text > num) {
        autoHeader = p
        break
      }
      k--
    }
    autoStart = candidates[k]!
  } else {
    // No numeric block: an all-text table, or a header alone. The first row as wide as the table is the header.
    const freq = new Map<number, number>()
    let mode = 1
    let modeF = 0
    for (const i of tail) {
      const w = nonEmpty[i]!
      const f = (freq.get(w) ?? 0) + 1
      freq.set(w, f)
      if (f > modeF || (f === modeF && w > mode)) [mode, modeF] = [w, f]
    }
    const first = candidates.find((i) => nonEmpty[i]! >= mode) ?? candidates[0]!
    const after = next(first)
    if (after === undefined) autoHeader = mostlyNumeric(first) ? null : first
    else {
      autoHeader = first
      uncertain = true
    }
    autoStart = autoHeader === null ? first : (after ?? first + 1)
  }

  // ---- overrides ----
  let headerRow: number | null
  let unitsRow: number | null
  if (opts.headerRow !== undefined) {
    headerRow = opts.headerRow
    if (opts.unitsRow !== undefined) unitsRow = opts.unitsRow
    else unitsRow = headerRow !== null && unitShaped(headerRow + 1, headerRow) ? headerRow + 1 : null
  } else {
    headerRow = autoHeader
    unitsRow = opts.unitsRow !== undefined ? opts.unitsRow : autoUnits
  }
  let dataStartRow: number
  if (opts.dataStartRow !== undefined) dataStartRow = opts.dataStartRow
  else if (headerRow !== null) dataStartRow = Math.max(headerRow, unitsRow ?? -1) + 1
  else {
    const first = opts.headerRow === null ? (autoHeader ?? autoStart) : autoStart
    dataStartRow = Math.max(first, (unitsRow ?? -1) + 1)
  }
  if (sep !== null && dataStartRow <= sep) dataStartRow = sep + 1
  const tableStart = headerRow ?? dataStartRow

  const preamble = candidates.filter((i) => i < tableStart)
  if (opts.headerRow === undefined && numericCols.length > 0 && preamble.some(strictData)) uncertain = true
  const headerConfidence: 'high' | 'low' = opts.headerRow === undefined && uncertain ? 'low' : 'high'
  if (headerConfidence === 'low') {
    issues.push(issue('W_HEADER_UNCERTAIN', { row: shown(tableStart) }, { rows: [asRowId(tableStart)] }))
  }
  if (unitsRow !== null && opts.unitsRow === undefined) {
    issues.push(issue('I_UNITS_ROW', { row: shown(unitsRow) }, { rows: [asRowId(unitsRow)] }))
  }
  const notes = preamble.map((i) =>
    rows[i]!.map((c) => c.trim())
      .filter((c) => c !== '')
      .join(' | '),
  )
  if (preamble.length) {
    issues.push(issue('I_PREAMBLE_KEPT', { count: preamble.length }, { rows: preamble.map(asRowId) }))
  }

  // ---- columns in use, names and units ----
  const used: boolean[] = []
  for (let c = 0; c < width; c++) {
    let u = false
    for (let r = Math.min(tableStart, dataStartRow); r <= dataEndRow && !u; r++) {
      if (r !== sep && cell(r, c).trim() !== '') u = true
    }
    used.push(u)
  }
  const names: string[] = []
  const units: (string | null)[] = []
  const unitSources: ('header' | 'unitsRow' | null)[] = []
  let emptyNamed = 0
  for (let c = 0; c < width; c++) {
    let name = `Column ${c + 1}`
    if (headerRow !== null) {
      const split = splitNameUnit(cell(headerRow, c))
      if (split.name !== '') name = split.name
      else if (used[c]) emptyNamed++
    }
    const u = columnUnit(
      headerRow !== null ? cell(headerRow, c) : null,
      unitsRow !== null ? cell(unitsRow, c) : null,
    )
    names.push(name)
    units.push(u.unit)
    unitSources.push(u.source)
  }
  if (emptyNamed) issues.push(issue('I_EMPTY_HEADER_NAMED', { count: emptyNamed }))

  // Duplicates among the columns in use: "x", "x (2)", "x (3)".
  const taken = new Set<string>()
  const seen = new Map<string, number>()
  let renamed = 0
  for (let c = 0; c < width; c++) if (used[c]) taken.add(names[c]!)
  for (let c = 0; c < width; c++) {
    if (!used[c]) continue
    const base = names[c]!
    const k = seen.get(base) ?? 0
    seen.set(base, k + 1)
    if (k === 0) continue
    let n = k + 1
    while (taken.has(`${base} (${n})`)) n++
    names[c] = `${base} (${n})`
    taken.add(names[c]!)
    renamed++
  }
  if (renamed) issues.push(issue('I_DUPLICATE_HEADER_RENAMED', { count: renamed }))

  const unusedCount = used.filter((u) => !u).length
  if (unusedCount > 0 && unusedCount < width) issues.push(issue('I_TRIMMED_EMPTY', { cols: unusedCount }))

  return {
    layout: { headerRow, unitsRow, dataStartRow, dataEndRow },
    names,
    units,
    unitSources,
    notes,
    headerConfidence,
    used,
    issues,
  }
}

/** Grid rows of the data block that are entirely blank (kept in the raw data, outside nTotal: I_BLANK_ROWS). */
export function blankDataRows(rows: readonly (readonly string[])[], layout: DatasetLayout): RowId[] {
  const out: RowId[] = []
  for (let r = layout.dataStartRow; r <= layout.dataEndRow; r++) {
    if (nonEmptyCount(rows[r] ?? []) === 0) out.push(asRowId(r))
  }
  return out
}
