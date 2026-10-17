# Vendored packages

## SheetJS Community Edition 0.20.3

- **File:** `xlsx-0.20.3.tgz`, stored unmodified.
- **Source:** <https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz>, from the official SheetJS
  distribution at <https://cdn.sheetjs.com>.
- **Integrity (SHA-512):**
  `sha512-oLDq3jw7AcLqKWH2AhCpVTZl8mf6X2YReP+Neh0SJUzV/BdZYjth94tG5toiMB1PPrYtxOCfaoUCkvtuH+3AJA==`
- **Licence:** Apache-2.0, Copyright (C) 2012-present SheetJS LLC. The full text is in the archive
  (`package/LICENSE`) and in [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md).
- **Used by:** the import worker in `src/workers/`, which loads it on demand to read XLSX, XLS and ODS
  workbooks.

`package.json` depends on the archive as `"xlsx": "file:vendor/xlsx-0.20.3.tgz"`, and
`package-lock.json` records the integrity hash above, so `npm ci` refuses a file that differs.

### Why it is vendored

The `xlsx` package on the npm registry stops at 0.18.5, which has known vulnerabilities:
CVE-2023-30533 (prototype pollution when reading a crafted file) and CVE-2024-22363 (regular
expression denial of service). Both are fixed in later releases, which SheetJS publishes only on its
own CDN. Keeping the tarball in the repository means that installing never depends on a host other
than the npm registry, and that every clone builds from exactly the same bytes.

### Checking the archive

```bash
node -e "const c=require('node:crypto');const b=require('node:fs').readFileSync('vendor/xlsx-0.20.3.tgz');console.log('sha512-'+c.createHash('sha512').update(b).digest('base64'))"
```

The output must match the integrity value above and the `node_modules/xlsx` entry of
`package-lock.json`.

### Updating

1. Pick a version listed at <https://cdn.sheetjs.com> and read its changelog, for example
   <https://cdn.sheetjs.com/xlsx-0.20.4/package/CHANGELOG.md>.
2. Download `https://cdn.sheetjs.com/xlsx-0.20.4/xlsx-0.20.4.tgz` into this folder and delete the old
   archive.
3. Run `npm install --save-exact ./vendor/xlsx-0.20.4.tgz`. Check that `package.json` now reads
   `"xlsx": "file:vendor/xlsx-0.20.4.tgz"` and that the integrity in `package-lock.json` changed.
4. Update this file (version, URLs, integrity) and the SheetJS entries in `THIRD_PARTY_NOTICES.md`.
5. Run `npm run verify`. The import tests read the workbooks in `tests/fixtures/import/`, which cover
   XLSX, XLS (BIFF8 and Excel 5.0/95), ODS, 1904 dates, merged cells and formulas without cached
   values.
