import type { SourceKind } from '@/domain/model'

/**
 * File-type sniffing from the extension and the magic bytes, never from the MIME type
 * (Windows reports .csv as application/vnd.ms-excel, or as an empty string).
 */
export type SniffedFormat = 'text' | 'xlsx' | 'ods' | 'xls' | 'sciplot' | 'unknown'

/** A workbook read with SheetJS (sheets, native cells), as opposed to delimited text. */
export function isSpreadsheetKind(kind: SourceKind | SniffedFormat | null | undefined): boolean {
  return kind === 'xlsx' || kind === 'xls' || kind === 'ods'
}

const ODS_MIMETYPE = 'mimetypeapplication/vnd.oasis.opendocument.spreadsheet'
const HEAD_BYTES = 4096

/** Lower-case extension without the dot ('' when there is none). */
export function fileExtension(fileName: string): string {
  const base = fileName.replace(/^.*[\\/]/, '')
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}

/** File name without directory and extension ('data.csv' → 'data'). */
export function baseName(fileName: string): string {
  const base = fileName.replace(/^.*[\\/]/, '')
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}

/** Bytes as Latin-1 text (one char per byte), for searching ASCII signatures. */
function latin1(bytes: Uint8Array, end: number): string {
  let s = ''
  const n = Math.min(end, bytes.length)
  for (let i = 0; i < n; i++) s += String.fromCharCode(bytes[i]!)
  return s
}

const startsWith = (b: Uint8Array, sig: readonly number[]) => sig.every((v, i) => b[i] === v)

/**
 * XLSX or ODS inside a zip. ODF packages normally start with a stored "mimetype" entry; some writers (SheetJS)
 * put META-INF/manifest.xml first, so the entry names in the central directory (end of the file, uncompressed)
 * are checked too: "[Content_Types].xml" only exists in OOXML, "content.xml" + manifest only in ODF.
 */
function zipFlavour(bytes: Uint8Array): 'xlsx' | 'ods' {
  if (latin1(bytes, 256).includes(ODS_MIMETYPE)) return 'ods'
  const tailStart = Math.max(0, bytes.length - 65536)
  let tail = ''
  for (let i = tailStart; i < bytes.length; i++) tail += String.fromCharCode(bytes[i]!)
  const hay = latin1(bytes, HEAD_BYTES) + tail
  if (hay.includes('[Content_Types].xml')) return 'xlsx'
  if (hay.includes('content.xml') && hay.includes('META-INF/manifest.xml')) return 'ods'
  return 'xlsx'
}

/**
 * - `PK\x03\x04` (zip): 'ods' when the stored "mimetype" entry near the start names an OpenDocument
 *   spreadsheet (or the zip entry names are those of an ODF package), otherwise 'xlsx';
 * - `D0 CF 11 E0` (OLE compound file): 'xls' (an Excel 97–2003 workbook, or an encrypted .xlsx that the
 *   workbook reader reports as protected);
 * - `.sciplot`, or JSON starting with '{' that mentions "format" and "sciplot": 'sciplot';
 * - a UTF-16 BOM: 'text'; NUL bytes in the first 4 KB otherwise: 'unknown' (binary);
 * - anything else (.csv/.tsv/.txt/.dat or any decodable text): 'text'.
 */
export function sniffFormat(bytes: Uint8Array, fileName: string): SniffedFormat {
  const ext = fileExtension(fileName)
  if (bytes.length >= 4 && startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return zipFlavour(bytes)
  if (bytes.length >= 4 && startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0])) return 'xls'
  if (ext === 'sciplot') return 'sciplot'
  if (startsWith(bytes, [0xff, 0xfe]) || startsWith(bytes, [0xfe, 0xff])) return 'text'

  const n = Math.min(bytes.length, HEAD_BYTES)
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return 'unknown'

  const head = latin1(bytes, HEAD_BYTES)
  const body = head.startsWith('\xef\xbb\xbf') ? head.slice(3) : head
  if (/^\s*\{/.test(body) && body.includes('"format"') && body.includes('sciplot')) return 'sciplot'
  return 'text'
}
