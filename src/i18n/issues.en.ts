import type { ReasonCode } from '@/domain/model'

/** English texts for every ReasonCode: a short title and an actionable hint. {param} placeholders are interpolated. */
export const issuesEn: Record<ReasonCode, { title: string; hint: string }> = {
  // Import
  E_EMPTY_INPUT: {
    title: 'There is nothing to import.',
    hint: 'Paste a table copied from a spreadsheet, or choose a file.',
  },
  E_NO_DATA_ROWS: {
    title: 'No data rows were found.',
    hint: 'Check the header row and where the data starts.',
  },
  E_FILE_TOO_LARGE: {
    title: 'File too large ({size} MB, limit {limit} MB).',
    hint: 'Split the file or remove columns you do not need. Nothing was truncated.',
  },
  W_FILE_LARGE: {
    title: 'Large file: the import may take a few seconds.',
    hint: 'You can cancel at any time.',
  },
  E_TOO_MANY_CELLS: {
    title: 'Too many cells ({cells}; limit {limit}).',
    hint: 'Remove unused rows or columns and try again.',
  },
  E_UNSUPPORTED_FORMAT: {
    title: 'This file type is not supported.',
    hint: 'Use CSV, TSV, TXT, XLSX, XLS or ODS.',
  },
  E_XLS_LEGACY: {
    title: 'This .xls workbook could not be read.',
    hint: 'Open the file in your spreadsheet program and save it as .xlsx.',
  },
  E_SPREADSHEET_UNREADABLE: {
    title: 'The workbook could not be read (damaged or protected).',
    hint: 'Export the sheet as CSV and import that file.',
  },
  W_ENCODING_FALLBACK: {
    title: 'Read as Windows-1252 (Western European) text.',
    hint: 'If accented letters look wrong, choose another encoding.',
  },
  I_SEP_LINE: {
    title: 'The first line "sep={d}" sets the separator.',
    hint: 'The line is kept with the original data.',
  },
  W_DELIMITER_AMBIGUOUS: {
    title: 'The separator could be {a} or {b}; {a} was used.',
    hint: 'Pick the separator if the columns look wrong.',
  },
  W_SINGLE_COLUMN: {
    title: 'No separator found: read as a single column.',
    hint: 'If the values use a decimal comma, they may be two columns. Choose the separator.',
  },
  W_RAGGED_ROWS: {
    title:
      '{count} {count|row has|rows have} fewer fields (for example row {row}); they were padded with empty cells.',
    hint: 'Empty cells are treated as missing, never as zero.',
  },
  W_EXTRA_FIELDS: {
    title: '{count} {count|row has|rows have} extra fields; they were kept as extra columns.',
    hint: 'Check the separator if this is unexpected.',
  },
  E_QUOTES_UNCLOSED: {
    title:
      '{kind|unclosed=Unclosed quotation mark from row {row}.|malformed=A quoted field in row {row} continues after its closing quotation mark.}',
    hint: 'Fix the file, or choose "Ignore quotes" to read quotes as text.',
  },
  I_PREAMBLE_KEPT: {
    title: '{count} {count|line|lines} before the table kept as notes.',
    hint: 'You can read them under "Notes from the file".',
  },
  I_BLANK_ROWS: {
    title: '{count} empty {count|row|rows} skipped.',
    hint: 'They are kept in the original data.',
  },
  W_HEADER_UNCERTAIN: {
    title:
      '{axis|column=It is not certain that the first column holds the names of the variables.|other=It is not certain that the first row is a header.}',
    hint: '{axis|column=Choose whether column {row} contains the names of the variables.|other=Choose whether row {row} contains column names.}',
  },
  I_UNITS_ROW: {
    title: '{axis|column=Column {row} was read as units.|other=Row {row} was read as units.}',
    hint: '{axis|column=Change it if that column contains data.|other=Change it if that row contains data.}',
  },
  W_DECIMAL_AMBIGUOUS: {
    title:
      '“{example}” could be {a} or {b}; {mode|mixed={count} ambiguous {count|value was|values were} left unread|other=read as {chosen}}.',
    hint: 'Change the decimal separator of the column if this is wrong.',
  },
  W_DECIMAL_MIXED: {
    title: 'Both "." and "," are used as decimal separators ({n} and {m} values).',
    hint: 'Ambiguous values in this column were not read. Check the column.',
  },
  W_SEPARATOR_CONFLICT: {
    title: '{count} {count|cell conflicts|cells conflict} with the decimal separator.',
    hint: 'They are marked as invalid and listed with their rows.',
  },
  I_UNIT_FROM_CELLS: { title: 'Unit “{unit}” taken from the cells.', hint: 'Edit the unit if it is wrong.' },
  W_UNEXPECTED_UNIT: {
    title: '{count} {count|cell carries|cells carry} a different unit; nothing was converted.',
    hint: 'Units are never converted automatically. Check those rows.',
  },
  I_PERCENT: {
    title: 'Spreadsheet percentage: 0.12 is shown as 12 %.',
    hint: 'Switch to "fraction" to work with 0.12.',
  },
  W_COLUMN_PARTLY_NUMERIC: {
    title: '{count} {count|value|values} in “{column}” {count|is|are} not a number.',
    hint: 'They are marked as invalid. Treat the column as text if it is not numeric.',
  },
  W_MERGED_CELLS: {
    title:
      '{header|0=Merged cells: only the first cell of each keeps its value.|other=Merged cells: the header text was repeated across them.}',
    hint: 'Data cells are never filled in.',
  },
  W_FORMULA_NO_VALUE: {
    title: '{count} {count|formula has|formulas have} no saved result: treated as missing.',
    hint: 'Open the file in your spreadsheet program, recalculate and save.',
  },
  I_TRIMMED_EMPTY: { title: 'Empty rows and columns at the edges were ignored.', hint: '' },
  E_SHEET_EMPTY: { title: 'The sheet “{sheet}” is empty.', hint: 'Choose another sheet.' },
  W_WORKER_FALLBACK: {
    title: 'Importing on the main thread.',
    hint: 'The page may pause briefly for large files.',
  },
  E_CLIPBOARD_DENIED: {
    title: 'Access to the clipboard was denied.',
    hint: 'Click in the box and press Ctrl+V (Cmd+V on Mac).',
  },
  E_CLIPBOARD_EMPTY: {
    title: 'The clipboard does not contain a table.',
    hint: 'Copy cells from a spreadsheet first.',
  },
  I_CLIPBOARD_PRECISION: {
    title: 'Pasted values have the precision shown in the spreadsheet.',
    hint: 'Import the file itself if you need every stored digit.',
  },
  I_DUPLICATE_HEADER_RENAMED: {
    title: 'Repeated column names were numbered.',
    hint: 'Rename the columns if you wish.',
  },
  I_EMPTY_HEADER_NAMED: {
    title: 'Columns without a name were named "Column n".',
    hint: 'Rename them to describe the quantity.',
  },
  I_MULTIPLE_TABLES: {
    title: 'This sheet contains {count} separate tables.',
    hint: 'To import only some of them, use “Choose tables”; or keep the whole sheet as one table.',
  },
  I_BLOCK_TRANSPOSED: {
    title:
      '{count|The table {range} has its|The tables {range} have their} variables in rows: rows and columns were swapped.',
    hint: 'Each record is labelled with its sheet column (for example “Column D”).',
  },
  I_STACKED_BLOCKS: {
    title: '{count} tables were stacked into one dataset.',
    hint: '{labels|0=No label column was added; each row keeps its position in the sheet.|other=Label columns record which table each row came from.}',
  },
  // Missing data
  I_MISSING_VALUES: {
    title: '{count} missing {count|value|values} ({tokens}); not converted to zero.',
    hint: 'Missing cells are left out of statistics and fits, and counted.',
  },
  I_SHEET_ERRORS: {
    title: '{count} spreadsheet {count|error|errors} (for example {example}) treated as missing.',
    hint: 'The original text is still visible in the table.',
  },
  W_ALL_MISSING: {
    title: 'The column “{column}” has no valid values.',
    hint: 'It cannot be used as an axis.',
  },
  I_ROWS_INACTIVE: {
    title: 'n = {n} of {total} ({missing} missing, {excluded} excluded, {filtered} filtered).',
    hint: 'Only active rows are used in statistics and fits.',
  },
  I_SAMPLE_DIFFERS: {
    title: '{column}: n = {nCol}; fit: n = {nFit} pairs.',
    hint: 'The fit needs both x and y in the same row.',
  },
  I_SPLIT_NO_VALUE: {
    title: '{count} {count|row has|rows have} no value in {column}: shown as the group “(no value)”.',
    hint: 'These rows stay in the plot; they are never dropped.',
  },
  // Input
  E_NOT_A_NUMBER: { title: 'Enter a number (for example {example}).', hint: '' },
  E_RANGE_INVERTED: { title: 'The minimum must be smaller than the maximum.', hint: '' },
  E_LOG_RANGE_NONPOSITIVE: { title: 'A logarithmic axis needs positive limits.', hint: '' },
  E_UNCERTAINTY_NEGATIVE: { title: 'An uncertainty cannot be negative.', hint: '' },
  W_PERCENT_OVER_100: {
    title: 'Uncertainty above 100 % of the value.',
    hint: 'Check that this is intended.',
  },
  W_UNCERTAINTY_ROWS_INVALID: {
    title:
      '{count} {count|row has|rows have} a negative, non-numeric or one-sided uncertainty: no bar is drawn.',
    hint: 'The values are never made positive automatically. The rows are highlighted.',
  },
  W_UNCERTAINTY_UNIT_MISMATCH: {
    title: 'The unit of “{u}” ({uu}) differs from the unit of “{col}” ({cu}); nothing was converted.',
    hint: 'Make sure both columns use the same unit.',
  },
  E_DERIVED_UNCERTAINTY: {
    title: 'Uncertainty columns are not available for derived columns.',
    hint: 'Uncertainty propagation is not implemented.',
  },
  I_UNCERTAINTY_ROWS_MISSING: {
    title: '{count} {count|row has|rows have} no uncertainty value.',
    hint: 'They are shown without a bar.',
  },
  I_ZERO_VALUE_PERCENT: {
    title: '{count} {count|value is|values are} zero: the percentage bar has zero length.',
    hint: '',
  },
  E_COLUMN_NOT_NUMERIC: {
    title: '“{column}” is not numeric.',
    hint: 'Choose a numeric column, or change how the column is read.',
  },
  E_DUPLICATE_CATEGORY: {
    title: 'Some categories repeat.',
    hint: 'Use "mean per category" to summarise them.',
  },
  I_BAR_LINEAR_ONLY: { title: 'Bars start at zero: a logarithmic scale is not available.', hint: '' },
  E_DUPLICATE_COLUMN_NAME: {
    title: 'Another column already has this name. Choose a different one.',
    hint: '',
  },
  E_EMPTY_NAME: { title: 'The name cannot be empty.', hint: '' },
  E_EXCLUSION_NOTE_REQUIRED: {
    title: 'Say why this outlier candidate is excluded.',
    hint: 'An exclusion should have a physical or experimental reason.',
  },
  // Numerical
  E_TOO_FEW_POINTS: {
    title: 'A {model} fit needs at least {needed} points; the active sample has {n}.',
    hint: 'Add measurements or restore excluded rows.',
  },
  E_TOO_FEW_DISTINCT_X: {
    title: 'Degree {k} needs at least {p} distinct x values; there are {d}.',
    hint: 'Lower the degree or measure at more x values.',
  },
  E_CONSTANT_X: {
    title: 'All x values are equal.',
    hint: 'A slope cannot be estimated without variation in x.',
  },
  E_X_EFFECTIVELY_CONSTANT: {
    title: 'The x values differ only in the last digits.',
    hint: 'Change the unit or subtract an offset from x.',
  },
  E_ILL_CONDITIONED: {
    title: 'The fit is numerically unstable.',
    hint: 'Lower the polynomial degree or rescale x.',
  },
  W_ILL_CONDITIONED: {
    title: 'The results may lose several significant digits.',
    hint: 'Consider a lower degree or centring x.',
  },
  W_FEW_DOF: {
    title: 'Only {df} degrees of freedom (t = {t}): intervals are wide.',
    hint: 'More measurements give more reliable uncertainties.',
  },
  W_HIGH_LEVERAGE: {
    title: 'The fit depends almost entirely on {axis|column=columns|other=rows} {rows}.',
    hint: 'Check those points; a single point should not decide the model.',
  },
  I_EQUATION_CENTRED: {
    title: 'The equation is shown in centred form.',
    hint: '{reason|rounding=Rounded coefficients in the original form would not reproduce the curve.|offset=The x values are far from 0 compared with their range: in the original form the coefficients would be strongly correlated and the constant term would be an extrapolation to x = 0.} Copy the full-precision values if needed.',
  },
  I_EXACT_FIT: {
    title: 'The residuals are zero to machine precision.',
    hint: 'Uncertainties of the parameters cannot be estimated.',
  },
  I_R2_UNDEFINED: { title: 'R² is not defined: all y values are equal.', hint: '' },
  E_LOG_DOMAIN_FIT: {
    title: 'The {model} model needs positive values; {axis|column=columns|other=rows} {rows} are not.',
    hint: 'Exclude those rows on purpose or choose another model. Nothing is removed silently.',
  },
  W_LOG_AXIS_HIDDEN: {
    title: '{count} {count|point|points} ≤ 0 cannot be shown on a log axis.',
    hint: 'Only the drawing is affected: fits and statistics still use them.',
  },
  W_LOG_AXIS_BARS_CLIPPED: {
    title: '{count} lower error-bar {count|end|ends} ≤ 0 cannot be shown on a log axis.',
    hint: 'Those bars are drawn to the edge of the axis.',
  },
  I_DATE_AXIS_LINEAR: {
    title: 'The {axis} axis shows dates, so it stays linear: a logarithmic scale is not available for dates.',
    hint: 'Dates have no natural zero. For a log scale, plot a numeric time column (for example elapsed seconds).',
  },
  E_OVERFLOW: {
    title: 'Values too large or too small for double precision.',
    hint: 'Change the unit (for example mV instead of V).',
  },
  W_CURVE_TRUNCATED: { title: 'The curve is interrupted where it leaves the representable range.', hint: '' },
  W_SMALL_SAMPLE: {
    title: 'Small sample: the SD itself is uncertain by about ±{pct} %.',
    hint: 'Based on 1/√(2(n − 1)) under a normal assumption.',
  },
  I_ZERO_SPREAD: {
    title:
      '{scope|column=The {n} values are all identical|groups={count} {count|group has|groups have} identical values}: the spread is zero.',
    hint: 'SD, SEM and the confidence interval are then 0, which is not a real uncertainty: the values may be rounded to the instrument resolution. Record more digits, or state the resolution as a measurement uncertainty.',
  },
  I_SINGLE_OBSERVATION: { title: 'A single observation: no spread can be computed.', hint: '' },
  I_QUARTILES_NEED_4: { title: 'Quartiles need at least 4 values.', hint: '' },
  W_GROUP_SINGLE: {
    title: '{count} {count|group has|groups have} a single observation: no bar for {count|it|them}.',
    hint: '',
  },
  W_GROUP_PAIR_CI: {
    title:
      '{count} {count|group has|groups have} only 2 observations: the {level} % interval uses t = {t} and is very wide.',
    hint: 'With 1 degree of freedom the t factor is large. More replicates per group give a narrower interval.',
  },
  W_GROUP_X_VARIES: {
    title:
      '{count} {count|group mixes|groups mix} different x values: {count|its mean is|their means are} drawn at the mean x.',
    hint: 'Group by identical x, or by a column whose groups share a single x value.',
  },
  W_SPLIT_TOO_MANY_GROUPS: {
    title: '{column} has {count} different values (limit {limit}): the data are drawn without groups.',
    hint: 'Choose a column with fewer values, or filter the data first.',
  },
  I_SEM_COVERAGE: {
    title: '±1 SEM covers about {coverage} % for n = {n}.',
    hint: 'Consider showing the 95 % confidence interval instead.',
  },
  W_EXTRAPOLATION: {
    title:
      '{series}: the {pattern|dot=dotted|dashdot=dash-dot|longdashdot=long dash-dot|longdash=long-dashed|dash=dashed} part of the fit is an extrapolation beyond the data.',
    hint: 'The model has not been tested there.',
  },
  W_MANY_POINTS: {
    title: '{count} points: interaction may slow down.',
    hint: 'All points are drawn; nothing is subsampled.',
  },
  E_TRANSFORM_DOMAIN: {
    title: '{count} {count|row is|rows are} outside the domain of {op}: marked as invalid.',
    hint: 'They are left out of statistics and fits, and listed.',
  },
  I_SELECTION_ONE_DATASET: {
    title: 'A selection applies to one dataset at a time: kept “{name}”.',
    hint: '',
  },
  E_PLOT_RENDER: { title: 'The plot could not be drawn: {reason}.', hint: 'Try reloading this area.' },
  E_INTERNAL_GUARD: { title: 'Internal error.', hint: 'Please report it. Your data is unchanged.' },
  E_HISTOGRAM_NO_DATA: {
    title: 'There are no valid values to count.',
    hint: 'Choose a numeric column with values.',
  },
  E_PLOT_NOT_CONFIGURED: { title: 'Choose the columns to plot.', hint: '' },
  // Storage
  E_STORAGE_UNAVAILABLE: {
    title: 'Browser storage is not available (private window or blocked site data).',
    hint: 'Use "Save project" to keep your work in a file.',
  },
  E_STORAGE_QUOTA: {
    title: 'Browser storage is full.',
    hint: 'Download the project, delete old projects, or continue without autosave.',
  },
  W_STORAGE_RETRY: {
    title: 'Autosave failed; it will retry at the next change.',
    hint: 'Your work in this tab is intact.',
  },
  I_PROJECT_READ_ONLY: {
    title: 'This project is open in another tab: this tab is read-only.',
    hint: 'Open it as a copy to edit it here.',
  },
  // Project file
  E_PROJECT_TOO_LARGE: { title: 'The project file is too large ({size} MB, limit {limit} MB).', hint: '' },
  E_PROJECT_NOT_JSON: {
    title: 'The file is not valid JSON.',
    hint: 'Choose a .sciplot file saved by this app.',
  },
  E_PROJECT_NOT_SCIPLOT: {
    title: 'The file is not a .sciplot project.',
    hint: 'To import data, use Import instead.',
  },
  E_PROJECT_NEWER_VERSION: {
    title: 'The project was made with a newer version (schema {v}).',
    hint: 'Update the app to open it.',
  },
  E_PROJECT_INVALID: {
    title: 'The project file is damaged: {summary}.',
    hint: 'Your current work was not changed.',
  },
  W_PROJECT_REPAIRED: {
    title: '{count} broken {count|reference was|references were} reset to defaults.',
    hint: 'Check the plot and the analysis settings.',
  },
  I_PROJECT_MIGRATED: {
    title: 'Project updated from schema {from} to schema {to}.',
    hint: 'Data and analysis settings were kept; new options start from their defaults. Your original file is unchanged; files saved from now on need this version of the app or later.',
  },
  W_PROJECT_TOO_LARGE_TO_REOPEN: {
    title: 'The project ({size} MB) exceeds the reopening limit ({limit} MB).',
    hint: '',
  },
  // Export
  E_EXPORT_FAILED: { title: 'Export failed: {reason}.', hint: '' },
}
