import { describe, expect, it } from 'vitest'
import { LIMITS, checkFileSize, toMB } from './limits'

describe('LIMITS', () => {
  it('holds the size and cell limits the import messages state', () => {
    expect(LIMITS).toEqual({
      warnBytes: 5 * 2 ** 20,
      maxTextBytes: 25 * 2 ** 20,
      maxSheetBytes: 20 * 2 ** 20,
      maxProjectBytes: 100 * 2 ** 20,
      maxCells: 2_000_000,
      previewRows: 20,
    })
  })
})

describe('checkFileSize', () => {
  it('accepts small files silently', () => {
    expect(checkFileSize(1000, 'text')).toEqual({ error: null, warning: null })
  })

  it('warns above 5 MB and refuses above the limit of each kind, never truncating', () => {
    const big = checkFileSize(6 * 2 ** 20, 'text')
    expect(big.error).toBeNull()
    expect(big.warning?.code).toBe('W_FILE_LARGE')

    const tooBig = checkFileSize(25 * 2 ** 20 + 1, 'text')
    expect(tooBig.error?.code).toBe('E_FILE_TOO_LARGE')
    expect(tooBig.error?.params).toEqual({ size: 25, limit: 25 })
    expect(checkFileSize(25 * 2 ** 20, 'text').error).toBeNull()

    expect(checkFileSize(21 * 2 ** 20, 'sheet').error?.params).toEqual({ size: 21, limit: 20 })
    expect(checkFileSize(99 * 2 ** 20, 'project').error).toBeNull()
  })

  it('formats sizes in MB with one decimal', () => {
    expect(toMB(1.25 * 2 ** 20)).toBe(1.3)
    expect(toMB(0)).toBe(0)
  })
})
