import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Layout } from 'plotly.js'

// jsdom has no layout: the mocked Plotly draws the elements the measurement reads, and their boxes
// come from `boxes` (top, bottom in page pixels, by class).
const boxes: Record<string, [number, number]> = {}
const plotly = vi.hoisted(() => ({
  newPlot: vi.fn(),
  purge: vi.fn(),
  toImage: vi.fn(async () => 'data:image/svg+xml,'),
}))
vi.mock('./plotly', () => ({ default: plotly }))

import { figureToImage } from './renderImage'

const layout = (): Partial<Layout> => ({
  width: 1000,
  height: 650,
  margin: { l: 64, r: 16, t: 12, b: 100 },
  annotations: [
    { name: 'indicator', text: 'n = 5 of 6', yshift: -54 },
    { name: 'caption', text: 'Excluded rows 4.', yshift: -74 },
  ],
})
const opts = { format: 'svg' as const, width: 1000, height: 650, scale: 1 }
const exported = () =>
  (plotly.toImage.mock.calls.at(-1) as unknown as [{ layout: Partial<Layout> }])[0].layout

beforeEach(() => {
  plotly.newPlot.mockImplementation(async (gd: HTMLElement) => {
    gd.innerHTML =
      '<svg><g class="xtick"><text>Jan 2<tspan>2024</tspan></text></g><text class="xtitle">date</text>' +
      '<g class="annotation" data-index="0"><text class="annotation-text">n = 5 of 6</text></g>' +
      '<g class="annotation" data-index="1"><text class="annotation-text">Excluded rows 4.</text></g></svg>'
  })
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const key = Object.keys(boxes).find((k) => this.matches(k))
    const [top, bottom] = key ? boxes[key] : [0, 0]
    return { top, bottom, height: bottom - top, left: 0, right: 10, width: 10, x: 0, y: top } as DOMRect
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  plotly.toImage.mockClear()
  for (const k of Object.keys(boxes)) delete boxes[k]
})

describe('figureToImage', () => {
  it('moves the caption below x-axis text that reaches into it (measured off screen)', async () => {
    Object.assign(boxes, {
      '.xtick text': [553, 590],
      '.xtitle': [593.6, 610.6],
      '[data-index="0"] .annotation-text': [608, 623],
      '[data-index="1"] .annotation-text': [628, 643],
    })
    await figureToImage({ data: [], layout: layout() }, opts)
    const out = exported()
    expect(out.annotations!.map((a) => a.yshift)).toEqual([-54 - 11, -74 - 11])
    expect(out.margin?.b).toBe(111)
    expect(plotly.purge).toHaveBeenCalledTimes(1)
    expect(document.body.children).toHaveLength(0) // the measuring div is removed
  })

  it('exports the layout as built when the caption clears the axis or the measurement fails', async () => {
    Object.assign(boxes, {
      '.xtick text': [505, 526.4],
      '.xtitle': [530, 547],
      '[data-index="0"] .annotation-text': [560, 575],
    })
    await figureToImage({ data: [], layout: layout() }, opts)
    expect(exported()).toEqual(layout())
    plotly.newPlot.mockRejectedValueOnce(new Error('no WebGL'))
    await figureToImage({ data: [], layout: layout() }, opts)
    expect(exported()).toEqual(layout())
  })
})
