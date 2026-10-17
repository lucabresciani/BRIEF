import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decodeBytes } from './decode'
import { absentDelimiter, guessNewline, parseRows, tokenize } from './tokenize'

const fixtureBytes = (name: string) => new Uint8Array(readFileSync(resolve('tests/fixtures/import', name)))
const fixture = (name: string) => decodeBytes(fixtureBytes(name)).text

function grid(text: string, delimiter: Parameters<typeof tokenize>[1], ignoreQuotes = false) {
  const r = tokenize(text, delimiter, { maxCells: 1_000_000, ignoreQuotes })
  if (!r.ok) throw new Error(`unexpected ${r.error.code}`)
  return r.value
}

describe('tokenize', () => {
  it('keeps every cell as text (no dynamic typing) and drops only the final empty line', () => {
    const g = grid('x,y\n007,1.50\nTRUE,2024-01-01\n', ',')
    expect(g.rows).toEqual([
      ['x', 'y'],
      ['007', '1.50'],
      ['TRUE', '2024-01-01'],
    ])
    expect(Array.from(g.sourceRow)).toEqual([1, 2, 3])
    expect(g.issues).toEqual([])
  })

  it('CRLF fixture: the bytes really contain \\r\\n, and no field keeps a \\r', () => {
    const bytes = fixtureBytes('crlf.csv')
    expect(Buffer.from(bytes).includes(Buffer.from('\r\n'))).toBe(true)
    const g = grid(fixture('crlf.csv'), ',')
    expect(g.rows).toEqual([
      ['x', 'y'],
      ['0', '1.5'],
      ['1', '3.1'],
      ['2', '4.4'],
      ['3', '6.2'],
    ])
    expect(Array.from(g.sourceRow)).toEqual([1, 2, 3, 4, 5])
  })

  it('mixed LF/CRLF endings split on LF and strip the stray \\r', () => {
    const g = grid('a,b\r\n1,2\n3,4\r\n', ',')
    expect(g.rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ])
  })

  it('pads short rows and keeps extra fields as extra columns (ragged fixture)', () => {
    const g = grid(fixture('ragged.csv'), ',')
    expect(g.rows).toEqual([
      ['x', 'y', 'z', ''],
      ['1', '2', '3', ''],
      ['4', '5', '', ''],
      ['7', '8', '9', ''],
      ['10', '11', '12', '13'],
      ['14', '15', '16', ''],
    ])
    const ragged = g.issues.find((i) => i.code === 'W_RAGGED_ROWS')!
    expect(ragged.params).toEqual({ count: 1, row: 3 })
    expect(ragged.rows).toEqual([2])
    const extra = g.issues.find((i) => i.code === 'W_EXTRA_FIELDS')!
    expect(extra.params).toEqual({ count: 1, row: 5 })
    expect(extra.rows).toEqual([4])
  })

  it('does not report trailing empty fields as extra fields', () => {
    const g = grid('a,b,c\n1,2,3,\n4,5,6\n', ',')
    expect(g.rows[1]).toEqual(['1', '2', '3', ''])
    expect(g.issues.map((i) => i.code)).toEqual([])
  })

  it('interior blank lines are rows of empty cells and are not ragged', () => {
    const g = grid(fixture('blank-lines.csv'), ',')
    expect(g.rows.length).toBe(9)
    expect(g.rows[3]).toEqual(['', ''])
    expect(g.rows[6]).toEqual(['', ''])
    expect(Array.from(g.sourceRow)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(g.issues).toEqual([])
  })

  it('keeps trailing blank lines beyond the final newline as blank rows (only the last empty line goes)', () => {
    const g = grid('a\n1\n\n\n', 'none')
    expect(g.rows).toEqual([['a'], ['1'], [''], ['']])
  })

  it('multi-line quoted fields: rows are records, sourceRow is the physical line where each starts', () => {
    const g = grid(fixture('embedded-newline.csv'), ',')
    expect(g.rows).toEqual([
      ['id', 'comment', 'value'],
      ['1', 'first line\nsecond line', '3.5'],
      ['2', 'plain', '4.0'],
      ['3', 'multi\nline\ntext', '5.5'],
      ['4', 'end', '6.0'],
    ])
    expect(Array.from(g.sourceRow)).toEqual([1, 2, 4, 5, 8])
  })

  it('a quoted delimiter stays inside its field', () => {
    const g = grid('name;note\nA;"x; y"\nB;"say ""hi"""\n', ';')
    expect(g.rows).toEqual([
      ['name', 'note'],
      ['A', 'x; y'],
      ['B', 'say "hi"'],
    ])
  })

  it('an unclosed quote is an error with the physical line of the quote', () => {
    const r = tokenize(fixture('unclosed-quote.csv'), ',', { maxCells: 1000 })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('E_QUOTES_UNCLOSED')
    expect(r.error.severity).toBe('error')
    expect(r.error.params).toEqual({ row: 3, kind: 'unclosed' })
    expect(r.error.rows).toEqual([2])
  })

  it('reports the line of an unclosed quote that opens in the middle of a record', () => {
    const r = tokenize('a,b\n1,2\n3,"oops\n5,6\n', ',', { maxCells: 1000 })
    expect(!r.ok && r.error.params).toEqual({ row: 3, kind: 'unclosed' })
  })

  it('an unclosed quote followed by a quoted field on a later row is still "unclosed", not "malformed"', () => {
    // Papa takes the opening quote of "c" as the closing quote of "b,2 and then reports InvalidQuotes; row 3
    // itself has no closing quote, so "continues after its closing quotation mark" would be false.
    for (const text of [
      '"name","v"\n"a",1\n"b,2\n"c",3\n',
      'name,v\na,1\n"b,2\r\n"c",3\r\n',
      'n,v\na,1\n"b ""x"",2\n"c",3\n',
    ]) {
      const r = tokenize(text, ',', { maxCells: 1000 })
      expect(!r.ok && r.error.params, text).toEqual({ row: 3, kind: 'unclosed' })
    }
    // The closing quote on the opening line, then more text: 'malformed' (escaped "" pairs are skipped).
    const m = tokenize('n,v\na,1\n"b ""x"" c" d,2\n"c",3\n', ',', { maxCells: 1000 })
    expect(!m.ok && m.error.params).toEqual({ row: 3, kind: 'malformed' })
  })

  it('a malformed quoted field ("abc"def) is an error too: Papa would merge the following rows into it', () => {
    const text = 'sample,v\n"abc"def,1\nx,2\ny,3\n"z",4\nw,5\n'
    const r = tokenize(text, ',', { maxCells: 1000 })
    expect(r.ok).toBe(false)
    if (r.ok) return
    // Same code and remedy ("Ignore quotes"); kind 'malformed' gives it its own, accurate wording.
    expect(r.error.code).toBe('E_QUOTES_UNCLOSED')
    expect(r.error.params).toEqual({ row: 2, kind: 'malformed' })
    expect(r.error.rows).toEqual([1])
    const it_ = tokenize('Item;Length (cm)\nRod B;13,1\n"Rod A" long;12,5\nRod C;12,9\n"Rod D";13,4\n', ';', {
      maxCells: 1000,
    })
    expect(!it_.ok && it_.error.params).toEqual({ row: 3, kind: 'malformed' })
    expect(parseRows(text, ',')).toMatchObject({ quoteErrorRow: 1, quoteErrorKind: 'malformed' })
    expect(parseRows('a\n"b\n', ',').quoteErrorKind).toBe('unclosed')
    expect(parseRows('a\n"b"\n', ',').quoteErrorKind).toBeNull()
    // With quotes ignored every line is its own row.
    expect(grid(text, ',', true).rows.map((row) => row[1])).toEqual(['v', '1', '2', '3', '4', '5'])
    // Well-formed quotes ("" escapes, spaces before the delimiter) are not errors.
    expect(grid('a,b\n"x"  ,1\n1,"a""b"\n', ',').rows).toEqual([
      ['a', 'b'],
      ['x', '1'],
      ['1', 'a"b'],
    ])
  })

  it('"ignore quotes" reads quote characters as text', () => {
    const g = grid(fixture('unclosed-quote.csv'), ',', true)
    expect(g.rows).toEqual([
      ['label', 'value'],
      ['alpha', '1'],
      ['"beta', '2'],
      ['gamma', '3'],
      ['delta', '4'],
    ])
  })

  it("delimiter 'none' gives one field per line, commas included", () => {
    const g = grid(fixture('single-col-comma.csv'), 'none')
    expect(g.rows).toEqual([['T (s)'], ['1,70'], ['1,75'], ['1,76'], ['1,70'], ['1,72'], ['1,698']])
    expect(g.issues).toEqual([])
  })

  it('aborts above the cell limit with E_TOO_MANY_CELLS', () => {
    const text = Array.from({ length: 100 }, (_, i) => `${i},${i},${i}`).join('\n')
    const r = tokenize(text, ',', { maxCells: 50 })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('E_TOO_MANY_CELLS')
    expect(r.error.params!.limit).toBe(50)
    expect(Number(r.error.params!.cells)).toBeGreaterThan(50)
    // Exactly at the limit is fine.
    expect(tokenize(text, ',', { maxCells: 300 }).ok).toBe(true)
  })

  it('counts the padded grid against the cell limit', () => {
    const text = 'a,b,c,d,e,f,g,h,i,j\n' + Array.from({ length: 20 }, () => '1').join('\n')
    // 30 fields read, but the padded grid is 21 × 10 = 210 cells.
    const r = tokenize(text, ',', { maxCells: 100 })
    expect(!r.ok && r.error.params).toEqual({ cells: 210, limit: 100 })
  })

  it('handles empty input and a leading BOM', () => {
    expect(grid('', ',').rows).toEqual([])
    expect(grid('\ufeffa,b\n1,2', ',').rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('CR-only (classic Mac) files', () => {
    const g = grid('a,b\r1,2\r3,4\r', ',')
    expect(g.rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ])
    expect(Array.from(g.sourceRow)).toEqual([1, 2, 3])
  })
})

describe('guessNewline / parseRows', () => {
  it('ignores line breaks inside quotes when quotes are honoured', () => {
    expect(guessNewline('a,"x\ny"\r\nb,c\r\n', true)).toBe('\r\n')
    expect(guessNewline('a,"x\ny"\r\nb,c\r\n', false)).toBe('\n')
    expect(guessNewline('a\rb\r', true)).toBe('\r')
    expect(guessNewline('one line', true)).toBe('\n')
  })

  it('stops at maxRows', () => {
    const r = parseRows('1\n2\n3\n4\n', ',', { maxRows: 2 })
    expect(r.rows).toEqual([['1'], ['2']])
  })
})

describe('absentDelimiter (the separator used for single-column parsing)', () => {
  const CONTROLS = '\u0001\u0002\u0003\u0004\u0005\u0006\u0007\u0008'

  it('is a control character the text does not contain', () => {
    expect(absentDelimiter('a,b\n1,2')).toBe('\u0001')
    expect(absentDelimiter('x\u0001y\u0002')).toBe('\u0003')
  })

  it('never fails: when every candidate occurs, a run of U+0001 longer than any in the text', () => {
    const text = `${CONTROLS}\n\u0001\u0001\u0001x\n`
    const d = absentDelimiter(text)
    expect(d).toBe('\u0001'.repeat(4))
    expect(text.includes(d)).toBe(false)
  })

  it('adversarial text with every candidate character still gives one verbatim field per line', () => {
    // Also holds every private-use character U+E000–U+F8FE: the previous version scanned them and
    // threw when all were present (user data must never make the importer throw).
    let pua = ''
    for (let c = 0xe000; c < 0xf8ff; c++) pua += String.fromCharCode(c)
    const lines = [CONTROLS, 'a\u0001\u0001b,c;d', pua]
    const g = grid(lines.join('\n') + '\n', 'none')
    expect(g.rows).toEqual(lines.map((l) => [l]))
    expect(Array.from(g.sourceRow)).toEqual([1, 2, 3])
    const quoted = grid(`"${CONTROLS}"\n"x\u0001\u0001\u0001"\n`, 'none')
    expect(quoted.rows).toEqual([[CONTROLS], ['x\u0001\u0001\u0001']])
  })
})
