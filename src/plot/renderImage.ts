import type { Config, Data, Layout } from 'plotly.js'
import { clearCaption, isCaptionAnnotation } from '@/domain/figure/layout'
import Plotly from './plotly'

type Figure = { data: Data[]; layout: Partial<Layout>; config?: Partial<Config> }

/** Render a figure to an image without touching the on-screen plot. */
export async function figureToImage(
  figure: Figure,
  opts: { format: 'png' | 'svg'; width: number; height: number; scale: number },
): Promise<string> {
  const layout = (await captionClear(figure, opts)) ?? figure.layout
  return Plotly.toImage({ data: figure.data, layout, config: figure.config ?? {} }, opts)
}

/**
 * The caption sits below the x axis at a fixed offset (layout.ts). When the axis text is taller (two-line
 * date ticks, rotated labels) the figure is drawn once off screen, the overlap is measured and the
 * caption moved down (clearCaption). Any failure keeps the layout as built.
 */
async function captionClear(figure: Figure, opts: { width: number; height: number }) {
  if (!figure.layout.annotations?.some(isCaptionAnnotation)) return null
  const gd = document.createElement('div')
  gd.style.cssText = `position:absolute;left:${-opts.width - 1000}px;top:0;visibility:hidden`
  document.body.appendChild(gd)
  try {
    // Plotly writes into the objects it draws: the copy keeps the figure intact for the export.
    const copy = structuredClone({ data: figure.data, layout: figure.layout })
    await Plotly.newPlot(
      gd,
      copy.data,
      { ...copy.layout, width: opts.width, height: opts.height },
      {
        ...figure.config,
        staticPlot: true,
      },
    )
    const measured = measure(gd, figure.layout.annotations)
    return measured ? clearCaption(figure.layout, measured) : null
  } catch {
    return null
  } finally {
    Plotly.purge(gd)
    gd.remove()
  }
}

/** Bottom of the lowest x-axis text and top of the first caption line, in page pixels. */
function measure(gd: HTMLElement, annotations: Partial<Layout>['annotations']) {
  let axisBottom = -Infinity
  for (const el of gd.querySelectorAll('.xtick text, .x2tick text, .xtitle, .x2title')) {
    const r = el.getBoundingClientRect()
    if (r.height > 0 && el.textContent) axisBottom = Math.max(axisBottom, r.bottom)
  }
  let captionTop = Infinity
  for (const g of gd.querySelectorAll('.annotation')) {
    const a = annotations?.[Number(g.getAttribute('data-index'))]
    const text = g.querySelector('.annotation-text')
    if (!a || !isCaptionAnnotation(a) || !text) continue
    const r = text.getBoundingClientRect()
    if (r.height > 0) captionTop = Math.min(captionTop, r.top)
  }
  return Number.isFinite(axisBottom) && Number.isFinite(captionTop) ? { axisBottom, captionTop } : null
}
