import { afterEach, describe, expect, it, vi } from 'vitest'
import { ariaKeyShortcuts, listenForUndoRedo, redoShortcutLabel, undoShortcutLabel } from './shortcuts'

function onPlatform(platform: string) {
  vi.stubGlobal('navigator', { platform, userAgent: '' })
}

/** Presses a key with modifiers on a window stub and reports which handler ran. */
function press(init: { key: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }) {
  const win = new EventTarget()
  vi.stubGlobal('window', win)
  vi.stubGlobal('Element', class {}) // the target is the window, never a text field
  const calls: string[] = []
  const stop = listenForUndoRedo({ undo: () => calls.push('undo'), redo: () => calls.push('redo') })
  const ev = Object.assign(new Event('keydown', { cancelable: true }), {
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...init,
  })
  win.dispatchEvent(ev)
  stop()
  return calls
}

afterEach(() => vi.unstubAllGlobals())

describe('undo and redo shortcuts', () => {
  it('on Apple systems redo is advertised as ⌘⇧Z, and that is what redoes', () => {
    onPlatform('MacIntel')
    expect(undoShortcutLabel()).toBe('⌘Z')
    expect(redoShortcutLabel()).toBe('⌘⇧Z')
    expect(press({ key: 'Z', metaKey: true, shiftKey: true })).toEqual(['redo'])
    expect(press({ key: 'z', metaKey: true })).toEqual(['undo'])
    expect(press({ key: 'y', metaKey: true })).toEqual([])
  })

  it('elsewhere redo is advertised as Ctrl+Y, and Ctrl+Shift+Z redoes too', () => {
    onPlatform('Win32')
    expect(undoShortcutLabel()).toBe('Ctrl+Z')
    expect(redoShortcutLabel()).toBe('Ctrl+Y')
    expect(press({ key: 'y', ctrlKey: true })).toEqual(['redo'])
    expect(press({ key: 'Z', ctrlKey: true, shiftKey: true })).toEqual(['redo'])
  })

  it('labels are exposed to assistive technology in aria-keyshortcuts syntax', () => {
    expect(ariaKeyShortcuts('⌘⇧Z')).toBe('Meta+Shift+Z')
    expect(ariaKeyShortcuts('⌘Z')).toBe('Meta+Z')
    expect(ariaKeyShortcuts('Ctrl+Y')).toBe('Control+Y')
    expect(ariaKeyShortcuts('Ctrl+Shift+Z')).toBe('Control+Shift+Z')
  })
})
