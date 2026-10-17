import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ColumnId } from '@/domain/model'
import { formatR2 } from '@/domain/format/number'
import { I18nProvider } from '@/i18n/I18nProvider'
import type { Lang } from '@/i18n/translate'
import { deriveNow } from '@/state/derived'
import { loadProject } from '@/state/projectStore'
import { column, fit, loadTestProject, notebook, plotWith, xySeries } from '@/features/inspector/testFixtures'
import { GroupFitTable } from './GroupFitTable'
import { param } from './fitFixtures'
import { parameterCells } from './parameterCells'

const clipboard = vi.hoisted(() => ({ texts: [] as string[] }))
vi.mock('@/platform/clipboard', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  writeClipboardText: vi.fn(async (text: string) => {
    clipboard.texts.push(text)
    return true
  }),
}))

// Two observers measuring y against x; C has one point only (no line can be fitted to it).
const A = { x: [1, 2, 3, 4, 5], y: [3.1, 4.9, 7.2, 8.8, 11.1] }
const B = { x: [1, 2, 3, 4, 5], y: [2.2, 5.1, 7.8, 11.2, 13.9] }
const C = { x: [3], y: [9] }

/** Ordinary least squares, written out (an oracle independent of runFit). */
function ols(x: number[], y: number[]) {
  const n = x.length
  const mx = x.reduce((a, b) => a + b) / n
  const my = y.reduce((a, b) => a + b) / n
  const sxx = x.reduce((a, v) => a + (v - mx) ** 2, 0)
  const sxy = x.reduce((a, v, i) => a + (v - mx) * (y[i] - my), 0)
  const b1 = sxy / sxx
  const b0 = my - b1 * mx
  const rss = x.reduce((a, v, i) => a + (y[i] - b0 - b1 * v) ** 2, 0)
  const tss = y.reduce((a, v) => a + (v - my) ** 2, 0)
  const s = Math.sqrt(rss / (n - 2))
  return { b0, b1, se0: s * Math.sqrt(1 / n + mx ** 2 / sxx), se1: s / Math.sqrt(sxx), r2: 1 - rss / tss }
}

function setup(lang: Lang = 'en') {
  const rows = [
    ...A.x.map((x, i) => [x, A.y[i], 'A']),
    ...B.x.map((x, i) => [x, B.y[i], 'B']),
    [C.x[0], C.y[0], 'C'],
  ]
  const doc = loadTestProject(
    notebook(
      {
        x: rows.map((r) => String(r[0])),
        y: rows.map((r) => String(r[1])),
        obs: rows.map((r) => String(r[2])),
      },
      [column('x'), column('y'), column('obs', { kind: 'categorical', role: 'group' })],
    ),
    plotWith({ series: [{ ...xySeries('x', 'y'), split: { column: 'obs' as ColumnId, overrides: [] } }] }),
    { fits: [{ ...fit({ type: 'linear' }), perGroup: true }] },
  )
  // The language's decimal mark (the fixtures fix the dot).
  loadProject({ ...doc, numberFormat: { decimal: 'auto' } })
  const series = deriveNow().series[0]
  render(
    <I18nProvider lang={lang}>
      <GroupFitTable series={series} lookOf={() => ({ color: '#0072B2', symbol: 'circle', open: false })} />
    </I18nProvider>,
  )
}

const cells = (group: string) => {
  const table = screen.getByTestId('fit-group-table')
  const tr = within(table).getByRole('rowheader', { name: group }).closest('tr')!
  return within(tr)
    .getAllByRole('cell')
    .map((c) => c.textContent)
}

describe('GroupFitTable — one row per group', () => {
  it('parameters ± SE, R² and n of each group, as an independent least-squares computation gives them', () => {
    setup()
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Group',
      'b₀',
      'b₁',
      'R²',
      'n',
      'Copy at full precision',
    ])
    const loc = { decimal: '.' as const }
    for (const [name, g] of [
      ['A', A],
      ['B', B],
    ] as const) {
      const o = ols(g.x, g.y)
      const v = (value: number, se: number) =>
        parameterCells(param('p', value, se), loc, { withUnit: false }).value
      expect(cells(name).slice(0, 4)).toEqual([
        v(o.b0, o.se0),
        v(o.b1, o.se1),
        formatR2(o.r2, loc, false),
        '5',
      ])
    }
  })

  it('a group that cannot be fitted says why, in its own row', () => {
    setup()
    expect(cells('C')[0]).toBe('No fit: A linear fit needs at least 3 points; the active sample has 1.')
    expect(cells('C')[1]).toBe('1')
    expect(screen.queryByRole('button', { name: 'Copy the fit of C at full precision' })).toBeNull()
  })

  it('copies one group at full precision, named', async () => {
    setup()
    clipboard.texts.length = 0
    await userEvent.click(screen.getByRole('button', { name: 'Copy the fit of B at full precision' }))
    const o = ols(B.x, B.y)
    const text = clipboard.texts[0]
    expect(text.split('\n').slice(0, 3)).toEqual(['group: B', 'model: linear', 'x: x; y: y'])
    const b1 = Number(/b₁ = (\S+) \(SE (\S+)\)/.exec(text)![1])
    expect(b1).toBeCloseTo(o.b1, 12)
    expect(text).toContain('n = 5')
  })

  it('shows the complete view of the group chosen below the table', async () => {
    setup()
    expect(screen.queryByTestId('fit-equation')).toBeNull()
    await userEvent.click(screen.getByRole('combobox', { name: 'Details of group' }))
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual(['A', 'B'])
    await userEvent.click(screen.getByRole('option', { name: 'A' }))
    expect(screen.getByTestId('fit-equation')).toHaveTextContent(/^y = .+·x$/)
    // Its own full-precision copy says whose fit it is, like the table's.
    clipboard.texts.length = 0
    await userEvent.click(screen.getByRole('button', { name: 'Copy at full precision' }))
    expect(clipboard.texts[0].split('\n').slice(0, 2)).toEqual(['group: A', 'model: linear'])
  })

  it('Italian: decimal comma and translated headers', () => {
    setup('it')
    expect(screen.getAllByRole('columnheader')[0]).toHaveTextContent('Gruppo')
    expect(cells('A')[1]).toMatch(/^\d+,\d+ ± \d+,\d+$/)
  })
})
