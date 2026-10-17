/**
 * Preferences kept in localStorage, a convenience only: every failure reads as "nothing stored".
 * Before the app was named BRIEF they were stored under "sde.*" keys. A value found only under its
 * former key is moved to the current one the first time it is read, so it survives the rename.
 */
export function readPreference(key: string, formerKey: string): string | null {
  let stored: string | null
  try {
    stored = localStorage.getItem(key)
    if (stored !== null) return stored
    stored = localStorage.getItem(formerKey)
  } catch {
    return null
  }
  if (stored !== null) {
    try {
      localStorage.setItem(key, stored)
      localStorage.removeItem(formerKey)
    } catch {
      // Not moved (storage full or read-only): the former key keeps it for the next visit.
    }
  }
  return stored
}

export function writePreference(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // preferences are a convenience; ignore storage failures
  }
}
