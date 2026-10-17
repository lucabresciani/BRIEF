# NIST Statistical Reference Datasets

These files come from the NIST Statistical Reference Datasets (StRD) of the Information Technology
Laboratory, <https://www.itl.nist.gov/div898/strd/>. Each dataset carries certified values computed
by NIST with high-precision arithmetic, so a program's results can be compared with them digit by
digit.

The files are stored verbatim, byte for byte as NIST publishes them: ASCII text with CRLF line
endings and the original header with the certified values. `.gitattributes` marks
`tests/fixtures/**` as `-text`, so git never converts their line endings. Do not edit or reformat
them; replace a file only with a fresh download from NIST.

## Datasets

| Collection                                                                               | Files                                                                                         | Download folder                                                       |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| [Univariate Summary Statistics](https://www.itl.nist.gov/div898/strd/univ/homepage.html) | `Lew`, `Lottery`, `Mavro`, `Michelso`, `NumAcc1`, `NumAcc2`, `NumAcc3`, `NumAcc4`, `PiDigits` | `https://www.itl.nist.gov/div898/strd/univ/data/<name>.dat`           |
| [Linear Least Squares Regression](https://www.itl.nist.gov/div898/strd/lls/lls.shtml)    | `Norris`, `Pontius`, `Filip`, `Wampler1`, `Wampler2`, `Wampler3`, `Wampler4`, `Wampler5`      | `https://www.itl.nist.gov/div898/strd/lls/data/LINKS/DATA/<name>.dat` |

## Use in the tests

`src/test/nist.ts` reads the data and the certified values from these files. The statistics tests
(`src/domain/stats/`) compare the mean and the standard deviation with the univariate values; the
fitting tests (`src/domain/fit/`) compare coefficients, standard errors, the residual standard
deviation and R² with the regression values, using the log relative error (the number of correct
significant digits) as the measure of agreement.

## Licence

The StRD are data published by the National Institute of Standards and Technology, an agency of the
United States Government. Works of the US Government are not subject to copyright protection in the
United States (17 U.S.C. § 105). They are redistributed here unchanged, with NIST credited as the
source.
