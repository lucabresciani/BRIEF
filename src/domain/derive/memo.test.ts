import { describe, expect, it } from 'vitest'
import { KeyedWeakCache } from './memo'

describe('KeyedWeakCache', () => {
  it('caches per object and settings hash', () => {
    const c = new KeyedWeakCache<object, number>()
    const k = {}
    let calls = 0
    const compute = () => ++calls
    expect(c.getOrCompute(k, 'a', compute)).toBe(1)
    expect(c.getOrCompute(k, 'a', compute)).toBe(1)
    expect(c.getOrCompute(k, 'b', compute)).toBe(2)
    expect(c.getOrCompute({}, 'a', compute)).toBe(3)
    expect(c.get(k, 'zzz')).toBeUndefined()
  })
})
