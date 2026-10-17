/**
 * Records of a dataset stacked from several sheet tables: every table has its own row 5,
 * so the hover and the caption name the table, as the data table and the issue texts already do.
 */
import { describe, expect, it } from 'vitest'
import { blockOf } from '@/domain/derive/recordPosition'
import type { RawRegion } from '@/domain/model'
import { makeTranslator } from '@/i18n/translate'
import { buildFigure } from './buildFigure'
import { recordLabel } from './labels'
import { deriveOnce, exclusionOf, figureContext, importCsv, plotOf, series, type Imported } from './testing'

const CSV = ['d,P', '1,10', '2,20', '3,30', '1,11', '2,21', '3,31'].join('\n')

/** Two tables of three records stacked on import: sheet rows 3–5 under "oak", again 3–5 under "pine". */
function stacked(): Imported {
  const base = importCsv(CSV, 'ds_s', 'sheet.xlsx')
  const region: RawRegion = {
    orientation: 'columns',
    labelColumns: [],
    blocks: [
      { range: 'B2:C5', label: 'oak <i>', firstRow: 1, rowCount: 3 },
      { range: 'E2:F5', label: 'pine', firstRow: 4, rowCount: 3 },
    ],
  }
  const raw = {
    ...base.raw,
    source: { ...base.raw.source, kind: 'xlsx' as const, region },
    sourceRow: Int32Array.from([2, 3, 4, 5, 3, 4, 5]),
  }
  return { ...base, raw }
}

const t = makeTranslator('en')

describe('a stacked dataset in the figure', () => {
  const ds = stacked()
  const plot = plotOf({ series: [series('ser_1', ds, 'd', 'P')] })
  const d = deriveOnce([ds], plot, { exclusions: [exclusionOf('exc_1', ds, [2, 4, 5])] })
  const f = buildFigure(d, figureContext({ t }))
  const points = (f.data as { uid: string; customdata: unknown[][]; hovertemplate: string }[]).find((x) =>
    x.uid.endsWith('__points'),
  )!

  it('the view knows the tables of its records', () => {
    const view = d.views.get(ds.dataset.id)!
    expect(view.recordBlocks?.map((b) => b.label)).toEqual(['oak <i>', 'pine'])
    expect(blockOf(view.recordBlocks!, 4)).toBe('pine')
  })

  it('the hover names the table of the point, escaped, instead of a bare row number', () => {
    const byRow = new Map(points.customdata.map((c) => [c[0], c[1]]))
    expect(byRow.get(1)).toBe('oak &lt;i&gt; · row 3')
    expect(byRow.get(6)).toBe('pine · row 5')
    expect(points.hovertemplate).toContain('<br>%{customdata[1]}')
    expect(points.hovertemplate).not.toContain('Row %{customdata[1]}')
  })

  it('the caption lists excluded records per table', () => {
    expect(f.caption.join('\n')).toContain(
      'Excluded oak <i> · row 4; pine · rows 3, 4 (Measurement problem).',
    )
  })

  it('recordLabel (bar hover) names the table too', () => {
    expect(recordLabel(d.views.get(ds.dataset.id)!, 5, t)).toBe('pine · row 4')
  })

  it('a single table keeps "Row n"', () => {
    const one = importCsv(CSV, 'ds_one')
    const d1 = deriveOnce([one], plotOf({ series: [series('ser_1', one, 'd', 'P')] }))
    const f1 = buildFigure(d1, figureContext({ t }))
    const p1 = (f1.data as { uid: string; customdata: unknown[][]; hovertemplate: string }[])[0]
    expect(p1.customdata[0][1]).toBe(2)
    expect(p1.hovertemplate).toContain('Row %{customdata[1]}')
  })
})
