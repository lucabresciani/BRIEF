import { describe, expect, it } from 'vitest'
import { asRowId, issue } from '@/domain/model'
import { interpolate, issueHint, issueTitle, makeTranslator } from './translate'

const en = makeTranslator('en')
const it_ = makeTranslator('it')

describe('makeTranslator', () => {
  it('finds keys that hold dots: the history labels are keyed by operation kind', () => {
    expect(en('history.ops.dataset.import', { name: 'ohm' })).toBe('Imported ohm')
    expect(en('history.ops.plot.remove', { name: 'Plot 2' })).toBe('Deleted plot Plot 2')
    expect(it_('history.ops.plot.rename', { name: 'Taratura' })).toBe('Rinominato il grafico in Taratura')
    expect(en('history.ops.plot.nothing')).toBe('history.ops.plot.nothing')
    expect(en('plot.label.versus', { y: 'V', x: 'I' })).toBe('V vs I')
  })
})

describe('interpolate', () => {
  it('plural forms are unchanged: 1 → first option, anything else → second; absent → kept as written', () => {
    expect(interpolate('{count} {count|row|rows}', { count: 1 })).toBe('1 row')
    expect(interpolate('{count} {count|row|rows}', { count: 2 })).toBe('2 rows')
    expect(interpolate('{count|row|rows}', {})).toBe('{count|row|rows}')
    expect(interpolate('{a|x|y|z}', { a: 3 })).toBe('y|z')
  })

  it('select forms pick the option whose label equals the value, else "other"; no match → kept', () => {
    const tpl = '{kind|unclosed=never closed|malformed=text after the quote}'
    expect(interpolate(tpl, { kind: 'unclosed' })).toBe('never closed')
    expect(interpolate(tpl, { kind: 'malformed' })).toBe('text after the quote')
    expect(interpolate(tpl, { kind: 'other' })).toBe(tpl)
    expect(interpolate(tpl, {})).toBe(tpl)
    expect(interpolate('{n|1=one|other=many}', { n: 1 })).toBe('one')
    expect(interpolate('{n|1=one|other=many}', { n: 7 })).toBe('many')
    // '=' inside an option's text is text.
    expect(interpolate('{r|offset=far from x = 0|rounding=r}', { r: 'offset' })).toBe('far from x = 0')
  })

  it('options may hold placeholders and plural forms; values are inserted as they are, never re-read', () => {
    const tpl = '{scope|column=The {n} values|groups={count} {count|group|groups}} are equal.'
    expect(interpolate(tpl, { scope: 'column', n: 5, count: 1 })).toBe('The 5 values are equal.')
    expect(interpolate(tpl, { scope: 'groups', n: 9, count: 3 })).toBe('3 groups are equal.')
    expect(interpolate('{a} and {b}', { a: '{b}', b: 'x|y}' })).toBe('{b} and x|y}')
    expect(interpolate('{name|a=1|b=2}', { name: 'a' })).toBe('1')
    // Braces that are not a form stay, and placeholders inside them are still filled.
    expect(interpolate('{ {n} }', { n: 2 })).toBe('{ 2 }')
    expect(interpolate('open { only {n}', { n: 2 })).toBe('open { only 2')
  })
})

describe('issueTitle / issueHint', () => {
  it('non-integer numbers follow the decimal mark of the language; counts and rows do not change', () => {
    const fewDof = issue('W_FEW_DOF', { df: 2, t: 4.303 })
    expect(issueTitle(en, fewDof)).toBe('Only 2 degrees of freedom (t = 4.303): intervals are wide.')
    expect(issueTitle(it_, fewDof)).toBe('Solo 2 gradi di libertà (t = 4,303): gli intervalli sono ampi.')
    const big = issue('E_FILE_TOO_LARGE', { size: 30.5, limit: 25 })
    expect(issueTitle(it_, big)).toBe('File troppo grande (30,5 MB, limite 25 MB).')
    expect(issueTitle(en, big)).toBe('File too large (30.5 MB, limit 25 MB).')
    // Very large or small magnitudes, negative values: the mark follows the language in every notation.
    const shownT = (t: number) => issueTitle(it_, issue('W_FEW_DOF', { df: 2, t }))
    expect(shownT(1.5e21)).toContain('t = 1,5e+21')
    expect(shownT(2.5e-7)).toContain('t = 2,5e-7')
    expect(shownT(-0.25)).toContain('t = -0,25')
    expect(shownT(1e21)).toContain('t = 1e+21')
    expect(issueTitle(en, issue('W_FEW_DOF', { df: 2, t: 1.5e21 }))).toContain('t = 1.5e+21')
    const lev = issue('W_HIGH_LEVERAGE', undefined, { rows: [1, 11, 1234].map(asRowId) })
    expect(issueTitle(it_, lev)).toBe('Il fit dipende quasi interamente dalle righe 2, 12, 1235.')
    expect(issueTitle(it_, lev, (r) => r * 1000)).toBe(
      'Il fit dipende quasi interamente dalle righe 1000, 11000, 1234000.',
    )
    // The readings of an ambiguous token are written as the reader's language writes numbers.
    const amb = issue('W_DECIMAL_AMBIGUOUS', {
      example: '1,234',
      a: 1234,
      b: 1.234,
      chosen: 1.234,
      mode: 'comma',
      count: 4,
    })
    expect(issueTitle(en, amb)).toBe('“1,234” could be 1234 or 1.234; read as 1.234.')
    expect(issueTitle(it_, amb)).toBe('“1,234” potrebbe essere 1234 o 1,234; letto come 1,234.')
    // Mixed mode reads none of them (chosen = 'mixed'): the message says so instead of "read as mixed".
    const mixed = { ...amb, params: { ...amb.params, chosen: 'mixed', mode: 'mixed', count: 3 } }
    expect(issueTitle(en, mixed)).toBe('“1,234” could be 1234 or 1.234; 3 ambiguous values were left unread.')
    expect(issueTitle(it_, mixed)).toBe(
      '“1,234” potrebbe essere 1234 o 1,234; 3 valori ambigui non sono stati letti.',
    )
    expect(issueTitle(en, { ...mixed, params: { ...mixed.params, count: 1 } })).toContain(
      '1 ambiguous value was left unread',
    )
  })

  it('W_GROUP_PAIR_CI shows the t and level it was given (never a fixed 12.71)', () => {
    const pair = (t: number, level: number, count = 1) => issue('W_GROUP_PAIR_CI', { count, t, level })
    expect(issueTitle(en, pair(12.71, 95))).toBe(
      '1 group has only 2 observations: the 95 % interval uses t = 12.71 and is very wide.',
    )
    expect(issueTitle(it_, pair(12.71, 95))).toBe(
      '1 gruppo ha solo 2 osservazioni: l’intervallo al 95 % usa t = 12,71 ed è molto ampio.',
    )
    expect(issueTitle(en, pair(6.314, 90, 3))).toBe(
      '3 groups have only 2 observations: the 90 % interval uses t = 6.314 and is very wide.',
    )
    expect(issueTitle(it_, pair(63.66, 99, 2))).toContain('l’intervallo al 99 % usa t = 63,66')
  })

  it('I_EQUATION_CENTRED explains the reason it was given', () => {
    const rounding = issue('I_EQUATION_CENTRED', { x0: 2005, reason: 'rounding' })
    const offset = issue('I_EQUATION_CENTRED', { x0: 1.5, reason: 'offset' })
    expect(issueHint(en, rounding)).toBe(
      'Rounded coefficients in the original form would not reproduce the curve. Copy the full-precision values if needed.',
    )
    expect(issueHint(en, offset)).toMatch(
      /^The x values are far from 0 compared with their range: .*x = 0\. Copy/,
    )
    expect(issueHint(en, offset)).not.toContain('would not reproduce')
    expect(issueHint(it_, rounding)).toMatch(
      /^I coefficienti arrotondati nella forma originale non riprodurrebbero/,
    )
    expect(issueHint(it_, offset)).toMatch(/^I valori di x sono lontani da 0 rispetto al loro intervallo/)
    expect(issueHint(it_, offset)).not.toContain('riprodurrebbero')
  })

  it('E_QUOTES_UNCLOSED words an unclosed and a malformed quote differently; the remedy stays', () => {
    const unclosed = issue('E_QUOTES_UNCLOSED', { row: 3, kind: 'unclosed' })
    const malformed = issue('E_QUOTES_UNCLOSED', { row: 2, kind: 'malformed' })
    expect(issueTitle(en, unclosed)).toBe('Unclosed quotation mark from row 3.')
    expect(issueTitle(en, malformed)).toBe(
      'A quoted field in row 2 continues after its closing quotation mark.',
    )
    expect(issueTitle(it_, unclosed)).toBe('Virgolette non chiuse dalla riga 3.')
    expect(issueTitle(it_, malformed)).toBe(
      'Nella riga 2 un campo tra virgolette continua dopo la virgoletta di chiusura.',
    )
    for (const i of [unclosed, malformed]) {
      expect(issueHint(en, i)).toContain('"Ignore quotes"')
      expect(issueHint(it_, i)).toContain('"Ignora virgolette"')
    }
  })

  it('W_LOG_AXIS_BARS_CLIPPED agrees with its count in Italian', () => {
    expect(issueTitle(it_, issue('W_LOG_AXIS_BARS_CLIPPED', { count: 1 }))).toBe(
      '1 estremo inferiore di una barra ≤ 0 non è rappresentabile su un asse logaritmico.',
    )
    expect(issueTitle(it_, issue('W_LOG_AXIS_BARS_CLIPPED', { count: 3 }))).toBe(
      '3 estremi inferiori delle barre ≤ 0 non sono rappresentabili su un asse logaritmico.',
    )
  })

  it('I_ZERO_SPREAD, W_GROUP_X_VARIES and I_DATE_AXIS_LINEAR read naturally in both languages', () => {
    const column = issue('I_ZERO_SPREAD', { scope: 'column', n: 5, count: 1 })
    const groups = issue('I_ZERO_SPREAD', { scope: 'groups', n: 6, count: 2 })
    expect(issueTitle(en, column)).toBe('The 5 values are all identical: the spread is zero.')
    expect(issueTitle(en, groups)).toBe('2 groups have identical values: the spread is zero.')
    expect(issueTitle(it_, column)).toBe('I 5 valori sono tutti identici: la dispersione è nulla.')
    expect(issueTitle(it_, issue('I_ZERO_SPREAD', { scope: 'groups', n: 3, count: 1 }))).toBe(
      '1 gruppo ha valori identici: la dispersione è nulla.',
    )
    expect(issueHint(en, groups)).toContain('instrument resolution')
    expect(issueHint(it_, column)).toContain('risoluzione dello strumento')
    expect(issueTitle(en, issue('W_GROUP_X_VARIES', { count: 1 }))).toBe(
      '1 group mixes different x values: its mean is drawn at the mean x.',
    )
    expect(issueTitle(it_, issue('W_GROUP_X_VARIES', { count: 3 }))).toBe(
      '3 gruppi mescolano valori di x diversi: le loro medie sono disegnate alla x media.',
    )
    expect(issueTitle(en, issue('I_DATE_AXIS_LINEAR', { axis: 'x' }))).toBe(
      'The x axis shows dates, so it stays linear: a logarithmic scale is not available for dates.',
    )
    expect(issueTitle(it_, issue('I_DATE_AXIS_LINEAR', { axis: 'y' }))).toBe(
      'L’asse y mostra date e resta lineare: la scala logaritmica non è disponibile per le date.',
    )
  })
})
