import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeLocalStorage } from '@/test/fakeLocalStorage'
import { readPreference, writePreference } from './preferences'

afterEach(() => vi.unstubAllGlobals())

describe('preferences saved under the former "sde." keys', () => {
  it('are moved to the current key the first time they are read', () => {
    const { storage, items } = fakeLocalStorage({ 'sde.lang': 'it' })
    vi.stubGlobal('localStorage', storage)
    expect(readPreference('brief.lang', 'sde.lang')).toBe('it')
    expect(Object.fromEntries(items)).toEqual({ 'brief.lang': 'it' })
    expect(readPreference('brief.lang', 'sde.lang')).toBe('it')
  })

  it('never replace a value saved under the current key', () => {
    const { storage, items } = fakeLocalStorage({ 'sde.lang': 'it', 'brief.lang': 'en' })
    vi.stubGlobal('localStorage', storage)
    expect(readPreference('brief.lang', 'sde.lang')).toBe('en')
    expect(items.get('sde.lang')).toBe('it')
  })

  it('stay readable, and stay where they are, when the storage refuses writes', () => {
    const { storage, items, state } = fakeLocalStorage({ 'sde.lang': 'it' })
    state.full = true
    vi.stubGlobal('localStorage', storage)
    expect(readPreference('brief.lang', 'sde.lang')).toBe('it')
    expect(Object.fromEntries(items)).toEqual({ 'sde.lang': 'it' })
    expect(() => writePreference('brief.lang', 'en')).not.toThrow()
  })

  it('read as nothing stored when the storage is blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw Object.assign(new Error('blocked'), { name: 'SecurityError' })
      },
    })
    expect(readPreference('brief.lang', 'sde.lang')).toBeNull()
  })
})
