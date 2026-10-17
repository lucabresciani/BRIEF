import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import Papa from 'papaparse'
import { describe, expect, it } from 'vitest'
import { decodeBytes } from './decode'
import { delimiterLabel, detectDelimiter, sepLineDelimiter } from './delimiter'

const fixture = (name: string) =>
  decodeBytes(new Uint8Array(readFileSync(resolve('tests/fixtures/import', name)))).text
const codes = (d: ReturnType<typeof detectDelimiter>) => d.issues.map((i) => i.code)

describe('detectDelimiter', () => {
  it('headerless European data "0,5;1,2" → ";" with high confidence (Papa guesses ",")', () => {
    const text = '0,5;1,2\n1,0;2,4'
    expect(Papa.parse(text).meta.delimiter).toBe(',') // the regression this detector exists for
    const d = detectDelimiter(text)
    expect(d.delimiter).toBe(';')
    expect(d.confidence).toBe('high')
    expect(d.alternatives).toEqual([','])
    expect(d.issues).toEqual([])
  })

  it('headerless decimal-comma fixture → ";"', () => {
    const d = detectDelimiter(fixture('headerless-comma-decimal.csv'))
    expect([d.delimiter, d.confidence]).toEqual([';', 'high'])
  })

  it('Italian Excel export (";" + decimal comma + grouping dots) → ";"', () => {
    const d = detectDelimiter(fixture('it-cp1252-semicolon.csv'))
    expect([d.delimiter, d.confidence]).toEqual([';', 'high'])
    expect(d.issues).toEqual([])
  })

  it('English comma CSV and the example datasets → ","', () => {
    for (const f of readdirSync(resolve('src/examples')).filter((n) => n.endsWith('.csv'))) {
      const d = detectDelimiter(readFileSync(resolve('src/examples', f), 'utf8'))
      expect([f, d.delimiter, d.confidence, codes(d)]).toEqual([f, ',', 'high', []])
    }
  })

  it('TSV, including pasted Italian cells with decimal commas → tab', () => {
    expect(detectDelimiter('x\ty\n1.5\t2.5\n3.5\t4.5\n').delimiter).toBe('\t')
    const d = detectDelimiter('t (s)\tx (m)\r\n0,5\t1,25\r\n1,0\t2,50\r\n')
    expect([d.delimiter, d.confidence]).toEqual(['\t', 'high'])
    expect(detectDelimiter(fixture('utf16le-excel.txt')).delimiter).toBe('\t')
  })

  it('pipe-delimited files', () => {
    const d = detectDelimiter('a|b|c\n1|2|3\n4|5|6\n')
    expect([d.delimiter, d.confidence]).toEqual(['|', 'high'])
  })

  it('";" inside a quoted field does not make ";" the delimiter', () => {
    const d = detectDelimiter('name,note\nA,"x; y"\nB,"p; q"\nC,"r; s"\n')
    expect([d.delimiter, d.confidence]).toEqual([',', 'high'])
  })

  it('a 12-line preamble does not prevent detection', () => {
    const d = detectDelimiter(fixture('preamble-12.csv'))
    expect([d.delimiter, d.confidence, codes(d)]).toEqual([',', 'high', []])
  })

  it('a single column of decimal-comma numbers → "none" (low confidence, "," offered)', () => {
    const d = detectDelimiter(fixture('single-col-comma.csv'))
    expect(d.delimiter).toBe('none')
    expect(d.confidence).toBe('low')
    expect(d.alternatives).toEqual([','])
    expect(codes(d)).toEqual(['W_SINGLE_COLUMN'])
    // Headerless too, and a single pasted value.
    expect(detectDelimiter('1,5\n2,25\n3,125').delimiter).toBe('none')
    expect(detectDelimiter('0,5').delimiter).toBe('none')
  })

  it('a named second column keeps "," as the delimiter', () => {
    const d = detectDelimiter('a,b\n1,2\n3,4\n')
    expect([d.delimiter, d.confidence]).toEqual([',', 'high'])
    expect(d.commaDecimal).toBe(false)
  })

  it('a "Name, unit" header over digit pairs → "none" (one decimal-comma column), low, "," offered', () => {
    for (const text of [
      'Lunghezza, cm\n1,5\n2,3\n3,1\n',
      'Mass, [g]\n12,5\n13,25\n',
      'T, (s)\n1,70\n1,75\n',
    ]) {
      const d = detectDelimiter(text)
      expect([text, d.delimiter, d.confidence, d.alternatives, d.commaDecimal]).toEqual([
        text,
        'none',
        'low',
        [','],
        true,
      ])
      expect(codes(d)).toEqual(['W_SINGLE_COLUMN'])
    }
    expect(detectDelimiter(fixture('single-col-comma.csv')).commaDecimal).toBe(true)
    // Two named columns or a second cell that is not a unit: ',' as before.
    expect(detectDelimiter('trial,count\n1,5\n2,3\n').delimiter).toBe(',')
    expect(detectDelimiter('Rossi, Mario Luigi\n1,5\n2,3\n').delimiter).toBe(',')
  })

  it('whitespace-separated numbers (a .dat file) → "none" with LOW confidence', () => {
    for (const text of [
      't P\n0 101.3\n5 101.1\n10 100.9\n15 100.7\n20 100.5\n',
      't counts\n1 120\n2 135\n3 160\n4 171\n',
    ]) {
      const d = detectDelimiter(text)
      expect([d.delimiter, d.confidence, codes(d)]).toEqual(['none', 'low', ['W_SINGLE_COLUMN']])
    }
    // Text with spaces, numbers with units, NBSP-grouped numbers, one line: an ordinary single column.
    for (const text of [
      'name\nMario Rossi\nAnna Bianchi\n',
      'U\n12 mV\n13 mV\n14 mV\n',
      'm\n1\u00a0234\n2\u00a0345\n',
      '0 1\n',
    ]) {
      expect([text, detectDelimiter(text).confidence]).toEqual([text, 'high'])
    }
  })

  it('quote-aware unless ignoreQuotes: rows from an unclosed or malformed quote on are not scored', () => {
    // Unclosed quote on line 1: quote-aware, nothing is left to score.
    expect(detectDelimiter('"t,n\n0,12\n1,15\n2,19\n').delimiter).toBe('none')
    const d = detectDelimiter('"t,n\n0,12\n1,15\n2,19\n', { ignoreQuotes: true })
    expect([d.delimiter, d.confidence]).toEqual([',', 'high'])
    // A malformed quote further down does not hide the rows above it.
    const m = detectDelimiter('a;b\n1;2\n3;4\n5;6\n"x"y;7\n8;9\n')
    expect(m.delimiter).toBe(';')
  })

  it('no candidate at all → "none" with high confidence', () => {
    const d = detectDelimiter('T (s)\n1.70\n1.75\n1.80\n')
    expect([d.delimiter, d.confidence, d.alternatives, codes(d)]).toEqual([
      'none',
      'high',
      [],
      ['W_SINGLE_COLUMN'],
    ])
  })

  it('a small file with ragged rows (below 90 % consistency) still finds "," but with low confidence', () => {
    const d = detectDelimiter(fixture('ragged.csv'))
    expect([d.delimiter, d.confidence]).toEqual([',', 'low'])
  })

  it('inconsistent field counts are not a delimiter', () => {
    const d = detectDelimiter('x;y\n1;0.52\n2;1,04\n3;1.55\n4;2,1\n5;2.61\n')
    expect([d.delimiter, d.confidence]).toEqual([';', 'high'])
  })

  it('two candidates describing the same table equally well → W_DELIMITER_AMBIGUOUS, low confidence', () => {
    // Every row has one ';' and one ',' in text cells: either could be the separator.
    const text = 'Rossi, Mario;12;3\nBianchi, Anna;14;5\nVerdi, Luca;11;2\nNeri, Ugo;15;4\n'
    const d = detectDelimiter(text)
    expect(d.delimiter).toBe(';')
    expect(d.confidence).toBe('low')
    expect(d.alternatives).toEqual([','])
    expect(d.issues).toEqual([
      expect.objectContaining({
        code: 'W_DELIMITER_AMBIGUOUS',
        severity: 'warning',
        params: { a: ';', b: ',' },
      }),
    ])
  })

  it('Excel "sep=;" first line forces the delimiter and is reported', () => {
    const d = detectDelimiter(fixture('sep-line.csv'))
    expect(d).toEqual({
      delimiter: ';',
      confidence: 'high',
      alternatives: [],
      sepLine: ';',
      issues: [expect.objectContaining({ code: 'I_SEP_LINE', params: { d: ';' }, rows: [0] })],
      commaDecimal: false,
    })
    expect(detectDelimiter('sep=,\na;b\n1;2').delimiter).toBe(',')
    expect(detectDelimiter('SEP=\t\nx\ty').issues[0]!.params).toEqual({ d: 'Tab' })
  })

  it('only the first line can be a sep line, and only for supported characters', () => {
    expect(sepLineDelimiter('x;y\nsep=,')).toBeNull()
    expect(sepLineDelimiter('sep=:\n1:2')).toBeNull()
    expect(sepLineDelimiter('\ufeffsep=|\r\n')).toBe('|')
  })

  it('samples only the first 64 KB', () => {
    const head = 'a;b\n' + '1;2\n'.repeat(20_000)
    expect(head.length).toBeGreaterThan(64 * 1024)
    expect(detectDelimiter(head).delimiter).toBe(';')
  })

  it('empty text', () => {
    expect(detectDelimiter('').delimiter).toBe('none')
    expect(detectDelimiter('').issues).toEqual([])
  })

  it('labels', () => {
    expect([delimiterLabel('\t'), delimiterLabel(';'), delimiterLabel('none')]).toEqual(['Tab', ';', '—'])
  })
})
