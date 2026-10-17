import { describe, expect, it } from 'vitest'
import { DEFAULT_FIT_STYLE, DEFAULT_SERIES_STYLE } from '@/domain/model'
import type { FitStyle, LineDash, PlotType } from '@/domain/model'
import {
  type Deficiency,
  type Lab,
  contrastRatio,
  deltaE2000,
  labOf,
  labSeen,
  linearRgb,
  simulate,
} from '@/test/colorVision'
import { plotConfig } from './config'
import { escapePlotText } from './escape'
import {
  FIT_WIDTH_ALONE,
  NEUTRAL,
  SERIES_COLORS,
  SERIES_DASHES,
  SERIES_SYMBOLS,
  type SeriesLineMode,
  fitAppearance,
  groupAppearance,
  seriesAppearance,
  withAlpha,
} from './palette'

const WHITE = '#ffffff'

describe('palette', () => {
  it('computes WCAG contrast like the reference values (black/white 21:1, Okabe–Ito blue 5.19:1)', () => {
    expect(contrastRatio('#000000', WHITE)).toBeCloseTo(21, 6)
    expect(contrastRatio(WHITE, WHITE)).toBeCloseTo(1, 6)
    expect(contrastRatio('#0072B2', WHITE)).toBeCloseTo(5.19, 2)
    // Undarkened Okabe–Ito orange and sky blue fail 3:1 — that is why the palette darkens them.
    expect(contrastRatio('#E69F00', WHITE)).toBeLessThan(3)
    expect(contrastRatio('#56B4E9', WHITE)).toBeLessThan(3)
  })

  it('every series colour has at least 3:1 contrast on the white plot (and the documented ratio)', () => {
    const documented = [5.19, 3.87, 3.42, 3.06, 3.21, 3.13, 8.73, 21]
    expect(SERIES_COLORS).toHaveLength(documented.length)
    SERIES_COLORS.forEach((c, i) => {
      expect(c).toMatch(/^#[0-9A-F]{6}$/i)
      expect(contrastRatio(c, WHITE)).toBeGreaterThanOrEqual(3)
      expect(contrastRatio(c, WHITE)).toBeCloseTo(documented[i], 2)
    })
    expect(new Set(SERIES_COLORS.map((c) => c.toLowerCase())).size).toBe(SERIES_COLORS.length)
    expect(SERIES_COLORS.map((c) => c.toLowerCase())).not.toContain('#f0e442') // yellow, 1.32:1
  })

  it('neutrals: text ≥ 4.5:1, reference lines and hollow excluded markers ≥ 3:1', () => {
    expect(contrastRatio(NEUTRAL.text, WHITE)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(NEUTRAL.mutedText, WHITE)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(NEUTRAL.zero, WHITE)).toBeGreaterThanOrEqual(3)
    expect(contrastRatio(NEUTRAL.excluded, WHITE)).toBeGreaterThanOrEqual(3)
    expect(NEUTRAL.background).toBe('#ffffff')
  })

  it('the first six colours and symbols are those of v1 projects; wine, black and the x symbol follow', () => {
    expect(SERIES_COLORS).toEqual([
      '#0072B2',
      '#D55E00',
      '#009E73',
      '#CC79A7',
      '#C08400',
      '#4499D0',
      '#882255',
      '#000000',
    ])
    expect(SERIES_SYMBOLS).toEqual([
      'circle',
      'square',
      'diamond',
      'triangle-up',
      'triangle-down',
      'cross',
      'x',
    ])
  })

  it('symbols and dashes cycle with the series position; the colour comes from paletteIndex', () => {
    expect(SERIES_DASHES).toHaveLength(6)
    const auto = { ...DEFAULT_SERIES_STYLE, paletteIndex: 2 }
    expect(seriesAppearance(0, auto)).toEqual({ color: SERIES_COLORS[2], symbol: 'circle', dash: 'solid' })
    expect(seriesAppearance(6, auto).symbol).toBe('x')
    expect(seriesAppearance(8, auto).symbol).toBe(SERIES_SYMBOLS[1])
    expect(seriesAppearance(7, auto).dash).toBe(SERIES_DASHES[1])
    expect(seriesAppearance(0, { ...auto, paletteIndex: 6 }).color).toBe('#882255')
    expect(seriesAppearance(0, { ...auto, paletteIndex: 8 }).color).toBe(SERIES_COLORS[0])
    expect(seriesAppearance(0, { ...auto, paletteIndex: -1 }).color).toBe(SERIES_COLORS[7])
    expect(seriesAppearance(0, { ...auto, paletteIndex: NaN }).color).toBe(SERIES_COLORS[0])
    const explicit = { ...auto, symbol: 'cross' as const, lineDash: 'dot' as const }
    expect(seriesAppearance(3, explicit)).toMatchObject({ symbol: 'cross', dash: 'dot' })
  })

  it('withAlpha turns hex into a CSS rgba() colour (Plotly ≥ 4 accepts only CSS colours)', () => {
    expect(withAlpha('#0072B2', 0.12)).toBe('rgba(0, 114, 178, 0.12)')
    expect(withAlpha('not-a-colour', 0.5)).toBe('not-a-colour')
  })
})

describe('palette under colour-vision deficiencies', () => {
  const DEFICIENCIES: Deficiency[] = ['protanopia', 'deuteranopia', 'tritanopia']
  // ΔE2000: about 1 is a just-noticeable difference and 3 is clearly visible side by side; from 10 two
  // marks read as different colours at a glance.
  const FLOOR = 3
  const DISTINCT = 10
  /** The two colours added to the six of v1 keep at least this much from every other one. */
  const ADDED = 20
  /**
   * Okabe–Ito pairs (unchanged since v1, so not adjustable) that one simulated deficiency brings below
   * DISTINCT. They stay above FLOOR, and their marker symbols and dashes differ.
   */
  const CLOSE: Record<Deficiency | 'normal', string[]> = {
    normal: [],
    protanopia: ['#D55E00/#C08400', '#CC79A7/#4499D0'],
    deuteranopia: ['#D55E00/#C08400'],
    tritanopia: ['#009E73/#4499D0', '#CC79A7/#C08400'],
  }
  const pairs: [number, number][] = []
  for (let i = 0; i < SERIES_COLORS.length; i++)
    for (let j = i + 1; j < SERIES_COLORS.length; j++) pairs.push([i, j])

  it('the simulation keeps neutrals neutral; ΔE2000 matches the test data of Sharma et al. (2005)', () => {
    for (const d of DEFICIENCIES) {
      simulate(linearRgb('#ffffff'), d).forEach((v) => expect(v).toBeCloseTo(1, 5))
      const grey = linearRgb('#777777')
      simulate(grey, d).forEach((v) => expect(v).toBeCloseTo(grey[0], 5))
    }
    expect(labOf(linearRgb('#ffffff'))[0]).toBeCloseTo(100, 3)
    const sharma: [Lab, Lab, number][] = [
      [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
      [[50, 0, 0], [50, -1, 2], 2.3669],
      [[50, 2.49, -0.001], [50, -2.49, 0.0009], 7.1792],
      [[50, 2.5, 0], [73, 25, -18], 27.1492],
      [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
      [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082],
    ]
    for (const [a, b, de] of sharma) {
      expect(deltaE2000(a, b)).toBeCloseTo(de, 4)
      expect(deltaE2000(b, a)).toBeCloseTo(de, 4)
    }
  })

  it.each(['normal', ...DEFICIENCIES] as const)('%s: every pair of series colours stays apart', (vision) => {
    const seen = SERIES_COLORS.map((c) => labSeen(c, vision === 'normal' ? undefined : vision))
    const close: string[] = []
    for (const [i, j] of pairs) {
      const name = `${SERIES_COLORS[i]}/${SERIES_COLORS[j]}`
      const de = deltaE2000(seen[i], seen[j])
      expect(de, name).toBeGreaterThan(FLOOR)
      if (j >= 6) expect(de, name).toBeGreaterThan(ADDED)
      if (de < DISTINCT) close.push(name)
    }
    expect(close.sort()).toEqual([...CLOSE[vision]].sort())
    for (const pair of CLOSE[vision]) {
      const [i, j] = pair.split('/').map((c) => SERIES_COLORS.indexOf(c))
      expect(SERIES_SYMBOLS[i]).not.toBe(SERIES_SYMBOLS[j])
      expect(SERIES_DASHES[i]).not.toBe(SERIES_DASHES[j])
    }
  })

  it('colour (paletteIndex) × auto symbol (position) pairs are unique for 56 series, then repeat', () => {
    const look = (i: number) => seriesAppearance(i, { ...DEFAULT_SERIES_STYLE, paletteIndex: i })
    const combos = Array.from({ length: 57 }, (_, i) => `${look(i).color} ${look(i).symbol}`)
    expect(new Set(combos.slice(0, 56)).size).toBe(56)
    expect(combos[56]).toBe(combos[0])
  })
})

describe('fitAppearance', () => {
  const blue = SERIES_COLORS[0]
  const row = (plot: PlotType, mode: SeriesLineMode, series: LineDash, over: Partial<FitStyle>) => {
    const a = fitAppearance({ color: blue, dash: series }, plot, mode, { ...DEFAULT_FIT_STYLE, ...over })
    return [a.color === blue ? 'series' : a.color, a.dash, a.width, a.extrapolationDash]
  }
  const palette = (index: number): Partial<FitStyle> => ({ color: { mode: 'palette', index } })

  it.each<[PlotType, SeriesLineMode, LineDash, Partial<FitStyle>, (string | number)[]]>([
    // plot, series line, series dash, explicit style → colour, dash, width, extrapolation dash
    ['scatter', 'markers', 'solid', {}, ['series', 'solid', FIT_WIDTH_ALONE, 'dot']],
    // A scatter plot draws no series line: the series dash (auto, by position) plays no part.
    ['scatter', 'markers', 'dot', {}, ['series', 'solid', FIT_WIDTH_ALONE, 'dot']],
    ['scatter', 'lines', 'dot', {}, ['series', 'solid', FIT_WIDTH_ALONE, 'dot']],
    ['line', 'lines', 'solid', {}, ['series', 'dash', 2, 'dot']],
    ['line', 'lines', 'dash', {}, ['series', 'solid', 2, 'dot']],
    ['line', 'lines', 'dot', {}, ['series', 'solid', 2, 'dashdot']],
    ['line', 'lines', 'longdash', {}, ['series', 'solid', 2, 'dot']],
    // A line plot with line width 0 shows markers only: the fit is the only line again.
    ['line', 'markers', 'solid', {}, ['series', 'solid', FIT_WIDTH_ALONE, 'dot']],
    // Explicit choices win.
    ['scatter', 'markers', 'solid', { dash: 'dot' }, ['series', 'dot', FIT_WIDTH_ALONE, 'dashdot']],
    ['line', 'lines', 'dashdot', { dash: 'dot' }, ['series', 'dot', 2, 'longdashdot']],
    ['line', 'lines', 'solid', { dash: 'solid' }, ['series', 'solid', 2, 'dot']],
    ['scatter', 'markers', 'solid', { width: 3 }, ['series', 'solid', 3, 'dot']],
    ['line', 'lines', 'solid', { width: 1 }, ['series', 'dash', 1, 'dot']],
    ['scatter', 'markers', 'solid', palette(7), ['#000000', 'solid', FIT_WIDTH_ALONE, 'dot']],
    ['line', 'lines', 'dash', palette(9), [SERIES_COLORS[1], 'solid', 2, 'dot']],
  ])('%s plot, series %s %s, style %j → %j', (plot, mode, series, over, expected) => {
    expect(row(plot, mode, series, over)).toEqual(expected)
  })

  it('with the prediction band (dotted outline) the extrapolation is never dotted', () => {
    const ext = (plot: PlotType, mode: SeriesLineMode, series: LineDash, dash: FitStyle['dash']) =>
      fitAppearance(
        { color: blue, dash: series },
        plot,
        mode,
        { ...DEFAULT_FIT_STYLE, dash },
        { predictionBand: true },
      ).extrapolationDash
    expect(ext('scatter', 'markers', 'solid', 'auto')).toBe('dashdot')
    expect(ext('line', 'lines', 'solid', 'auto')).toBe('dashdot')
    expect(ext('line', 'lines', 'dashdot', 'auto')).toBe('longdashdot')
    // dot, dash-dot and long dash-dot all taken: long dash.
    expect(ext('line', 'lines', 'longdashdot', 'dashdot')).toBe('longdash')
    for (const series of SERIES_DASHES)
      for (const dash of ['auto', ...SERIES_DASHES] as const) {
        const a = fitAppearance(
          { color: blue, dash: series },
          'line',
          'lines',
          { ...DEFAULT_FIT_STYLE, dash },
          {
            predictionBand: true,
          },
        )
        expect([a.dash, series, 'dot']).not.toContain(a.extrapolationDash)
      }
  })

  it('never shares a dash with the data line it is drawn on, nor with its own extrapolation', () => {
    for (const series of SERIES_DASHES)
      for (const dash of ['auto', ...SERIES_DASHES] as const) {
        const a = fitAppearance({ color: blue, dash: series }, 'line', 'lines', {
          ...DEFAULT_FIT_STYLE,
          dash,
        })
        if (dash === 'auto') expect(a.dash).not.toBe(series)
        expect(a.extrapolationDash).not.toBe(a.dash)
        expect(a.extrapolationDash).not.toBe(series)
      }
  })
})

describe('groupAppearance', () => {
  it('colour and symbol by rank (8 × 7, coprime), overrides win for what they set', () => {
    expect(groupAppearance(0)).toEqual({ color: SERIES_COLORS[0], symbol: SERIES_SYMBOLS[0] })
    expect(groupAppearance(9)).toEqual({ color: SERIES_COLORS[1], symbol: SERIES_SYMBOLS[2] })
    const combos = new Set(Array.from({ length: 56 }, (_, r) => JSON.stringify(groupAppearance(r))))
    expect(combos.size).toBe(56)
    expect(groupAppearance(2, { paletteIndex: 7, symbol: 'auto' })).toEqual({
      color: SERIES_COLORS[7],
      symbol: SERIES_SYMBOLS[2],
    })
    expect(groupAppearance(2, { paletteIndex: null, symbol: 'x' })).toEqual({
      color: SERIES_COLORS[2],
      symbol: 'x',
    })
  })
})

describe('plotConfig', () => {
  it('never shows the Plotly cloud-share button, the logo or the modebar; locale follows the UI', () => {
    for (const lang of ['en', 'it'] as const) {
      const c = plotConfig(lang)
      expect(c.showSendToCloud).toBe(false)
      expect(c.displaylogo).toBe(false)
      expect(c.displayModeBar).toBe(false)
      expect(c.responsive).toBe(true)
      expect(c.scrollZoom).toBe(false)
      expect(c.doubleClick).toBe('reset')
      expect(c.showTips).toBe(false)
      expect(c.locale).toBe(lang)
    }
    expect(plotConfig('en')).not.toBe(plotConfig('en'))
  })
})

describe('escapePlotText', () => {
  it('escapes pseudo-HTML and template fields, ampersand first', () => {
    expect(escapePlotText('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(escapePlotText('R & D')).toBe('R &amp; D')
    expect(escapePlotText('&lt;')).toBe('&amp;lt;')
    expect(escapePlotText('%{x} and %{customdata[0]}')).toBe('%&#123;x} and %&#123;customdata[0]}')
    expect(escapePlotText('50 % {not a field}')).toBe('50 % {not a field}')
    expect(escapePlotText('T (°C) µm Ω')).toBe('T (°C) µm Ω')
  })
})
