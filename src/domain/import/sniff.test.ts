import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import { baseName, fileExtension, isSpreadsheetKind, sniffFormat } from './sniff'

const bytes = (...b: number[]) => new Uint8Array(b)
const ascii = (s: string) => new TextEncoder().encode(s)

/** Minimal zip local-file header whose first entry is a stored "mimetype" file (as in every ODS). */
function zipWithMimetype(mime: string): Uint8Array {
  const name = ascii('mimetype')
  const body = ascii(mime)
  const header = new Uint8Array(30)
  header.set([0x50, 0x4b, 0x03, 0x04])
  header[26] = name.length
  const out = new Uint8Array(30 + name.length + body.length)
  out.set(header)
  out.set(name, 30)
  out.set(body, 30 + name.length)
  return out
}

describe('sniffFormat', () => {
  it('tells ODS from XLSX inside a zip by the stored mimetype entry', () => {
    expect(sniffFormat(zipWithMimetype('application/vnd.oasis.opendocument.spreadsheet'), 'a.ods')).toBe(
      'ods',
    )
    // A zip without that entry (XLSX starts with [Content_Types].xml), whatever the extension says.
    expect(sniffFormat(bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00), 'book.xlsx')).toBe('xlsx')
    expect(sniffFormat(bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00), 'renamed.csv')).toBe('xlsx')
  })

  it('recognises real workbooks written by SheetJS (its ODS puts the manifest before the mimetype)', () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['x', 1]]), 'S')
    const write = (bookType: 'xlsx' | 'ods') =>
      new Uint8Array(XLSX.write(wb, { type: 'array', bookType }) as ArrayBuffer)
    expect(sniffFormat(write('xlsx'), 'a.xlsx')).toBe('xlsx')
    expect(sniffFormat(write('ods'), 'a.ods')).toBe('ods')
    expect(sniffFormat(write('ods'), 'no-extension')).toBe('ods')
  })

  it('recognises OLE .xls workbooks by magic bytes, whatever the name', () => {
    expect(sniffFormat(bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1), 'old.xls')).toBe('xls')
    const saved = new Uint8Array(readFileSync(resolve('tests/fixtures/import/biff8-tables.xls')))
    expect(sniffFormat(saved, 'biff8-tables.xls')).toBe('xls')
    expect(sniffFormat(saved, 'renamed.csv')).toBe('xls')
  })

  it('isSpreadsheetKind: xlsx, xls and ods are read as workbooks, everything else as text', () => {
    for (const k of ['xlsx', 'xls', 'ods'] as const) expect(isSpreadsheetKind(k)).toBe(true)
    for (const k of [
      'csv',
      'tsv',
      'text',
      'clipboard',
      'example',
      'sciplot',
      'unknown',
      null,
      undefined,
    ] as const)
      expect(isSpreadsheetKind(k)).toBe(false)
  })

  it('recognises project files by extension or by JSON content', () => {
    expect(sniffFormat(ascii('{"format":"sciplot","schemaVersion":1}'), 'p.sciplot')).toBe('sciplot')
    expect(sniffFormat(ascii('  {\n "format": "sciplot" }'), 'download.json')).toBe('sciplot')
    expect(sniffFormat(ascii('\ufeff{"format":"sciplot"}'), 'x.json')).toBe('sciplot')
    // Ordinary JSON is just text.
    expect(sniffFormat(ascii('{"a": 1}'), 'data.json')).toBe('text')
  })

  it('treats delimited text and decodable text as text', () => {
    expect(sniffFormat(ascii('x,y\n1,2\n'), 'a.csv')).toBe('text')
    expect(sniffFormat(ascii('x\ty\n'), 'a.tsv')).toBe('text')
    expect(sniffFormat(ascii('1 2\n'), 'a.dat')).toBe('text')
    expect(sniffFormat(ascii('x;y\n'), 'noextension')).toBe('text')
    expect(sniffFormat(new Uint8Array(0), 'empty.csv')).toBe('text')
  })

  it('accepts UTF-16 text (its NUL bytes are expected) and rejects other binaries', () => {
    const utf16 = new Uint8Array(readFileSync(resolve('tests/fixtures/import/utf16le-excel.txt')))
    expect(sniffFormat(utf16, 'utf16le-excel.txt')).toBe('text')
    expect(sniffFormat(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00), 'image.csv')).toBe(
      'unknown',
    )
  })

  it('never looks at a MIME type: only bytes and the name', () => {
    expect(sniffFormat(ascii('a;b'), 'a.xlsx')).toBe('text')
  })
})

describe('file names', () => {
  it('extracts extension and base name', () => {
    expect(fileExtension('C:\\data\\Run 1.CSV')).toBe('csv')
    expect(fileExtension('.hidden')).toBe('')
    expect(baseName('dir/ohm.csv')).toBe('ohm')
    expect(baseName('archive.tar.gz')).toBe('archive.tar')
    expect(baseName('README')).toBe('README')
  })
})
