import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SERIES_COLORS } from '@/domain/figure/palette'
import {
  DEFAULT_SERIES_STYLE,
  type ColumnId,
  type FitModel,
  type PlotSpec,
  type XYSeriesSpec,
} from '@/domain/model'
import { I18nProvider } from '@/i18n/I18nProvider'
import { makeTranslator, type Lang } from '@/i18n/translate'
import { undo, useProjectStore } from '@/state/projectStore'
import { StylePanel } from './StylePanel'
import { DS, column, fit, loadTestProject, notebook, plotWith, xySeries } from './testFixtures'

const t = makeTranslator('en')
const dataset = () =>
  notebook(
    {
      x: ['1', '2', '3', '4', '5', '6'],
      y: ['2', '4', '7', '8', '11', '12'],
      g: ['A', 'A', 'A', 'B', 'B', 'B'],
    },
    [column('x'), column('y'), column('g', { kind: 'categorical', role: 'group' })],
  )

function renderWith(
  series: XYSeriesSpec,
  opts: { plot?: Partial<PlotSpec>; fits?: FitModel[]; lang?: Lang } = {},
) {
  loadTestProject(dataset(), plotWith({ series: [series], ...opts.plot }), {
    fits: (opts.fits ?? []).map((m) => fit(m)),
  })
  render(
    <I18nProvider lang={opts.lang ?? 'en'}>
      <StylePanel />
    </I18nProvider>,
  )
}

const withStyle = (paletteIndex: number) => ({
  ...xySeries('x', 'y'),
  style: { ...DEFAULT_SERIES_STYLE, paletteIndex },
})
const splitByG = (overrides: NonNullable<XYSeriesSpec['split']>['overrides'] = []): XYSeriesSpec => ({
  ...xySeries('x', 'y'),
  split: { column: 'g' as ColumnId, overrides },
})
const doc = () => useProjectStore.getState().doc
const choose = async (label: string, option: string) => {
  await userEvent.click(screen.getByRole('combobox', { name: label }))
  await userEvent.click(await screen.findByRole('option', { name: option }))
}
/** The colour and marker of a group's swatch in the Groups list. */
const groupSwatch = (key: string) => {
  const row = document.querySelector(`[data-group-key="${key}"]`)!
  const svg = row.querySelector('[data-swatch]')!
  return { color: svg.getAttribute('data-color'), symbol: svg.getAttribute('data-swatch') }
}

describe('StylePanel series colour and marker', () => {
  it('names the 8 palette colours and checks the one drawn, also for an index past the palette', async () => {
    renderWith(withStyle(9))
    const names = [
      'Blue',
      'Vermillion',
      'Bluish green',
      'Reddish purple',
      'Ochre',
      'Sky blue',
      'Wine',
      'Black',
    ]
    const group = screen.getByRole('radiogroup', { name: t('style.color') })
    expect(
      within(group)
        .getAllByRole('radio')
        .map((r) => r.getAttribute('aria-label')),
    ).toEqual(names)
    // 9 is drawn with the 2nd colour (the figure cycles the palette).
    expect(screen.getByRole('radio', { name: 'Vermillion' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Blue' })).toHaveAttribute('aria-checked', 'false')
    await userEvent.click(screen.getByRole('radio', { name: 'Black' }))
    expect(doc().plots[0].series[0].style.paletteIndex).toBe(7)
  })

  it('names the colours in Italian', () => {
    renderWith(withStyle(0), { lang: 'it' })
    const group = screen.getByRole('radiogroup', { name: 'Colore' })
    expect(
      within(group)
        .getAllByRole('radio')
        .map((r) => r.getAttribute('aria-label')),
    ).toEqual([
      'Blu',
      'Vermiglio',
      'Verde bluastro',
      'Viola rossastro',
      'Ocra',
      'Azzurro',
      'Bordeaux',
      'Nero',
    ])
  })

  it('offers the diagonal cross among the marker symbols', async () => {
    renderWith(withStyle(0))
    await userEvent.click(screen.getByRole('combobox', { name: t('style.marker') }))
    expect(await screen.findByRole('option', { name: t('style.symbols.x') })).toBeInTheDocument()
  })
})

describe('StylePanel groups of a split series', () => {
  it('lists each group with its drawn colour and marker, and offers no series colour that would not show', () => {
    renderWith(splitByG())
    expect(groupSwatch('A')).toEqual({ color: SERIES_COLORS[0], symbol: 'circle' })
    expect(groupSwatch('B')).toEqual({ color: SERIES_COLORS[1], symbol: 'square' })
    // One split series: the groups have their own colours and markers.
    expect(screen.queryByRole('radiogroup', { name: t('style.color') })).toBeNull()
    expect(screen.queryByRole('combobox', { name: t('style.marker') })).toBeNull()
    expect(screen.getByText(t('style.splitColorNote', { markers: 'groups' }))).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Colour of B' })).toHaveTextContent('Automatic (Vermillion)')
    expect(screen.getByRole('combobox', { name: 'Marker of B' })).toHaveTextContent('Automatic (Square)')
  })

  it('overrides the colour and the marker of one group, then resets it to automatic (undoable)', async () => {
    renderWith(splitByG())
    await choose('Colour of B', 'Wine')
    expect(doc().plots[0].series[0].split?.overrides).toEqual([{ key: 'B', paletteIndex: 6, symbol: 'auto' }])
    await choose('Marker of B', t('style.symbols.x'))
    expect(doc().plots[0].series[0].split?.overrides).toEqual([{ key: 'B', paletteIndex: 6, symbol: 'x' }])
    expect(groupSwatch('B')).toEqual({ color: '#882255', symbol: 'x' })
    expect(groupSwatch('A')).toEqual({ color: SERIES_COLORS[0], symbol: 'circle' })

    await userEvent.click(screen.getByRole('button', { name: 'Reset B to automatic' }))
    expect(doc().plots[0].series[0].split?.overrides).toEqual([])
    expect(groupSwatch('B')).toEqual({ color: SERIES_COLORS[1], symbol: 'square' })
    expect(screen.queryByRole('button', { name: 'Reset B to automatic' })).toBeNull()

    undo()
    expect(doc().plots[0].series[0].split?.overrides).toEqual([{ key: 'B', paletteIndex: 6, symbol: 'x' }])
  })

  it('setting a group back to automatic on both fields removes its override, older duplicates included', async () => {
    renderWith(
      splitByG([
        { key: 'A', paletteIndex: 3, symbol: 'auto' },
        { key: 'A', paletteIndex: 5, symbol: 'diamond' },
      ]),
    )
    // The figure reads the first entry of a key.
    expect(groupSwatch('A').color).toBe(SERIES_COLORS[3])
    await choose('Colour of A', 'Automatic (Blue)')
    // A duplicate left behind would have become the override once the first was removed.
    expect(doc().plots[0].series[0].split?.overrides).toEqual([])
    expect(groupSwatch('A')).toEqual({ color: SERIES_COLORS[0], symbol: 'circle' })
  })

  it('reset all clears every override', async () => {
    renderWith(
      splitByG([
        { key: 'A', paletteIndex: 3, symbol: 'auto' },
        { key: 'B', paletteIndex: null, symbol: 'x' },
      ]),
    )
    await userEvent.click(screen.getByRole('button', { name: t('style.groupsResetAll') }))
    expect(doc().plots[0].series[0].split?.overrides).toEqual([])
  })
})

describe('StylePanel fit line', () => {
  const fitStyle = () => doc().fits[0].style

  it('scatter: automatic is solid at 2.25 px; pattern, width and colour are stored, and Automatic restores them', async () => {
    renderWith(withStyle(0), { fits: [{ type: 'linear' }] })
    expect(screen.getByRole('combobox', { name: t('style.fitDash') })).toHaveTextContent('Automatic (Solid)')
    expect(screen.getByRole('combobox', { name: t('style.fitWidth') })).toHaveTextContent(
      'Automatic (2.25 px)',
    )

    await choose(t('style.fitDash'), t('style.dashes.dot'))
    expect(fitStyle().dash).toBe('dot')
    await choose(t('style.fitWidth'), t('style.widthPx', { width: '3' }))
    expect(fitStyle().width).toBe(3)
    const colours = screen.getByTestId('fit-line-colors')
    await userEvent.click(within(colours).getByRole('radio', { name: 'Wine' }))
    expect(fitStyle().color).toEqual({ mode: 'palette', index: 6 })

    await userEvent.click(
      within(colours).getByRole('radio', { name: t('style.fitColorAuto', { mode: 'series' }) }),
    )
    await choose(t('style.fitWidth'), t('style.fitWidthAuto', { width: '2.25' }))
    await choose(t('style.fitDash'), 'Automatic (Solid)')
    expect(fitStyle()).toEqual({ color: { mode: 'series' }, dash: 'auto', width: 2 })
  })

  it('never offers 2 px as an explicit width: the stored 2 is the automatic width', async () => {
    renderWith(withStyle(0), { fits: [{ type: 'linear' }] })
    await userEvent.click(screen.getByRole('combobox', { name: t('style.fitWidth') }))
    // Units keep a non-breaking space before them.
    const options = (await screen.findAllByRole('option')).map((o) => o.textContent?.replace(/\s/g, ' '))
    expect(options).toEqual(['Automatic (2.25 px)', '1 px', '1.5 px', '2.5 px', '3 px', '4 px'])
  })

  it('line plot over a solid data line: automatic is dashed at 2 px', () => {
    renderWith(withStyle(0), { plot: { type: 'line' }, fits: [{ type: 'linear' }] })
    expect(screen.getByRole('combobox', { name: t('style.fitDash') })).toHaveTextContent('Automatic (Dashed)')
    expect(screen.getByRole('combobox', { name: t('style.fitWidth') })).toHaveTextContent('Automatic (2 px)')
  })

  it('a split series names what the automatic colour is: neutral when pooled', () => {
    renderWith(splitByG(), { fits: [{ type: 'linear' }] })
    expect(screen.getByRole('radio', { name: t('style.fitColorAuto', { mode: 'pooled' }) })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('is not shown for a series without a fit', () => {
    renderWith(withStyle(0))
    expect(screen.queryByRole('group', { name: t('style.fitLine') })).toBeNull()
  })

  it('a split series with no group left to draw (every y emptied) still shows its fit line', () => {
    const empty = { ...dataset(), cells: { ...dataset().cells, y: ['', '', '', '', '', ''] } }
    loadTestProject(empty, plotWith({ series: [splitByG()] }), {
      fits: [{ ...fit({ type: 'linear' }), perGroup: true }],
    })
    render(
      <I18nProvider lang="en">
        <StylePanel />
      </I18nProvider>,
    )
    expect(screen.getByRole('group', { name: t('style.fitLine') })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: t('style.fitDash') })).toHaveTextContent('Automatic (Solid)')
  })
})

describe('StylePanel colour by group / category', () => {
  it('box: colour by group is disabled without a group column, with the reason', () => {
    const box = (groupBy: string | null): Partial<PlotSpec> => ({
      type: 'box',
      box: {
        datasetId: DS,
        value: 'y' as ColumnId,
        groupBy: groupBy as ColumnId | null,
        points: 'all',
        showMean: false,
        colorByGroup: false,
      },
    })
    renderWith(withStyle(0), { plot: box(null) })
    expect(screen.getByRole('switch', { name: t('style.colorByGroup') })).toHaveAttribute('data-disabled')
    expect(screen.getByText(t('style.colorByGroupNeedsGroup'))).toBeInTheDocument()
  })

  it('box with a group column', async () => {
    renderWith(withStyle(0), {
      plot: {
        type: 'box',
        box: {
          datasetId: DS,
          value: 'y' as ColumnId,
          groupBy: 'g' as ColumnId,
          points: 'all',
          showMean: false,
          colorByGroup: false,
        },
      },
    })
    await userEvent.click(screen.getByRole('switch', { name: t('style.colorByGroup') }))
    expect(doc().plots[0].box.colorByGroup).toBe(true)
  })

  it('bar: colour by category keeps the other bar options', async () => {
    const bar: PlotSpec['bar'] = {
      datasetId: DS,
      category: 'g' as ColumnId,
      value: 'y' as ColumnId,
      showObservations: true,
      colorByCategory: false,
      aggregate: 'mean',
      spread: { kind: 'sem' },
    }
    renderWith(withStyle(0), { plot: { type: 'bar', bar } })
    await userEvent.click(screen.getByRole('switch', { name: t('style.colorByCategory') }))
    expect(doc().plots[0].bar).toEqual({ ...bar, colorByCategory: true })
  })
})
