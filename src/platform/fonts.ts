/**
 * Plotly measures text when it draws; drawing before the web fonts load gives wrong label widths.
 * Wait for the fonts (and the glyph subsets we use in units such as Ω, σ, µ, °) before the first plot.
 */
export const PLOT_FONT_FAMILY = "'IBM Plex Sans Variable', 'IBM Plex Sans', Arial, sans-serif"

let ready: Promise<void> | null = null

export function fontsReady(): Promise<void> {
  if (ready) return ready
  if (typeof document === 'undefined' || !document.fonts) return (ready = Promise.resolve())
  ready = Promise.race([
    Promise.all([
      document.fonts.load("400 13px 'IBM Plex Sans Variable'", 'Ωσµ°−±²'),
      document.fonts.load("600 13px 'IBM Plex Sans Variable'"),
      document.fonts.load("400 13px 'IBM Plex Mono'"),
    ]).then(() => document.fonts.ready.then(() => undefined)),
    new Promise<void>((r) => setTimeout(r, 1500)),
  ]).catch(() => undefined)
  return ready
}
