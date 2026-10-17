import { describe, expect, it } from 'vitest'
import type { Layout } from 'plotly.js'
import { CAPTION_CLEARANCE, clearCaption, exportAnnotations } from './layout'
import { figureContext } from './testing'

const exportLayout = (): Partial<Layout> => {
  const ann = exportAnnotations('n = 5 of 6, 1 excluded', ['Excluded rows 4.'], figureContext(), 900)
  return {
    margin: { l: 64, r: 16, t: 12, b: ann.marginBottom },
    annotations: [...ann.annotations, { text: 'not a caption', x: 0.5, y: 0.5, yshift: 3 }],
  }
}

describe('clearCaption', () => {
  it('moves the caption and the bottom margin down by the measured overlap (two-line date ticks)', () => {
    // Measured in Chromium: date x title bottom at 610.6 px, indicator top at 608 px.
    const layout = exportLayout()
    const out = clearCaption(layout, { axisBottom: 610.6, captionTop: 608 })!
    const shift = Math.ceil(610.6 + CAPTION_CLEARANCE - 608)
    expect(out.margin?.b).toBe((layout.margin?.b ?? 0) + shift)
    const before = layout.annotations!
    expect(out.annotations!.map((a) => a.yshift)).toEqual([
      before[0].yshift! - shift,
      before[1].yshift! - shift,
      3,
    ])
    expect(out.annotations!.map((a) => a.text)).toEqual(before.map((a) => a.text))
    expect(layout.annotations![0].yshift).toBe(before[0].yshift) // the input is not changed
  })

  it('rotated category labels far below the caption give a shift as large as the overlap', () => {
    const out = clearCaption(exportLayout(), { axisBottom: 599.8, captionTop: 544 })!
    expect(out.margin?.b).toBe((exportLayout().margin?.b ?? 0) + 64)
  })

  it('null when the caption already clears the axis, or when there is no caption', () => {
    expect(clearCaption(exportLayout(), { axisBottom: 547, captionTop: 560 })).toBeNull()
    expect(clearCaption({ annotations: [] }, { axisBottom: 700, captionTop: 600 })).toBeNull()
  })
})
