import { issue, type Issue } from '@/domain/model'

/**
 * Import limits. Files above a limit are REFUSED with an explanation, never truncated.
 * 2 000 000 cells is the ceiling for the padded grid (rows × widest row), counted while tokenising.
 */
export const LIMITS = {
  warnBytes: 5 * 2 ** 20,
  maxTextBytes: 25 * 2 ** 20,
  maxSheetBytes: 20 * 2 ** 20,
  maxProjectBytes: 100 * 2 ** 20,
  maxCells: 2_000_000,
  previewRows: 20,
} as const

export type SizeClass = 'text' | 'sheet' | 'project'

const MB = 2 ** 20

/** Megabytes with one decimal, for messages ("25.3"). */
export function toMB(bytes: number): number {
  return Math.round((bytes / MB) * 10) / 10
}

export function maxBytesFor(kind: SizeClass): number {
  return kind === 'text'
    ? LIMITS.maxTextBytes
    : kind === 'sheet'
      ? LIMITS.maxSheetBytes
      : LIMITS.maxProjectBytes
}

/**
 * Size gate for one file: E_FILE_TOO_LARGE {size, limit} (MB) above the limit of its kind,
 * W_FILE_LARGE above the warning threshold, otherwise nothing.
 */
export function checkFileSize(
  byteLength: number,
  kind: SizeClass,
): { error: Issue | null; warning: Issue | null } {
  const max = maxBytesFor(kind)
  if (byteLength > max) {
    return { error: issue('E_FILE_TOO_LARGE', { size: toMB(byteLength), limit: toMB(max) }), warning: null }
  }
  if (byteLength > LIMITS.warnBytes)
    return { error: null, warning: issue('W_FILE_LARGE', { size: toMB(byteLength) }) }
  return { error: null, warning: null }
}
