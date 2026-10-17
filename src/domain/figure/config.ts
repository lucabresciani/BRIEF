/**
 * The ONLY Plotly config factory. Plotly v4 shows a "Share chart" modebar button that
 * uploads the figure to cloud.plotly.com unless showSendToCloud is false; local-first means it is
 * always off, together with the Plotly logo and the modebar (the app has its own toolbar).
 */
import type { Config } from 'plotly.js'

export function plotConfig(lang: 'en' | 'it'): Partial<Config> {
  return {
    displaylogo: false,
    showSendToCloud: false,
    displayModeBar: false,
    responsive: true,
    scrollZoom: false,
    doubleClick: 'reset',
    locale: lang,
    showTips: false,
  }
}
