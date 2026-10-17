import { describe, expect, it } from 'vitest'
import { predict } from '@/domain/fit/band'
import type { FitOk } from '@/domain/derive/types'
import { deriveOnce, fitOf, importCsv, plotOf, series } from '@/domain/figure/testing'
import { analysisRows, splitForCsv } from './csv'

const ds = importCsv(
  'x,y,who\n1,3.1,A\n1,2.0,B\n2,4.9,A\n2,5.1,B\n3,7.1,A\n3,7.9,B\n4,8.9,A\n4,11.1,B\n6,9.0,\n',
  'ds_csv_g',
)
const split = { column: ds.col('who'), overrides: [] }

function exportOf(perGroup: boolean) {
  const d = deriveOnce([ds], plotOf({ series: [series('s', ds, 'x', 'y', { split })] }), {
    fits: [fitOf('f', 's', { perGroup })],
  })
  const s = d.series[0]
  const fit = s.fit?.status === 'ok' ? s.fit : null
  const rows = analysisRows(
    {
      view: s.view,
      columns: ds.dataset.columns,
      sample: s.data.sample,
      fit,
      fitXColumn: s.spec.x,
      predict: fit ? (x) => predict(fit, x) : undefined,
      split: splitForCsv(s),
    },
    '.',
  )
  return { rows, s }
}

describe('analysis CSV of a split series', () => {
  it('a "group" column before the status; the rows without a value have an empty group cell', () => {
    const { rows } = exportOf(false)
    expect(rows[0]).toEqual(['row', 'x', 'y', 'who', 'group', 'status', 'in_fit', 'predicted', 'residual'])
    expect(rows.slice(1).map((r) => r[4])).toEqual(['A', 'B', 'A', 'B', 'A', 'B', 'A', 'B', ''])
  })

  it('fitted per group: each row takes in_fit / predicted / residual from its own group fit', () => {
    const { rows, s } = exportOf(true)
    expect(s.fit).toBeNull()
    const [a, b] = s.split!.groups.map((g) => g.fit as FitOk)
    const body = rows.slice(1)
    for (const [k, r] of body.slice(0, 8).entries()) {
      const fit = k % 2 === 0 ? a : b
      const x = Number(r[1])
      expect(r[6]).toBe('1')
      expect(Number(r[7])).toBe(predict(fit, x))
      const used = fit.provenance.rowIdsUsed.indexOf(s.data.rowIds[k] as never)
      expect(Number(r[8])).toBe(fit.residuals[used])
    }
    // The group without a value could not be fitted: no prediction, not in a fit, never dropped.
    expect(body[8].slice(4)).toEqual(['', 'active', '0', '', ''])
  })

  it('a row whose group could not be drawn (y missing) keeps its group value, never ""', () => {
    const gap = importCsv('x,y,who\n1,1,A\n2,2,A\n3,3,A\n4,,C\n5,5,\n', 'ds_csv_gap')
    const d = deriveOnce(
      [gap],
      plotOf({ series: [series('s', gap, 'x', 'y', { split: { column: gap.col('who'), overrides: [] } })] }),
      { fits: [fitOf('f', 's', { perGroup: true })] },
    )
    const s = d.series[0]
    expect(s.split!.groups.map((g) => g.key)).toEqual(['A', '']) // C has nothing to draw
    const rows = analysisRows(
      { view: s.view, columns: gap.dataset.columns, sample: s.data.sample, split: splitForCsv(s) },
      '.',
    )
    expect(rows.slice(1).map((r) => [r[4], r[5]])).toEqual([
      ['A', 'active'],
      ['A', 'active'],
      ['A', 'active'],
      ['C', 'missing'],
      ['', 'active'],
    ])
    // in_fit comes from group A's own fit; C and the no-value row have none.
    expect(rows[0].slice(4)).toEqual(['group', 'status', 'in_fit', 'residual'])
    expect(rows.slice(1).map((r) => r[6])).toEqual(['1', '1', '1', '0', '0'])
  })

  it('not split: unchanged (no group column)', () => {
    const d = deriveOnce([ds], plotOf({ series: [series('s', ds, 'x', 'y')] }))
    expect(splitForCsv(d.series[0])).toBeUndefined()
  })
})
