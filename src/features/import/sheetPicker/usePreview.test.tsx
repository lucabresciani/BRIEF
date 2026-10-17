import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { RegionImportSpec } from '@/domain/import/regionImport'
import { useRegionPreview } from './usePreview'

const client = vi.hoisted(() => ({ importRegions: vi.fn() }))
vi.mock('@/workers/importClient', () => client)

const spec: RegionImportSpec = {
  sheetName: 'S',
  mode: 'separate',
  regions: [{ range: 'A1:B3', orientation: 'columns' }],
}
const source = { bytes: new ArrayBuffer(4), fileName: 'book.xlsx' }

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('the sheet picker preview', () => {
  it('a preview request that fails ends with an error instead of loading forever', async () => {
    client.importRegions.mockRejectedValue(new Error('worker gone'))
    const { result } = renderHook(() => useRegionPreview(spec, source))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(result.current.loading).toBe(false)
    expect(result.current.draft).toBeNull()
    expect(result.current.error).toMatchObject({
      code: 'E_INTERNAL_GUARD',
      params: { reason: 'worker gone' },
    })
    expect(result.current.stale).toBe(false)
  })
})
