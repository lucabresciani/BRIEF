/**
 * Memoisation helpers for the derive pipeline. Immer's structural sharing makes reference
 * equality a reliable "nothing changed" test, so every stage caches on the identity of its inputs.
 */

/**
 * Two-level cache: an object key held weakly (e.g. an immutable RawColumn, a notebook cells array)
 * plus a string describing the settings that affect the result. Entries disappear with the object.
 */
export class KeyedWeakCache<K extends object, V> {
  private readonly map = new WeakMap<K, Map<string, V>>()

  get(key: K, hash: string): V | undefined {
    return this.map.get(key)?.get(hash)
  }

  set(key: K, hash: string, value: V): V {
    let inner = this.map.get(key)
    if (!inner) {
      inner = new Map()
      this.map.set(key, inner)
    }
    // Settings change rarely; keep only a handful of variants per object.
    if (inner.size >= 16) inner.delete(inner.keys().next().value as string)
    inner.set(hash, value)
    return value
  }

  getOrCompute(key: K, hash: string, compute: () => V): V {
    const hit = this.get(key, hash)
    return hit !== undefined ? hit : this.set(key, hash, compute())
  }
}
