import { describe, expect, it as test } from 'vitest'
import { ALL_REASON_CODES } from '@/domain/model'
import { en } from './en'
import { it } from './it'
import { interpolate, makeTranslator } from './translate'

type Node = string | readonly unknown[] | { [k: string]: Node }

function flatten(node: unknown, prefix = '', out = new Map<string, string>()): Map<string, string> {
  if (typeof node === 'string') out.set(prefix, node)
  else if (Array.isArray(node)) node.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out))
  else if (node && typeof node === 'object')
    for (const [k, v] of Object.entries(node as Record<string, Node>))
      flatten(v, prefix ? `${prefix}.${k}` : k, out)
  return out
}

// {name}, the plural form {name|one|other} and the select form {name|a=…|b=…} (also nested inside an
// option) all count as a use of {name}; the labels of a select (=a, =b) must match too.
const placeholders = (s: string) =>
  [
    ...new Set([
      ...[...s.matchAll(/\{(\w+)/g)].map((m) => m[1]),
      ...[...s.matchAll(/\|(\w+)=/g)].map((m) => `=${m[1]}`),
    ]),
  ].sort()

describe('i18n dictionaries', () => {
  const fe = flatten(en)
  const fi = flatten(it)

  test('English and Italian have exactly the same keys', () => {
    expect([...fi.keys()].sort()).toEqual([...fe.keys()].sort())
  })

  test('every string keeps the same {placeholders}', () => {
    const mismatches: string[] = []
    for (const [k, v] of fe)
      if (placeholders(v).join() !== placeholders(fi.get(k) ?? '').join()) mismatches.push(k)
    expect(mismatches).toEqual([])
  })

  test('every ReasonCode has a title and a hint in both languages', () => {
    for (const code of ALL_REASON_CODES) {
      expect(fe.has(`issues.${code}.title`), code).toBe(true)
      expect(fe.has(`issues.${code}.hint`), code).toBe(true)
      expect(fi.has(`issues.${code}.title`), code).toBe(true)
    }
  })

  test('no em or en dashes used as punctuation in visible copy', () => {
    const offenders: string[] = []
    for (const [k, v] of [...fe, ...fi]) if (/[—]/.test(v) || /\s–\s/.test(v)) offenders.push(k)
    expect(offenders).toEqual([])
  })

  test('interpolation and fallback', () => {
    expect(interpolate('n = {n} of {total}', { n: 9, total: 10 })).toBe('n = 9 of 10')
    expect(interpolate('{missing}', {})).toBe('{missing}')
    expect(interpolate('{count} {count|row|rows}', { count: 1 })).toBe('1 row')
    expect(interpolate('{count} {count|row|rows}', { count: 3 })).toBe('3 rows')
    expect(interpolate('{count} {count|riga|righe}', { count: 0 })).toBe('0 righe')
    const t = makeTranslator('it')
    expect(t('topbar.undo')).toBe('Annulla')
    expect(t('issues.E_CONSTANT_X.title')).toBe('Tutti i valori di x sono uguali.')
    expect(t('does.not.exist')).toBe('does.not.exist')
  })
})
