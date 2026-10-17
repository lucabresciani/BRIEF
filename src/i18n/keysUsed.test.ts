import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { en } from './en'

/**
 * Keys the code builds at run time from a value, written as the template literal that builds them with
 * each ${…} replaced by * (any value) or by {a,b} when the value comes from a short closed list. A
 * placeholder stands for exactly one dictionary key, which may itself hold dots (history.ops['plot.remove']),
 * so a family never hides unused keys elsewhere in its section.
 */
const DYNAMIC = [
  'axes.{x,y}',
  'derived.ops.*',
  'examples.*.desc',
  'examples.*.name',
  'exclusion.reasons.*',
  'fit.modelShort.*',
  'fit.models.*',
  'help.methodsBody.*',
  'help.topics.*.body',
  'help.topics.*.title',
  'history.ops.*',
  'import.decimals.*',
  'import.delimiters.*',
  'import.kinds.*',
  'import.roles.*',
  'inspector.{plot,fit,uncertainty,statistics,style}',
  'issues.*.hint',
  'issues.*.title',
  'legend.band.{confidence,prediction}',
  'legend.band.{confidence,prediction}Of',
  'level.{beginner,intermediate,advanced}',
  'level.{beginner,intermediate,advanced}Hint',
  'picker.list.kinds.*',
  'picker.merge.kinds.*',
  'picker.selection.{rows,columns}',
  'plot.{zoom,pan,boxSelect,lasso}',
  'plot.layout.*',
  'plot.types.*',
  'settings.numberFormats.*',
  'style.colors.*',
  'style.dashes.*',
  'style.positions.*',
  'style.symbols.*',
  'uncertainty.kinds.*',
  'uncertainty.label.*',
  'uncertainty.meanings.*',
  'uncertainty.origins.*',
  'uncertainty.sources.*',
  'walkthrough.*.steps',
  'walkthrough.*.title',
]

const SRC = join(import.meta.dirname, '..')
const DICTIONARY_FILES = /[\\/]i18n[\\/](en|it|issues\.en|issues\.it)\.ts$/

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'test') sourceFiles(path, out)
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.test\.tsx?$/.test(entry.name) &&
      !DICTIONARY_FILES.test(path)
    )
      out.push(path)
  }
  return out
}

/** Leaf keys as segment lists. Arrays are leaves, as tList reads them whole. */
function leaves(node: unknown, path: string[] = [], out: string[][] = []): string[][] {
  if (typeof node === 'string' || Array.isArray(node)) out.push(path)
  else if (node && typeof node === 'object')
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) leaves(v, [...path, k], out)
  return out
}

const PLACEHOLDER = /\*|\{([^}]*)\}/g
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** One segment of a DYNAMIC pattern → a regular expression over one dictionary key. */
function segmentRegExp(segment: string): RegExp {
  let source = ''
  let last = 0
  for (const m of segment.matchAll(PLACEHOLDER)) {
    source +=
      escape(segment.slice(last, m.index)) +
      (m[1] === undefined ? '.+' : `(?:${m[1].split(',').map(escape).join('|')})`)
    last = m.index + m[0].length
  }
  return new RegExp(`^${source}${escape(segment.slice(last))}$`)
}

const matchers = DYNAMIC.map((pattern) => {
  // Alternatives never hold dots, so the pattern splits into segments at every dot.
  const segments = pattern.split('.').map(segmentRegExp)
  return (key: string[]) => key.length === segments.length && segments.every((re, i) => re.test(key[i]))
})

describe('i18n keys are used', () => {
  // Comments are kept: a key named only in a comment still counts, which errs on the side of keeping it.
  const code = sourceFiles(SRC)
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n')

  it('every dictionary key is referenced by the app, literally or through a DYNAMIC family', () => {
    const unused = leaves(en)
      .filter((key) => !matchers.some((m) => m(key)))
      .map((key) => key.join('.'))
      .filter((key) => !['"', "'", '`'].some((q) => code.includes(`${q}${key}${q}`)))
    expect(unused).toEqual([])
  })

  it('every DYNAMIC family is still built by a template literal in the app', () => {
    const stale = DYNAMIC.filter((pattern) => {
      const parts = pattern.split(PLACEHOLDER).filter((_, i) => i % 2 === 0)
      return !new RegExp('`' + parts.map((p) => escape(p ?? '')).join('\\$\\{[^}`]+\\}') + '`').test(code)
    })
    expect(stale).toEqual([])
  })
})
