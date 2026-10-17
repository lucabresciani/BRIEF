import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decodeBytes, stripBomChar } from './decode'

const fixture = (name: string) => new Uint8Array(readFileSync(resolve('tests/fixtures/import', name)))

describe('decodeBytes', () => {
  it('decodes plain UTF-8 without issues', () => {
    const r = decodeBytes(new TextEncoder().encode('T (°C);µ\n'))
    expect(r).toEqual({ text: 'T (°C);µ\n', encoding: 'utf-8', issues: [] })
  })

  it('strips a UTF-8 BOM', () => {
    const r = decodeBytes(new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0x2c, 0x62]))
    expect(r.text).toBe('a,b')
    expect(r.encoding).toBe('utf-8')
    expect(r.issues).toEqual([])
  })

  it('removes exactly one BOM (a second U+FEFF is data)', () => {
    const r = decodeBytes(new Uint8Array([0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf, 0x61]))
    expect(r.text).toBe('\ufeffa')
  })

  it('decodes UTF-16LE and UTF-16BE by BOM', () => {
    const le = new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0xb0, 0x00, 0x09, 0x00, 0xb5, 0x00])
    expect(decodeBytes(le)).toEqual({ text: 'A°\tµ', encoding: 'utf-16le', issues: [] })
    const be = new Uint8Array([0xfe, 0xff, 0x00, 0x41, 0x00, 0xb0])
    expect(decodeBytes(be)).toEqual({ text: 'A°', encoding: 'utf-16be', issues: [] })
  })

  it('falls back to windows-1252 on invalid UTF-8: B0 43 B5 80 → "°Cµ€"', () => {
    const r = decodeBytes(new Uint8Array([0xb0, 0x43, 0xb5, 0x80]))
    expect(r.text).toBe('°Cµ€')
    expect(r.encoding).toBe('windows-1252')
    expect(r.issues.map((i) => i.code)).toEqual(['W_ENCODING_FALLBACK'])
    expect(r.issues[0]!.severity).toBe('warning')
  })

  it('reads the Italian Excel cp1252 fixture with °C and µ', () => {
    const r = decodeBytes(fixture('it-cp1252-semicolon.csv'))
    expect(r.encoding).toBe('windows-1252')
    expect(r.text.startsWith('Tempo (s);Temperatura (°C);Tensione (µV);Pressione (Pa)\r\n')).toBe(true)
  })

  it('reads the Excel Unicode-text fixture (UTF-16LE, tabs, CRLF)', () => {
    const r = decodeBytes(fixture('utf16le-excel.txt'))
    expect(r.encoding).toBe('utf-16le')
    expect(r.text.split('\r\n')[0]).toBe('Campione\tm (µg)\tT (°C)')
    expect(r.text.charCodeAt(0)).not.toBe(0xfeff)
  })

  it('honours a forced encoding (lenient) and still skips its own BOM', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0xc2, 0xb0])
    expect(decodeBytes(bytes, 'utf-8').text).toBe('°')
    // Forcing windows-1252 on UTF-8 bytes shows the mojibake the user asked for, without an issue.
    const r = decodeBytes(new Uint8Array([0xc2, 0xb0]), 'windows-1252')
    expect(r).toEqual({ text: 'Â°', encoding: 'windows-1252', issues: [] })
  })

  it('decodes an empty file to an empty string', () => {
    expect(decodeBytes(new Uint8Array(0))).toEqual({ text: '', encoding: 'utf-8', issues: [] })
  })

  it('stripBomChar removes one leading U+FEFF', () => {
    expect(stripBomChar('\ufeffx')).toBe('x')
    expect(stripBomChar('x')).toBe('x')
  })
})
