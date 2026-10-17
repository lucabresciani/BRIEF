/**
 * Plotly renders titles, legend names, annotations and hover labels as pseudo-HTML and substitutes
 * "%{…}" fields inside hovertemplates. Every string that comes from the user (column names, units,
 * series names, titles, cell text, notes) goes through escapePlotText before it reaches Plotly:
 * & < > become entities (an unknown "<tag>" would otherwise be parsed as markup), and "%{" becomes
 * "%&#123;" so user text can never inject a template field. Plotly decodes the numeric entity back to
 * "{" when it draws the text, so the user sees exactly what they typed.
 */
export function escapePlotText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/%\{/g, '%&#123;')
}
