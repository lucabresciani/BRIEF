# Spreadsheet fixture generators

The binary fixtures in `tests/fixtures/import/` come from real applications, so that the importer is
not tested only against files written by its own library (no circular fixtures). Every value in them is
synthetic.

## Microsoft Excel (Windows, via COM)

`excel-fixtures.ps1` drives a local Excel installation and writes seven files:

- `excel-saved.xlsx`: a text-only first sheet, then a data sheet with a date column, a percent column,
  missing values and formulas with cached results (`#DIV/0!`, `#N/A`);
- `date1904.xlsx`: the 1904 date system;
- `merged-header.xlsx`: a merged group header and one merged cell in the data area;
- `data-from-A3.xlsx`: a table that starts at row 3;
- `micro-tables.xlsx`: several small tables per sheet, in the layouts lab workbooks often use:
  - `Grid`: a 2 × 3 grid of titled tables ("oak | plank 1" over "position | Width mm | Depth mm | area",
    six rows, `area` a formula), one empty row and column apart; header cells vary in case and trailing
    spaces from one table to the next;
  - `Transposed`: three tables with their variables in rows, stacked under "layers | 0", "layers | 2" and
    "layers | 4", with a remark typed after the last value of the first one;
  - `Paired`: two side-by-side tables under key/value lines with merged cells ("Tilt" over A1:C1, its
    value over D1:F1), the "h - h0 [mm]" column merged over C:D in every row (so column D is empty
    inside the table);
  - `Matrix`: a 2-D matrix (position down, time across) under a two-cell title;
- `biff8-tables.xls`: Excel 97–2003 (`SaveAs` FileFormat 56), two side-by-side tables, a merged group
  title and a merged data cell, è / µ / Ω text, a date and a percent column;
- `excel95-cp1252.xls`: Excel 5.0/95 (FileFormat 39, BIFF5), 8-bit Windows-1252 text (€, –, …).

```powershell
powershell -ExecutionPolicy Bypass -File scripts/fixtures/excel-fixtures.ps1 -OutDir tests/fixtures/import
```

Excel writes a timestamp into every file, so regenerating one fixture should not touch the others: pass
the file names to `-Only`, for example `-Only "micro-tables.xlsx,biff8-tables.xls"`.

Excel also records who saved a file and where. The script saves with the Office user name set to
`fixture` (and puts the previous name back when it ends), turns on `RemovePersonalInformation`, and then
removes the saved folder (`x15ac:absPath`) and the author fields from each `.xlsx`.

The script is UTF-8 with a BOM (Windows PowerShell 5.1 reads it as UTF-8 only then): keep the BOM when
editing it.

## LibreOffice

`libreoffice-saved.xlsx` and `libreoffice-saved.ods` are converted headless from `libreoffice-saved.csv`:

```sh
soffice --headless --infilter="CSV:44,34,76,1,,1033,false,true,,,false,,true" --convert-to xlsx libreoffice-saved.csv
soffice --headless --infilter="CSV:44,34,76,1,,1033,false,true,,,false,,true" --convert-to ods libreoffice-saved.csv
```

## Files neither application can write

Excel and LibreOffice always cache formula results, and `legacy.xls` is only a damaged 512-byte OLE
header, so these two come from SheetJS:

```sh
node scripts/fixtures/sheetjs-fixtures.mjs tests/fixtures/import
python -I scripts/fixtures/patch_formula.py <in.xlsx> <out.xlsx>   # removes the cached value of C2
```

## Privacy check

`check-fixtures.mjs` fails when any file under `tests/fixtures/` carries a saved folder, a user or temp
folder, the git name or e-mail of whoever runs it, an author, printer or company name, or a `.xls`
user name other than `fixture`. It inflates the parts of zipped workbooks and reads binary files both
as 8-bit and as UTF-16 text. Vitest runs it
(`src/test/fixturesPrivacy.test.ts`); run it by hand after regenerating a fixture:

```sh
node scripts/fixtures/check-fixtures.mjs
```

## Files that are not fixtures

**Performance workbooks** for the budgets in the main README (2 000 000 cells) are generated on the fly
with SheetJS for timing only and never committed: a 100 000 × 20 numeric table, and a 2000 × 1000 sheet
of 44 400 small titled tables (8 × 4, one empty row and column apart), written with `compression: true`.
They measure speed, not reading correctness, so being written by the library under test does not make
them circular. The dense one is 21 MB and is refused by the 20 MB sheet limit, as it should be.
