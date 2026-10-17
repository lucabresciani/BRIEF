// The prebuilt cartesian bundle ships no type declarations; it exposes the same API as plotly.js.
declare module 'plotly.js-cartesian-dist-min' {
  import * as Plotly from 'plotly.js'
  export = Plotly
}

declare module 'plotly.js/lib/locales/it' {
  const locale: {
    moduleType: 'locale'
    name: string
    dictionary: Record<string, string>
    format: Record<string, unknown>
  }
  export default locale
}
