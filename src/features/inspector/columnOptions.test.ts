import { describe, expect, it, vi } from 'vitest'
import type * as Split from '@/domain/derive/split'
import { makeTranslator } from '@/i18n/translate'
import { deriveNow } from '@/state/derived'
import { DS, column, loadTestProject, notebook, plotWith, xySeries } from './testFixtures'
import { groupColumnItems } from './columnOptions'

const split = vi.hoisted(() => ({ grouped: [] as string[] }))
vi.mock('@/domain/derive/split', async (importOriginal) => {
  const actual = await importOriginal<typeof Split>()
  return {
    ...actual,
    columnGroups: (pc: Parameters<typeof actual.columnGroups>[0]) => {
      split.grouped.push(pc.columnId)
      return actual.columnGroups(pc)
    },
  }
})

const t = makeTranslator('en')

describe('groupColumnItems on a large table', () => {
  it('never groups a column in full once it has more values than a split can draw', () => {
    const n = 20_000
    const rows = Array.from({ length: n }, (_, i) => i)
    const dataset = notebook(
      {
        x: rows.map((i) => String(i)),
        y: rows.map((i) => String(i * 0.37)),
        fifty: rows.map((i) => String(i % 50)),
        fiftyOne: rows.map((i) => String(i % 51)),
        label: rows.map((i) => `L${i % 60}`),
        few: rows.map((i) => (i % 2 ? 'A' : 'B')),
      },
      [
        column('x'),
        column('y'),
        column('fifty'),
        column('fiftyOne'),
        column('label', { kind: 'categorical' }),
        column('few', { kind: 'categorical' }),
      ],
    )
    loadTestProject(dataset, plotWith({ series: [xySeries('x', 'few')] }))
    const view = deriveNow().views.get(DS)
    split.grouped = []
    const items = groupColumnItems(dataset, view, t, { none: 'None' })
    const byId = new Map(items.map((i) => [i.value as string, i]))

    // Exactly the limit can be split; one more value cannot (the pipeline's own rule, MAX_SPLIT_GROUPS).
    expect(byId.get('fifty')).toMatchObject({ disabled: false, hint: '50 groups' })
    for (const id of ['x', 'y', 'fiftyOne', 'label'])
      expect(byId.get(id)).toMatchObject({ disabled: true, hint: 'More than 50 different values' })
    expect(byId.get('few')).toMatchObject({ disabled: false, hint: '2 groups' })
    // Only the columns a split can draw are grouped (their counts are the figure's).
    expect(split.grouped.sort()).toEqual(['few', 'fifty'])
  })
})
