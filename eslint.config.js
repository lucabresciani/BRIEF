import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

/**
 * SheetJS (~1 MB) and its code pages (~0.5 MB) are separate lazy chunks: src/workers loads them with
 * import(), which this rule does not see; a static import anywhere in src may only import types.
 */
const XLSX_LAZY = {
  group: ['xlsx/*'],
  message: 'SheetJS subpaths (xlsx/dist/cpexcel…) are loaded with import() in src/workers only.',
  allowTypeImports: true,
}

/** Layer boundaries: the scientific domain must stay framework-free and testable in Node. */
const DOMAIN_FORBIDDEN = [
  XLSX_LAZY,
  {
    group: ['react', 'react-dom', 'react/*', 'react-dom/*'],
    message: 'domain/ is pure TypeScript: no React.',
  },
  {
    group: ['zustand', 'zustand/*', 'immer', 'idb-keyval'],
    message: 'domain/ must not depend on state or storage.',
  },
  {
    group: ['@/state/*', '@/features/*', '@/plot/*', '@/platform/*', '@/workers/*', '@/components/*'],
    message: 'domain/ cannot import outer layers.',
  },
  {
    group: ['plotly.js-cartesian-dist-min', 'react-plotly.js', 'react-plotly.js/*'],
    message: 'Only src/plot touches the Plotly runtime.',
  },
]

export default defineConfig([
  globalIgnores([
    'dist',
    'dev-dist',
    'coverage',
    '.vitest',
    'playwright-report',
    'test-results',
    'vendor',
    'tests/fixtures',
    '.playwright-cli',
    'scripts/oracle',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: { ecmaVersion: 2024, globals: globals.browser },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      // This rule only says that the React Compiler will skip a component (TanStack Virtual returns
      // functions it cannot memoise). The app is not built with the compiler, so there is nothing to skip.
      'react-hooks/incompatible-library': 'off',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/plot/**', 'src/types/**', 'src/**/*.test.{ts,tsx}', 'src/test/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'plotly.js',
              message: 'Use src/plot for the runtime; type-only imports are allowed.',
              allowTypeImports: true,
            },
            {
              name: 'plotly.js-cartesian-dist-min',
              message: 'Only src/plot/plotly.ts imports the Plotly runtime.',
            },
            {
              name: 'react-plotly.js',
              message: 'Only src/plot/PlotCanvas.tsx uses react-plotly.js/factory.',
            },
            {
              name: 'xlsx',
              message: 'SheetJS is loaded with import() in src/workers only; type-only imports are allowed.',
              allowTypeImports: true,
            },
          ],
          patterns: [XLSX_LAZY],
        },
      ],
    },
  },
  {
    files: ['src/domain/**/*.ts'],
    ignores: ['src/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'plotly.js',
              message: 'Type-only imports of plotly.js are allowed in domain/figure.',
              allowTypeImports: true,
            },
            {
              name: 'xlsx',
              message: 'SheetJS is injected as a parameter (loaded lazily in the worker).',
              allowTypeImports: true,
            },
          ],
          patterns: DOMAIN_FORBIDDEN,
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'document', message: 'domain/ has no DOM.' },
        { name: 'window', message: 'domain/ has no DOM.' },
        { name: 'localStorage', message: 'domain/ has no storage.' },
      ],
    },
  },
  {
    files: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'e2e/**', '*.config.ts'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: { 'react-refresh/only-export-components': 'off' },
  },
  {
    // The i18n hooks live next to their provider on purpose (one import site for components).
    // Generated shadcn primitives export their cva variants and toast helpers next to the components.
    files: ['src/i18n/I18nProvider.tsx', 'src/components/ui/**'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
])
