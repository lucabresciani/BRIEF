# Contributing

Thank you for helping to improve BRIEF. Bug reports, corrections to the science or the wording,
translations, tests and code are all welcome.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Security problems are
reported privately, as described in [SECURITY.md](SECURITY.md), never in a public issue.

## Before you start

- **Bugs:** open an issue with the bug report form. A small file that reproduces the problem helps
  more than anything else; make sure it contains no personal or confidential data.
- **Features:** open an issue to discuss the idea before writing a large change, so that the design
  can be agreed first.
- **Small fixes** (typos, wording, an obvious bug with a test) can go straight to a pull request.

## Setting up

You need [Node.js](https://nodejs.org) 24 and npm 11.10 or later, the versions used by the continuous
integration (`.npmrc` sets `min-release-age`, which older npm versions do not know).

```bash
git clone https://github.com/lucabresciani/BRIEF.git
cd BRIEF
npm ci                            # install exactly the locked dependencies
npx playwright install chromium   # browser for the end-to-end tests
npm run dev                       # development server on http://localhost:5173
```

`@playwright/test` is pinned to an exact version; after it is upgraded, run
`npx playwright install chromium` again to download the matching browser.

## Checks

```bash
npm run typecheck   # TypeScript, strict, every project, plus src/domain compiled on its own
npm run lint        # ESLint, including the layer boundaries below
npm run format      # Prettier (format:check only reports)
npm test            # Vitest unit and component tests
npm run e2e         # Playwright end-to-end tests: builds, then tests the production build
npm run e2e:dist    # the same tests on the dist/ already built, without rebuilding
npm run verify      # everything the continuous integration runs
```

A pull request is ready for review when `npm run verify` passes.

### Screenshots

The images in `docs/images/` are made by `scripts/screenshots.mjs` from the production build, with
the bundled examples and the synthetic fixtures only. After a visible change, rebuild them and look
at each one before committing:

```bash
npm run build && npm run screenshots          # all of them
npm run screenshots -- hero-fit sheet-picker  # only some
```

The script serves `dist/` on a free port (never 4173, which the end-to-end tests use) and warns when
an image grows beyond 300 KB.

## How the code is organised

The layers are enforced by ESLint (`eslint.config.js`), so a wrong import fails the lint step:

- `src/domain/` is pure TypeScript: no React, no DOM, no state or storage libraries, no Plotly
  runtime. All the science lives here (import, statistics, fitting, uncertainty, figures, export,
  project files), and it is tested in Node.
- `src/state/` holds the zustand stores, undo and redo, and local persistence.
- `src/plot/` is the only module that loads the Plotly runtime.
- `src/workers/` parses imports and project files off the main thread. SheetJS is loaded there with
  `import()` and nowhere else; other modules may import its types only.
- `src/platform/` wraps browser APIs (IndexedDB, Web Locks, clipboard, files, service worker).
- `src/features/` and `src/components/` are the React interface. `src/components/ui/` holds the
  shadcn/ui primitives.

Raw imported data is never changed: everything shown is derived from it and from the project
settings.

## Text and translations

The interface is complete in English and Italian. Every user-facing string goes in both
`src/i18n/en.ts` and `src/i18n/it.ts` (and the issue catalogue in `issues.en.ts` and `issues.it.ts`),
with the same keys and the same `{placeholders}`. Tests fail when the two dictionaries differ, when
a key is no longer used, or when visible text uses an em or en dash as punctuation. Write natural
Italian rather than a word-for-word translation.

## Tests

- Every change in behaviour comes with a test that fails without the change.
- Unit tests sit next to the code as `*.test.ts` (run in Node); component tests are `*.test.tsx`
  (run in jsdom with Testing Library); end-to-end tests are in `e2e/`.
- Numerical code is checked against independent references: the NIST certified datasets in
  `tests/fixtures/nist/` and the values in `tests/fixtures/reference/`, which
  `scripts/oracle/reference_values.py` computes with the Python standard library and exact
  arithmetic (`python -I scripts/oracle/reference_values.py`). Do not loosen a tolerance to make a
  test pass; find out why the result moved.

### Spreadsheet fixtures

The workbooks in `tests/fixtures/import/` were saved by the real applications, so that the importer
is not tested only against files written by its own library. The Excel files can be regenerated only
on Windows with Microsoft Excel installed, using `scripts/fixtures/excel-fixtures.ps1`; the
LibreOffice and SheetJS files have their own commands. `scripts/fixtures/README.md` describes each
file and how to rebuild it.

Fixtures contain synthetic data only. `scripts/fixtures/check-fixtures.mjs` (also run by Vitest)
fails when a fixture carries a saved folder path, an author or company name, or your git name or
e-mail; run it after regenerating a file.

## Commits and pull requests

- Keep a pull request to one topic, and keep unrelated formatting changes out of it.
- Write commit subjects in the imperative mood, in English, under about 72 characters ("Fix the
  residual plot for a single point"), with a body that explains why when it is not obvious.
- Describe what changed and why in the pull request, link the issue it closes, and add a screenshot
  or a short recording for a visible change.
- Comments in the code are in English and explain why something is done, not what the next line
  does.
- Add a line to the "Unreleased" section of [CHANGELOG.md](CHANGELOG.md) for a change users will
  notice.

Contributions are accepted under the [MIT License](LICENSE) of the project.
