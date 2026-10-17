import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ColumnId } from '@/domain/model'
import { TooltipProvider } from '@/components/ui/tooltip'
import { I18nProvider } from '@/i18n/I18nProvider'
import { makeTranslator } from '@/i18n/translate'
import { useUiStore } from '@/state/uiStore'
import { column, DS, loadTestProject, notebook, plotWith, PLOT, xySeries } from '../inspector/testFixtures'
import { RecommendationBanner } from './RecommendationBanner'

const t = makeTranslator('en')

/** t, V and u(V) (marked as the uncertainty of V), plus lnV = ln(V) as a derived column. */
const dataset = () =>
  notebook(
    {
      t: ['1', '2', '3', '4', '5'],
      V: ['2', '4', '6', '8', '10'],
      uV: ['0.1', '0.1', '0.1', '0.1', '0.1'],
    },
    [column('t'), column('V'), column('uV', { role: 'uncertainty', uncertaintyOf: 'V' })],
    [column('lnV', { derived: { op: 'ln', input: 'V' as ColumnId } })],
  )

function renderWith(x: string, y: string) {
  loadTestProject(dataset(), plotWith({ series: [xySeries(x, y)] }))
  useUiStore.setState({ hints: true, dismissedRecommendations: [] })
  render(
    <I18nProvider lang="en">
      <TooltipProvider>
        <RecommendationBanner plotId={PLOT} />
      </TooltipProvider>
    </I18nProvider>,
  )
}

const useAsBars = () => screen.queryByRole('button', { name: t('recommend.useAsErrorBars') })

describe('RecommendationBanner text', () => {
  it('names the columns the plot shows now, not the ones first recommended', () => {
    renderWith('V', 't')
    expect(screen.getByText(t('recommend.scatter', { x: 'V', y: 't' }))).toBeInTheDocument()
    expect(screen.queryByText(t('recommend.scatter', { x: 't', y: 'V' }))).not.toBeInTheDocument()
  })
})

describe('RecommendationBanner uncertainty suggestion', () => {
  it('offers the u(V) column while the series plots V', () => {
    renderWith('t', 'V')
    expect(useAsBars()).toBeInTheDocument()
  })

  it('is not offered once y is remapped to another column', () => {
    renderWith('V', 't')
    expect(useAsBars()).not.toBeInTheDocument()
  })

  it('is not offered on a derived y (no propagation)', () => {
    renderWith('t', 'lnV')
    expect(useAsBars()).not.toBeInTheDocument()
  })
})

describe('RecommendationBanner fits the plot type', () => {
  const scatterText = t('recommend.scatter', { x: 't', y: 'V' })
  function renderPlot(plot: Parameters<typeof plotWith>[0], data = dataset()) {
    loadTestProject(data, plotWith(plot))
    useUiStore.setState({ hints: true, dismissedRecommendations: [] })
    return render(
      <I18nProvider lang="en">
        <TooltipProvider>
          <RecommendationBanner plotId={PLOT} />
        </TooltipProvider>
      </I18nProvider>,
    )
  }

  it('scatter: the recommendation, the line plot it offers and the next step', () => {
    renderPlot({ series: [xySeries('t', 'V')] })
    expect(screen.getByText(scatterText)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t('plot.switchTo', { type: 'Line' }) })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t('plot.nextStepFit') })).toBeInTheDocument()
  })

  it('line: says what a line plot shows, without offering a switch to itself', () => {
    renderPlot({ type: 'line', series: [xySeries('t', 'V')] })
    expect(screen.queryByText(scatterText)).toBeNull()
    expect(screen.getByText(t('recommend.line', { x: 't', y: 'V' }))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Switch to/ })).toBeNull()
  })

  it('box and histogram tabs of scatter-shaped data show no scatter suggestion', () => {
    const box = {
      datasetId: DS,
      value: 'V' as ColumnId,
      groupBy: null,
      points: 'all' as const,
      showMean: false,
      colorByGroup: false,
    }
    const { container, unmount } = renderPlot({ type: 'box', box, series: [xySeries('t', 'V')] })
    expect(screen.queryByText(scatterText)).toBeNull()
    expect(container.querySelector('[role="note"]')).toBeNull()
    unmount()
    const histogram = {
      datasetId: DS,
      value: 'V' as ColumnId,
      bins: { mode: 'auto' as const },
      groupBy: null,
      groupMode: 'overlay' as const,
    }
    renderPlot({ type: 'histogram', histogram, series: [xySeries('t', 'V')] })
    expect(screen.queryByText(scatterText)).toBeNull()
    expect(screen.queryByRole('button', { name: t('plot.nextStepFit') })).toBeNull()
  })

  it('histogram of one quantity: the histogram suggestion', () => {
    const single = notebook({ T: ['1', '2', '2', '3'] }, [column('T')])
    renderPlot(
      {
        type: 'histogram',
        histogram: {
          datasetId: DS,
          value: 'T' as ColumnId,
          bins: { mode: 'auto' },
          groupBy: null,
          groupMode: 'overlay',
        },
      },
      single,
    )
    expect(screen.getByText(t('recommend.histogram', { column: 'T' }))).toBeInTheDocument()
  })
})
