import { isEditableTarget } from './clipboard'

export const isMac = () =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
export const modKeyLabel = () => (isMac() ? '⌘' : 'Ctrl')

/** A shortcut written the way the platform writes it: ⌘Z and ⌘⇧Z on Apple systems, Ctrl+Z and Ctrl+Shift+Z elsewhere. */
export function shortcutLabel(key: string, opts: { shift?: boolean } = {}): string {
  return isMac() ? `⌘${opts.shift ? '⇧' : ''}${key}` : `Ctrl+${opts.shift ? 'Shift+' : ''}${key}`
}

export const undoShortcutLabel = () => shortcutLabel('Z')
/** ⌘Y is not redo on Apple systems (listenForUndoRedo ignores it there): ⌘⇧Z is advertised instead. */
export const redoShortcutLabel = () => (isMac() ? shortcutLabel('Z', { shift: true }) : shortcutLabel('Y'))

const ARIA_KEY_NAMES: Readonly<Record<string, string>> = {
  '⌘': 'Meta',
  '⇧': 'Shift',
  '⌥': 'Alt',
  Ctrl: 'Control',
}

/** A shortcut label in aria-keyshortcuts syntax: "⌘⇧Z" → "Meta+Shift+Z", "Ctrl+Y" → "Control+Y". */
export function ariaKeyShortcuts(label: string): string {
  const keys = label.match(/Ctrl|Shift|Alt|[⌘⇧⌥]|[^+⌘⇧⌥]+/g) ?? []
  return keys.map((k) => ARIA_KEY_NAMES[k] ?? k).join('+')
}

/** Ctrl/Cmd+Z, Ctrl+Y (not on Apple systems), Ctrl/Cmd+Shift+Z. Ignored inside text fields, which keep their native undo. */
export function listenForUndoRedo(handlers: { undo: () => void; redo: () => void }): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return
    if (isEditableTarget(e.target)) return
    const k = e.key.toLowerCase()
    if (k === 'z' && !e.shiftKey) {
      e.preventDefault()
      handlers.undo()
    } else if ((k === 'z' && e.shiftKey) || (k === 'y' && !isMac())) {
      e.preventDefault()
      handlers.redo()
    }
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}
