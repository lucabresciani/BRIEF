/**
 * Clipboard helpers. Spreadsheets put a TSV in text/plain (and HTML alongside); we only use the
 * plain text. Reading the clipboard without a paste event needs permission and may be refused.
 */
export type ClipboardRead =
  { ok: true; text: string } | { ok: false; reason: 'denied' | 'empty' | 'unsupported' }

export async function readClipboardText(): Promise<ClipboardRead> {
  if (!navigator.clipboard?.readText) return { ok: false, reason: 'unsupported' }
  try {
    const text = await navigator.clipboard.readText()
    return text.trim() ? { ok: true, text } : { ok: false, reason: 'empty' }
  } catch {
    return { ok: false, reason: 'denied' }
  }
}

export async function writeClipboardText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** True when a paste/keyboard event targets something that handles text itself. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target.closest('[data-paste-scope]')) return true
  const el = target as HTMLElement
  if (el.isContentEditable) return true
  const tag = el.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type
    return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'file', 'color'].includes(type)
  }
  return false
}

/**
 * Global paste listener: a table pasted anywhere outside text fields starts an import.
 * Returns the cleanup function.
 */
export function listenForGlobalPaste(onText: (text: string) => void): () => void {
  const handler = (e: ClipboardEvent) => {
    if (isEditableTarget(e.target)) return
    if (document.querySelector('[role="dialog"]')) return
    const text = e.clipboardData?.getData('text/plain') ?? ''
    if (!text.trim()) return
    e.preventDefault()
    onText(text)
  }
  window.addEventListener('paste', handler)
  return () => window.removeEventListener('paste', handler)
}
