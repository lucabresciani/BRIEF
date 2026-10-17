import { describe, expect, it } from 'vitest'
import { isMissingToken, isSheetErrorToken, MISSING_TOKENS } from './missing'

describe('isMissingToken', () => {
  it('recognises every listed token, trimmed and case-insensitively', () => {
    for (const t of MISSING_TOKENS) {
      expect(isMissingToken(t), JSON.stringify(t)).toBe(true)
      expect(isMissingToken(`  ${t.toUpperCase()}\u00a0`), t).toBe(true)
    }
  })

  it('recognises the usual missing-value tokens', () => {
    for (const t of [
      '',
      'NA',
      'N/A',
      'n/a',
      'NaN',
      'nan',
      'null',
      'NULL',
      'none',
      '-',
      '\u2014',
      '\u2013',
      '?',
      'n.d.',
      'nd',
      'missing',
      '.',
    ]) {
      expect(isMissingToken(t), t).toBe(true)
    }
    expect(isMissingToken('\t \u00a0')).toBe(true)
  })

  it('does not treat values, zeros or labels as missing', () => {
    for (const t of ['0', '0.0', 'nan1', 'NAD', 'North', '-3', '#N/A', 'n', 'x']) {
      expect(isMissingToken(t), t).toBe(false)
    }
  })
})

describe('isSheetErrorToken', () => {
  it('recognises Excel errors in English and Italian', () => {
    const en = [
      '#DIV/0!',
      '#N/A',
      '#VALUE!',
      '#REF!',
      '#NAME?',
      '#NUM!',
      '#NULL!',
      '#SPILL!',
      '#CALC!',
      '#GETTING_DATA',
    ]
    const it_ = ['#N/D', '#VALORE!', '#RIF!', '#NOME?', '#NULLO!']
    for (const t of [...en, ...it_]) expect(isSheetErrorToken(t), t).toBe(true)
  })

  it('recognises other common spellings and LibreOffice codes, case-insensitively and trimmed', () => {
    for (const t of ['#valeur!', '#WERT!', '#¡VALOR!', 'Err:502', ' #div/0! ', '#ERROR!']) {
      expect(isSheetErrorToken(t), t).toBe(true)
    }
  })

  it('rejects ordinary text', () => {
    for (const t of ['', 'DIV/0', '#1', '# DIV/0!', 'NA', 'Error', 'Err:5', '#hashtag']) {
      expect(isSheetErrorToken(t), t).toBe(false)
    }
  })
})
