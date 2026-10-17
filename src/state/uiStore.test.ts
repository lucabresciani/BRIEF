import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeLocalStorage } from '@/test/fakeLocalStorage'
import type * as UiStoreModule from './uiStore'

let uiStore: typeof UiStoreModule
let items: Map<string, string>

beforeEach(async () => {
  const fake = fakeLocalStorage({
    'sde.prefs': JSON.stringify({ level: 'advanced', hints: false, tableOpen: false }),
  })
  items = fake.items
  vi.stubGlobal('localStorage', fake.storage)
  vi.resetModules()
  uiStore = await import('./uiStore')
})
afterEach(() => vi.unstubAllGlobals())

describe('the level, hints and table preferences of the former version (key "sde.prefs")', () => {
  it('are kept, and saved under the current key from then on', () => {
    expect(uiStore.ui.get()).toMatchObject({ level: 'advanced', hints: false, tableOpen: false })
    expect(items.has('sde.prefs')).toBe(false)
    uiStore.ui.set({ level: 'beginner' })
    expect(JSON.parse(items.get('brief.prefs') ?? '{}')).toEqual({
      level: 'beginner',
      hints: false,
      tableOpen: false,
    })
  })
})
