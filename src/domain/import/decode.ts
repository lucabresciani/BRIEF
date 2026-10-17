import { issue, type Issue, type TextEncoding } from '@/domain/model'

/**
 * Bytes → text. A BOM decides (UTF-8 EF BB BF, UTF-16LE FF FE, UTF-16BE FE FF); otherwise strict UTF-8,
 * and when that fails Windows-1252 (what Italian/Western Excel writes for "CSV (delimitato…)": "°C", "µ"
 * are single bytes B0, B5 there) with W_ENCODING_FALLBACK. The BOM is never part of the text.
 * `forced` (the user's choice in the import dialog) decodes leniently with that encoding.
 */
export function decodeBytes(
  bytes: Uint8Array,
  forced?: TextEncoding,
): { text: string; encoding: TextEncoding; issues: Issue[] } {
  const bom = detectBom(bytes)
  if (forced) {
    const skip = bom && bom.encoding === forced ? bom.length : 0
    return { text: decodeWith(forced, bytes.subarray(skip), false), encoding: forced, issues: [] }
  }
  if (bom) {
    return {
      text: decodeWith(bom.encoding, bytes.subarray(bom.length), false),
      encoding: bom.encoding,
      issues: [],
    }
  }
  try {
    return { text: decodeWith('utf-8', bytes, true), encoding: 'utf-8', issues: [] }
  } catch {
    return {
      text: decodeWith('windows-1252', bytes, false),
      encoding: 'windows-1252',
      issues: [issue('W_ENCODING_FALLBACK', { encoding: 'windows-1252' })],
    }
  }
}

function detectBom(b: Uint8Array): { encoding: TextEncoding; length: number } | null {
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf)
    return { encoding: 'utf-8', length: 3 }
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return { encoding: 'utf-16le', length: 2 }
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return { encoding: 'utf-16be', length: 2 }
  return null
}

/** ignoreBOM: true because the byte-level BOM is skipped explicitly (exactly one BOM is removed). */
function decodeWith(encoding: TextEncoding, bytes: Uint8Array, fatal: boolean): string {
  return new TextDecoder(encoding, { fatal, ignoreBOM: true }).decode(bytes)
}

/** Removes one leading U+FEFF from text that did not come through decodeBytes (e.g. pasted text). */
export function stripBomChar(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}
