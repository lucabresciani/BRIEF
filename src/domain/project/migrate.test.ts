import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DEFAULT_FIT_STYLE } from '@/domain/model'
import { migrateDoc, migrateLog, migrateProjectJSON } from './migrate'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- free-form project JSON
type Json = any

const fixture = (name: string) => readFileSync(resolve('tests/fixtures/projects', name), 'utf8')
const V1: Json = JSON.parse(fixture('v1-ok.sciplot'))
const V2: Json = JSON.parse(fixture('v2-multiplot.sciplot'))
const v1 = (): Json => structuredClone(V1)

function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object') {
    Object.freeze(v)
    for (const k of Object.keys(v)) deepFreeze((v as Record<string, unknown>)[k])
  }
  return v
}

/** mulberry32: deterministic pseudo-random numbers for a reproducible fuzz. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('migrateProjectJSON: version 1 → 2', () => {
  const { json, from } = migrateProjectJSON(v1())
  const out = json as Json

  it('reports the declared version and writes the current one', () => {
    expect(from).toBe(1)
    expect(out.schemaVersion).toBe(2)
    expect(out.format).toBe('sciplot')
    expect(Object.hasOwn(out, 'workspace')).toBe(false) // nothing invented for the layout
  })

  it('fills the defaults that reproduce the schema 1 behaviour', () => {
    const plot = out.project.plots[0]
    expect(plot.name).toBe('')
    expect(plot.series.map((s: Json) => s.split)).toEqual([null, null])
    expect(plot.histogram.groupBy).toBeNull()
    expect(plot.histogram.groupMode).toBe('overlay')
    expect(plot.box.colorByGroup).toBe(false)
    expect(plot.bar.colorByCategory).toBe(false)
    for (const f of out.project.fits) {
      expect(f.style).toEqual({ color: { mode: 'series' }, dash: 'auto', width: 2 })
      expect(f.perGroup).toBe(false)
    }
    expect(out.operationLog.map((e: Json) => e.plotId)).toEqual(V1.operationLog.map(() => null))
  })

  it('changes nothing else: removing the added fields gives back the v1 file', () => {
    const back = structuredClone(out)
    back.schemaVersion = 1
    for (const p of back.project.plots) {
      delete p.name
      delete p.histogram.groupBy
      delete p.histogram.groupMode
      delete p.box.colorByGroup
      delete p.bar.colorByCategory
      for (const s of p.series) delete s.split
    }
    for (const f of back.project.fits) {
      delete f.style
      delete f.perGroup
    }
    for (const e of back.operationLog) delete e.plotId
    expect(back).toEqual(V1)
  })

  it('gives every fit its own style object (no shared default that a later edit could change)', () => {
    const [a, b] = out.project.fits
    expect(a.style).not.toBe(b.style)
    expect(a.style).not.toBe(DEFAULT_FIT_STYLE)
    expect(a.style.color).not.toBe(DEFAULT_FIT_STYLE.color)
  })

  it('is pure: the input is never mutated (works on frozen input)', () => {
    const input = deepFreeze(v1())
    expect(() => migrateProjectJSON(input)).not.toThrow()
    expect(input).toEqual(V1)
    expect(migrateProjectJSON(input).json).toEqual(out)
  })

  it('keeps the raw tables as they are (the same arrays: no copy of the measured data)', () => {
    const input = v1()
    const r = migrateProjectJSON(input).json as Json
    expect(r.rawTables).toBe(input.rawTables)
    expect(r.project.datasets).toBe(input.project.datasets)
  })
})

describe('migrateProjectJSON: idempotence and other versions', () => {
  it('migrating twice gives the same result as once', () => {
    const once = migrateProjectJSON(v1())
    const twice = migrateProjectJSON(once.json)
    expect(twice.json).toEqual(once.json)
    expect(twice.from).toBe(2)
  })

  it('returns a current or unknown version unchanged (the schema judges it)', () => {
    for (const v of [2, 3, 99, 0, -1]) {
      const input = { ...V1, schemaVersion: v }
      const r = migrateProjectJSON(input)
      expect(r.json, String(v)).toBe(input)
      expect(r.from, String(v)).toBe(v)
    }
    for (const v of [undefined, null, '1', 1.5, NaN, [1], {}]) {
      const input = { ...V1, schemaVersion: v }
      const r = migrateProjectJSON(input)
      expect(r.json).toBe(input)
      expect(r.from).toBeNull()
    }
    const current = structuredClone(V2)
    expect(migrateProjectJSON(current).json).toBe(current)
  })

  it('never overwrites a field that is present, even when it is malformed', () => {
    const input = v1()
    input.project.plots[0].name = 'Mine'
    input.project.plots[0].series[0].split = { column: 'col_6f8bad24d', overrides: [] }
    input.project.plots[0].histogram.groupMode = 'stack'
    input.project.plots[0].box.colorByGroup = 'not a boolean'
    input.project.fits[0].style = 42
    input.project.fits[0].perGroup = true
    input.operationLog[0].plotId = 'plt_0e4b8f2d1h'
    const out = migrateProjectJSON(input).json as Json
    const plot = out.project.plots[0]
    expect(plot.name).toBe('Mine')
    expect(plot.series[0].split).toEqual({ column: 'col_6f8bad24d', overrides: [] })
    expect(plot.series[1].split).toBeNull()
    expect(plot.histogram).toMatchObject({ groupBy: null, groupMode: 'stack' })
    expect(plot.box.colorByGroup).toBe('not a boolean')
    expect(out.project.fits[0]).toMatchObject({ style: 42, perGroup: true })
    expect(out.project.fits[1]).toMatchObject({ style: DEFAULT_FIT_STYLE, perGroup: false })
    expect(out.operationLog[0].plotId).toBe('plt_0e4b8f2d1h')
    expect(out.operationLog[1].plotId).toBeNull()
  })

  it('treats a field stored as undefined (possible in IndexedDB) as missing', () => {
    const doc = {
      plots: [{ name: undefined, series: [{ split: undefined }] }],
      fits: [{ perGroup: undefined }],
    }
    const out = migrateDoc(doc, 1) as Json
    expect(out.plots[0].name).toBe('')
    expect(out.plots[0].series[0].split).toBeNull()
    expect(out.fits[0].perGroup).toBe(false)
  })
})

describe('migrateDoc / migrateLog', () => {
  it('leave a document or log of the current schema untouched (same object)', () => {
    const doc = V2.project
    expect(migrateDoc(doc, 2)).toBe(doc)
    expect(migrateLog(V2.operationLog, 2)).toBe(V2.operationLog)
    // Already complete: even "from 1", nothing is copied.
    expect(migrateDoc(doc, 1)).toBe(doc)
    expect(migrateLog(V2.operationLog, 1)).toBe(V2.operationLog)
  })

  it('fill only what is missing', () => {
    const doc = migrateDoc(v1().project, 1) as Json
    expect(doc).toEqual((migrateProjectJSON(v1()).json as Json).project)
    expect(migrateLog([{ id: 'a' }, { id: 'b', plotId: 'p' }], 1)).toEqual([
      { id: 'a', plotId: null },
      { id: 'b', plotId: 'p' },
    ])
  })

  it('never throw on malformed input and pass what they do not understand through', () => {
    const odd: unknown[] = [
      null,
      undefined,
      0,
      'doc',
      true,
      [],
      {},
      { plots: null, fits: 'x' },
      { plots: [null, 1, 'p', [], {}], fits: [null, 2, [], {}] },
      { plots: [{ series: 'x', histogram: null, box: [], bar: 7 }] },
      { plots: [{ series: [null, 3, [], { split: null }] }] },
      Object.create(null),
    ]
    for (const v of odd) {
      expect(() => migrateDoc(v, 1)).not.toThrow()
      expect(() => migrateLog(v, 1)).not.toThrow()
      expect(() => migrateProjectJSON(v)).not.toThrow()
      expect(() =>
        migrateProjectJSON({ format: 'sciplot', schemaVersion: 1, project: v, operationLog: v }),
      ).not.toThrow()
    }
    expect(migrateDoc(null, 1)).toBeNull()
    expect(migrateDoc('doc', 1)).toBe('doc')
    expect(migrateLog('log', 1)).toBe('log')
    const weird = migrateDoc({ plots: [null, 1, {}], fits: [null, {}] }, 1) as Json
    expect(weird.plots.slice(0, 2)).toEqual([null, 1])
    expect(weird.plots[2]).toEqual({ name: '' })
    expect(weird.fits).toEqual([null, { style: DEFAULT_FIT_STYLE, perGroup: false }])
    // A v1 file without project or log: no key is invented, the schema reports them as missing.
    const bare = migrateProjectJSON({ format: 'sciplot', schemaVersion: 1 }).json as Json
    expect(bare).toEqual({ format: 'sciplot', schemaVersion: 2 })
  })

  it('stays total and idempotent on randomly damaged v1 files', () => {
    const random = rng(20261015)
    const replacements: Json[] = [null, -1, 0, '', 'x', true, [], {}, [null], { a: 1 }]
    function slots(v: Json, out: [Json, string | number][] = []): [Json, string | number][] {
      if (v && typeof v === 'object')
        for (const k of Object.keys(v)) {
          out.push([v, Array.isArray(v) ? Number(k) : k])
          // The raw tables hold thousands of cells: damaging them says nothing about the migration.
          if (k !== 'rawTables') slots(v[k], out)
        }
      return out
    }
    for (let iter = 0; iter < 300; iter++) {
      const j = v1()
      for (let m = 0; m < 1 + Math.floor(random() * 4); m++) {
        const all = slots(j)
        const [parent, key] = all[Math.floor(random() * all.length)]
        if (random() < 0.3 && !Array.isArray(parent)) delete parent[key]
        else parent[key] = replacements[Math.floor(random() * replacements.length)]
      }
      const before = JSON.stringify(j)
      let once: ReturnType<typeof migrateProjectJSON> | undefined
      expect(() => (once = migrateProjectJSON(j))).not.toThrow()
      expect(JSON.stringify(j)).toBe(before) // input untouched
      expect(migrateProjectJSON(once!.json).json).toEqual(once!.json)
      const doc = migrateDoc(j.project, 1)
      expect(migrateDoc(doc, 1)).toEqual(doc)
      const log = migrateLog(j.operationLog, 1)
      expect(migrateLog(log, 1)).toEqual(log)
    }
  })
})
