/** localStorage over a Map; `state.full` makes every write throw, as a full or read-only storage does. */
export function fakeLocalStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial))
  const state = { full: false }
  const storage = {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (state.full) throw Object.assign(new Error('full'), { name: 'QuotaExceededError' })
      items.set(k, String(v))
    },
    removeItem: (k: string) => void items.delete(k),
  }
  return { storage, items, state }
}
