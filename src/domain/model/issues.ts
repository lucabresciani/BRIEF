import type { ColumnId, RowId } from './ids'

/**
 * Catalogue of every problem the app can report. Each code has the i18n keys
 * `issues.<CODE>.title` and `issues.<CODE>.hint` in both dictionaries (enforced by a test).
 * Prefix: E_ = blocks the action, W_ = warning, I_ = information.
 */
export const IMPORT_CODES = [
  'E_EMPTY_INPUT',
  'E_NO_DATA_ROWS',
  'E_FILE_TOO_LARGE',
  'W_FILE_LARGE',
  'E_TOO_MANY_CELLS',
  'E_UNSUPPORTED_FORMAT',
  'E_XLS_LEGACY',
  'E_SPREADSHEET_UNREADABLE',
  'W_ENCODING_FALLBACK',
  'I_SEP_LINE',
  'W_DELIMITER_AMBIGUOUS',
  'W_SINGLE_COLUMN',
  'W_RAGGED_ROWS',
  'W_EXTRA_FIELDS',
  'E_QUOTES_UNCLOSED',
  'I_PREAMBLE_KEPT',
  'I_BLANK_ROWS',
  'W_HEADER_UNCERTAIN',
  'I_UNITS_ROW',
  'W_DECIMAL_AMBIGUOUS',
  'W_DECIMAL_MIXED',
  'W_SEPARATOR_CONFLICT',
  'I_UNIT_FROM_CELLS',
  'W_UNEXPECTED_UNIT',
  'I_PERCENT',
  'W_COLUMN_PARTLY_NUMERIC',
  'W_MERGED_CELLS',
  'W_FORMULA_NO_VALUE',
  'I_TRIMMED_EMPTY',
  'E_SHEET_EMPTY',
  'W_WORKER_FALLBACK',
  'E_CLIPBOARD_DENIED',
  'E_CLIPBOARD_EMPTY',
  'I_CLIPBOARD_PRECISION',
  'I_DUPLICATE_HEADER_RENAMED',
  'I_EMPTY_HEADER_NAMED',
  'I_MULTIPLE_TABLES',
  'I_BLOCK_TRANSPOSED',
  'I_STACKED_BLOCKS',
] as const

export const MISSING_CODES = [
  'I_MISSING_VALUES',
  'I_SHEET_ERRORS',
  'W_ALL_MISSING',
  'I_ROWS_INACTIVE',
  'I_SAMPLE_DIFFERS',
  'I_SPLIT_NO_VALUE',
] as const

export const INPUT_CODES = [
  'E_NOT_A_NUMBER',
  'E_RANGE_INVERTED',
  'E_LOG_RANGE_NONPOSITIVE',
  'E_UNCERTAINTY_NEGATIVE',
  'W_PERCENT_OVER_100',
  'W_UNCERTAINTY_ROWS_INVALID',
  'W_UNCERTAINTY_UNIT_MISMATCH',
  'E_DERIVED_UNCERTAINTY',
  'I_UNCERTAINTY_ROWS_MISSING',
  'I_ZERO_VALUE_PERCENT',
  'E_COLUMN_NOT_NUMERIC',
  'E_DUPLICATE_CATEGORY',
  'I_BAR_LINEAR_ONLY',
  'E_DUPLICATE_COLUMN_NAME',
  'E_EMPTY_NAME',
  'E_EXCLUSION_NOTE_REQUIRED',
] as const

export const NUMERIC_CODES = [
  'E_TOO_FEW_POINTS',
  'E_TOO_FEW_DISTINCT_X',
  'E_CONSTANT_X',
  'E_X_EFFECTIVELY_CONSTANT',
  'E_ILL_CONDITIONED',
  'W_ILL_CONDITIONED',
  'W_FEW_DOF',
  'W_HIGH_LEVERAGE',
  'I_EQUATION_CENTRED',
  'I_EXACT_FIT',
  'I_R2_UNDEFINED',
  'E_LOG_DOMAIN_FIT',
  'W_LOG_AXIS_HIDDEN',
  'W_LOG_AXIS_BARS_CLIPPED',
  'I_DATE_AXIS_LINEAR',
  'E_OVERFLOW',
  'W_CURVE_TRUNCATED',
  'W_SMALL_SAMPLE',
  'I_ZERO_SPREAD',
  'I_SINGLE_OBSERVATION',
  'I_QUARTILES_NEED_4',
  'W_GROUP_SINGLE',
  'W_GROUP_PAIR_CI',
  'W_GROUP_X_VARIES',
  'W_SPLIT_TOO_MANY_GROUPS',
  'I_SEM_COVERAGE',
  'W_EXTRAPOLATION',
  'W_MANY_POINTS',
  'E_TRANSFORM_DOMAIN',
  'I_SELECTION_ONE_DATASET',
  'E_PLOT_RENDER',
  'E_INTERNAL_GUARD',
  'E_HISTOGRAM_NO_DATA',
  'E_PLOT_NOT_CONFIGURED',
] as const

export const STORAGE_CODES = [
  'E_STORAGE_UNAVAILABLE',
  'E_STORAGE_QUOTA',
  'W_STORAGE_RETRY',
  'I_PROJECT_READ_ONLY',
] as const

export const PROJECT_CODES = [
  'E_PROJECT_TOO_LARGE',
  'E_PROJECT_NOT_JSON',
  'E_PROJECT_NOT_SCIPLOT',
  'E_PROJECT_NEWER_VERSION',
  'E_PROJECT_INVALID',
  'W_PROJECT_REPAIRED',
  'I_PROJECT_MIGRATED',
  'W_PROJECT_TOO_LARGE_TO_REOPEN',
] as const

export const EXPORT_CODES = ['E_EXPORT_FAILED'] as const

export type ImportCode = (typeof IMPORT_CODES)[number]
export type MissingCode = (typeof MISSING_CODES)[number]
export type InputCode = (typeof INPUT_CODES)[number]
export type NumericCode = (typeof NUMERIC_CODES)[number]
export type StorageCode = (typeof STORAGE_CODES)[number]
export type ProjectCode = (typeof PROJECT_CODES)[number]
export type ExportCode = (typeof EXPORT_CODES)[number]
export type ReasonCode =
  ImportCode | MissingCode | InputCode | NumericCode | StorageCode | ProjectCode | ExportCode

export const ALL_REASON_CODES: readonly ReasonCode[] = [
  ...IMPORT_CODES,
  ...MISSING_CODES,
  ...INPUT_CODES,
  ...NUMERIC_CODES,
  ...STORAGE_CODES,
  ...PROJECT_CODES,
  ...EXPORT_CODES,
]

export type Severity = 'error' | 'warning' | 'info'

export interface Issue {
  code: ReasonCode
  severity: Severity
  /** Interpolated into issues.<code>.title / .hint as {name}. */
  params?: Readonly<Record<string, string | number>>
  /** Rows involved (clickable → selected in the table). */
  rows?: readonly RowId[]
  columnId?: ColumnId
}

export function severityOf(code: ReasonCode): Severity {
  return code.startsWith('E_') ? 'error' : code.startsWith('W_') ? 'warning' : 'info'
}

export function issue(
  code: ReasonCode,
  params?: Issue['params'],
  extra?: { rows?: readonly RowId[]; columnId?: ColumnId },
): Issue {
  const out: Issue = { code, severity: severityOf(code) }
  if (params) out.params = params
  if (extra?.rows && extra.rows.length) out.rows = extra.rows
  if (extra?.columnId) out.columnId = extra.columnId
  return out
}

export type Result<T, C extends ReasonCode = ReasonCode> =
  | { ok: true; value: T; warnings: readonly Issue[] }
  | { ok: false; error: Issue & { code: C }; warnings: readonly Issue[] }

export const ok = <T>(value: T, warnings: readonly Issue[] = []): Result<T, never> => ({
  ok: true,
  value,
  warnings,
})
export const fail = <C extends ReasonCode>(
  error: Issue & { code: C },
  warnings: readonly Issue[] = [],
): Result<never, C> => ({ ok: false, error, warnings })
