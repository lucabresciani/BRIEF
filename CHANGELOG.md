# Changelog

All notable changes to this project are documented in this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-10-17

First public release.

### Added

- **Import:** paste from Excel, Google Sheets or LibreOffice; CSV, TSV and TXT files with detection
  of the delimiter, decimal comma, encoding, header, units row and preamble; XLSX, XLS (Excel
  97-2003 and 5.0/95) and ODS workbooks; drag and drop; an import preview that explains ambiguous
  decisions. Missing values are never turned into zero and no row is dropped silently.
- **Sheet picker** for workbooks with several small tables per sheet: every table is outlined, and
  tables can be picked by click, range or keyboard, then imported separately or merged into one
  dataset with label columns taken from their titles.
- **Lab notebook:** declare quantities and units, type values while measuring and see the plot
  update.
- **Plots:** scatter, line, bar (mean with SD, SEM or confidence interval), histogram and box plot;
  several series and datasets on the same axes; several plots per project in tabs, two side by side
  or four in a grid; a series split by a column, with one colour and marker per group.
- **Exploration:** hover with values and units, zoom, pan, box and lasso selection linked to the
  table, non-destructive exclusion of points with a reason, filters, operation history, undo and
  redo.
- **Fitting:** linear, polynomial, exponential and power-law least squares with parameters and
  standard errors, confidence intervals, R² and adjusted R², residual plot, confidence and
  prediction bands, and warnings about leverage and conditioning; one fit per group for a split
  series. Results are checked against the NIST certified datasets.
- **Uncertainty:** absolute, percent, per-row or asymmetric error bars on x and y, with their
  meaning (standard or expanded) stated in the legend and caption; SD, SEM or confidence interval of
  replicate groups.
- **Statistics:** n, missing values, mean, median, SD, SEM, confidence interval of the mean,
  quartiles, IQR and outlier candidates, each with an explanation.
- **Export:** PNG, SVG and CSV (original data or an analysis table with predictions and residuals,
  in a standard or an Excel-Italian format). Figures state the sample and the model.
- **Projects:** versioned `.sciplot` files, validated on open; automatic local save with restore on
  reload; recent projects.
- **Learning aids:** plot recommendations with reasons, contextual hints, three experience levels, a
  help panel on methods and conventions, and guided examples.
- English and Italian interface, keyboard operation, reduced motion support, and offline use after
  the first visit.

[Unreleased]: https://github.com/lucabresciani/BRIEF/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/lucabresciani/BRIEF/releases/tag/v0.1.0
