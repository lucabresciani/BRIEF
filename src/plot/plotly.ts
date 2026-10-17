// The single runtime import of Plotly in the app: the cartesian bundle (scatter, bar, histogram, box)
// plus the Italian locale. Everything else imports Plotly *types* only.
import Plotly from 'plotly.js-cartesian-dist-min'
import itLocale from 'plotly.js/lib/locales/it'

Plotly.register(itLocale as unknown as Parameters<typeof Plotly.register>[0])

export default Plotly
