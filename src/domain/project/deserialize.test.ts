import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { issue, type NotebookDataset } from '@/domain/model'
import { checkRefs } from '@/domain/model/integrity'
import { deserializeProject } from './deserialize'
import { migrateProjectJSON } from './migrate'
import { serializeProject, utf8ByteLength } from './serialize'
import { ProjectFileSchema } from './schema'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- free-form edits of parsed fixture JSON
type Json = any

const fixture = (name: string) => readFileSync(resolve('tests/fixtures/projects', name), 'utf8')
const V1 = fixture('v1-ok.sciplot')
const V2 = fixture('v2-multiplot.sciplot')
/** Every v1 file that opens carries this notice first. */
const MIGRATED = issue('I_PROJECT_MIGRATED', { from: 1, to: 2 })

function loaded(text: string) {
  const r = deserializeProject(text)
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`)
  return r
}
function failure(text: string, opts?: { maxBytes?: number }) {
  const r = deserializeProject(text, opts)
  if (r.ok) throw new Error('expected a failure')
  return r.error
}
function edited(edit: (j: Json) => void, base: string = V1): string {
  const j = JSON.parse(base)
  edit(j)
  return JSON.stringify(j)
}

const DS_OHM = 'ds_2a9f6c015'
const DS_PEND = 'ds_7b3d1e826'
const RAW_PEND = 'raw_c41e9b7a4'

describe('deserializeProject: v1-ok fixture', () => {
  it('opens with only the migration notice and restores typed arrays, NaN and sourceRow', () => {
    const { value, warnings } = loaded(V1)
    expect(warnings).toEqual([MIGRATED])
    expect(value.repaired).toEqual([MIGRATED])
    expect(value.workspace).toBeNull()
    expect(value.doc.datasets.map((d) => d.origin)).toEqual(['import', 'import', 'notebook'])
    expect(value.doc.plots[0].series).toHaveLength(2)
    expect(value.doc.fits.map((f) => f.model.type)).toEqual(['linear', 'polynomial'])
    expect(value.doc.exclusions[0]).toMatchObject({ datasetId: DS_OHM, rowIds: [5] })
    expect(value.log).toHaveLength(9)
    expect(value.meta).toEqual({ appVersion: '0.1.0', savedAt: '2026-10-02T10:02:30.000Z' })

    const pend = value.rawTables[RAW_PEND]
    expect(pend.sourceRow).toBeInstanceOf(Int32Array)
    expect(Array.from(pend.sourceRow)).toEqual([2, 3, 4, 5, 6, 7, 8])
    const T = pend.columns[2].native!
    expect(T.kind).toBeInstanceOf(Uint8Array)
    expect(T.num).toBeInstanceOf(Float64Array)
    expect(Array.from(T.num.slice(1))).toEqual([1.7, 1.75, NaN, 1.66, 1.98, 1.79])
    expect(Number.isNaN(T.num[3])).toBe(true)
    expect(pend.columns[2].text[3]).toBe('')
    expect(checkRefs(value.doc)).toEqual([])
  })

  it('fills the schema 2 fields with the values that reproduce the schema 1 behaviour', () => {
    const { doc, log } = loaded(V1).value
    const plot = doc.plots[0]
    expect(plot.name).toBe('')
    expect(plot.series.map((s) => s.split)).toEqual([null, null])
    expect(plot.histogram).toMatchObject({ groupBy: null, groupMode: 'overlay' })
    expect(plot.box.colorByGroup).toBe(false)
    expect(plot.bar.colorByCategory).toBe(false)
    for (const f of doc.fits) {
      expect(f.style).toEqual({ color: { mode: 'series' }, dash: 'auto', width: 2 })
      expect(f.perGroup).toBe(false)
    }
    expect(log.every((e) => e.plotId === null)).toBe(true)
    expect(doc.activePlotId).toBe(plot.id)
  })

  it('saves back as version 2 with the same content plus the defaults', () => {
    const { value } = loaded(V1)
    const again = serializeProject(
      value.doc,
      value.rawTables,
      value.log,
      value.meta.appVersion,
      value.meta.savedAt,
    )
    expect(JSON.parse(again)).toEqual(migrateProjectJSON(JSON.parse(V1)).json)
    expect(JSON.parse(again).schemaVersion).toBe(2)
    // Reopened, the saved file is no longer migrated.
    expect(loaded(again).warnings).toEqual([])
  })

  it('accepts a UTF-8 BOM added by an editor', () => {
    expect(loaded(String.fromCharCode(0xfeff) + V1).value.doc).toEqual(loaded(V1).value.doc)
  })

  it('strips unknown keys instead of failing', () => {
    const { value } = loaded(edited((j) => (j.project.futureOption = { enabled: true })))
    expect(Object.hasOwn(value.doc, 'futureOption')).toBe(false)
  })
})

describe('deserializeProject: refusals', () => {
  it('refuses a file above the size limit, counted in UTF-8 bytes', () => {
    const bytes = utf8ByteLength(V1)
    expect(bytes).toBeGreaterThan(V1.length) // the fixture contains — and Ω
    expect(deserializeProject(V1, { maxBytes: bytes }).ok).toBe(true)
    const e = failure(V1, { maxBytes: V1.length })
    expect(e.code).toBe('E_PROJECT_TOO_LARGE')
    expect(e.severity).toBe('error')
    expect(e.params).toMatchObject({ size: expect.any(Number), limit: expect.any(Number) })
    expect(failure(V1, { maxBytes: 100 }).code).toBe('E_PROJECT_TOO_LARGE')
  })

  it('refuses text that is not JSON', () => {
    const e = failure(fixture('not-json.sciplot'))
    expect(e.code).toBe('E_PROJECT_NOT_JSON')
    expect(typeof e.params?.detail).toBe('string')
    expect(failure('').code).toBe('E_PROJECT_NOT_JSON')
    expect(failure('[[[[[[[[[[').code).toBe('E_PROJECT_NOT_JSON')
  })

  it('refuses JSON that is not a sciplot project', () => {
    for (const text of ['[]', 'null', '42', '"sciplot"', '{"format":"csv","schemaVersion":1}', '{}'])
      expect(failure(text).code).toBe('E_PROJECT_NOT_SCIPLOT')
  })

  it('refuses a newer schema version without parsing it (3 included)', () => {
    const spy = vi.spyOn(ProjectFileSchema, 'safeParse')
    try {
      const e = failure(fixture('v99-future.sciplot'))
      expect(e.code).toBe('E_PROJECT_NEWER_VERSION')
      expect(e.params).toEqual({ v: 99 })
      expect(spy).not.toHaveBeenCalled()
      expect(failure(edited((j) => (j.schemaVersion = 3), V2))).toMatchObject({
        code: 'E_PROJECT_NEWER_VERSION',
        params: { v: 3 },
      })
      expect(spy).not.toHaveBeenCalled()
      loaded(V1)
      expect(spy).toHaveBeenCalledTimes(1) // the spy does observe the normal path
    } finally {
      spy.mockRestore()
    }
  })

  it('treats a missing or malformed schema version as an invalid file', () => {
    for (const v of [undefined, 0, '1', 1.5, null]) {
      const text = edited((j) => (j.schemaVersion = v))
      expect(failure(text).code).toBe('E_PROJECT_INVALID')
    }
  })

  it('summarises at most five validation problems', () => {
    const text = edited((j) => {
      const p = j.project
      for (const o of [
        p,
        p.datasets[0],
        p.datasets[1],
        p.plots[0],
        p.fits[0],
        p.fits[1],
        p.exclusions[0],
        p.filters[0],
      ])
        o.id = 'bad id!'
    })
    const e = failure(text)
    expect(e.code).toBe('E_PROJECT_INVALID')
    expect(e.params?.count).toBe(8)
    const summary = String(e.params?.summary)
    const parts = summary.split('; ')
    expect(parts).toHaveLength(6)
    expect(parts[0]).toBe('project.id: Invalid id')
    expect(parts[1]).toBe('project.datasets[0].id: Invalid id')
    expect(parts[5]).toBe('… 3 more')
  })

  it('rejects structural corruption: NaN text, wrong lengths, duplicates, reserved ids, bad kinds', () => {
    const cases: [string, (j: Json) => void, string][] = [
      [
        'native NaN as text',
        (j) => (j.rawTables[1].columns[2].native.num[3] = 'NaN'),
        'rawTables[1].columns[2].native.num',
      ],
      ['short column', (j) => j.rawTables[0].columns[1].text.pop(), 'rawTables[0].columns[1].text'],
      ['short sourceRow', (j) => j.rawTables[0].sourceRow.pop(), 'rawTables[0].sourceRow'],
      [
        'native kind 9',
        (j) => (j.rawTables[1].columns[0].native.kind[1] = 9),
        'rawTables[1].columns[0].native.kind',
      ],
      ['row id −1', (j) => (j.project.exclusions[0].rowIds = [-1]), 'project.exclusions[0].rowIds'],
      [
        'row id above int32',
        (j) => (j.project.exclusions[0].rowIds = [2 ** 31]),
        'project.exclusions[0].rowIds',
      ],
      ['duplicate raw table', (j) => j.rawTables.push(j.rawTables[0]), 'rawTables[2].id'],
      [
        'duplicate notebook row',
        (j) => (j.project.datasets[2].rowIds = [0, 1, 1]),
        'project.datasets[2].rowIds',
      ],
      [
        'cells length',
        (j) => j.project.datasets[2].cells.col_8bad0f46f.pop(),
        'project.datasets[2].cells.col_8bad0f46f',
      ],
      ['reserved id', (j) => (j.project.datasets[0].id = 'toString'), 'project.datasets[0].id'],
      ['unknown origin', (j) => (j.project.datasets[0].origin = 'cloud'), 'project.datasets[0].origin'],
      ['confidence 0.8', (j) => (j.project.fits[0].confidence = 0.8), 'project.fits[0].confidence'],
      ['degree 11', (j) => (j.project.fits[1].model.degree = 11), 'project.fits[1].model.degree'],
      [
        'negative uncertainty',
        (j) => (j.project.plots[0].series[0].errorBars.x.source.value = -1),
        'project.plots[0].series[0].errorBars.x.source.value',
      ],
      ['unknown op', (j) => (j.operationLog[0].op = 'dataset.teleport'), 'operationLog[0].op'],
      [
        'unknown issue code',
        (j) => (j.rawTables[0].tokenIssues[0].code = 'W_NOPE'),
        'rawTables[0].tokenIssues[0].code',
      ],
    ]
    for (const [name, edit, path] of cases) {
      const e = failure(edited(edit))
      expect(e.code, name).toBe('E_PROJECT_INVALID')
      expect(String(e.params?.summary), name).toContain(path)
    }
  })
})

describe('deserializeProject: v2-multiplot fixture and schema versions', () => {
  it('opens a v2 file without any notice, with its plots, split, fit style and workspace', () => {
    const { value, warnings } = loaded(V2)
    expect(warnings).toEqual([])
    const [ohmPlot, pend] = value.doc.plots
    expect(value.doc.plots.map((p) => p.name)).toEqual(['Ohm R1', ''])
    expect(value.doc.activePlotId).toBe(pend.id)
    expect(pend.series[0].split).toEqual({
      column: 'col_6f8bad24d',
      overrides: [{ key: 'B', paletteIndex: 6, symbol: 'x' }],
    })
    expect(pend.histogram).toMatchObject({ groupBy: 'col_6f8bad24d', groupMode: 'stack' })
    expect(pend.box.colorByGroup).toBe(true)
    expect(pend.bar.colorByCategory).toBe(true)
    expect(ohmPlot.series.map((s) => s.split)).toEqual([null, null])
    const fit = value.doc.fits.find((f) => f.seriesId === pend.series[0].id)!
    expect(fit).toMatchObject({
      style: { color: { mode: 'palette', index: 6 }, dash: 'dot', width: 3 },
      perGroup: true,
    })
    expect(value.workspace).toEqual({ layout: 'columns', panes: [ohmPlot.id, pend.id], focused: 1 })
    expect(value.log.filter((e) => e.plotId === pend.id).map((e) => e.op)).toEqual([
      'plot.create',
      'series.split',
      'fit.add',
    ])
    expect(value.rawTables[RAW_PEND].source.region).toMatchObject({ orientation: 'columns' })
    expect(checkRefs(value.doc)).toEqual([])
  })

  it('saves back to the same content, workspace included', () => {
    const { value } = loaded(V2)
    const again = serializeProject(
      value.doc,
      value.rawTables,
      value.log,
      value.meta.appVersion,
      value.meta.savedAt,
      { workspace: value.workspace },
    )
    expect(JSON.parse(again)).toEqual(JSON.parse(V2))
  })

  it('migrates only what the file declares as version 1: a v1 body declared as 2 is invalid', () => {
    const e = failure(edited((j) => (j.schemaVersion = 2)))
    expect(e.code).toBe('E_PROJECT_INVALID')
    expect(String(e.params?.summary)).toContain('project.plots[0].name')
  })

  it('migration never overwrites a field the v1 file already has', () => {
    const r = loaded(
      edited((j) => {
        j.project.plots[0].name = 'Kept'
        j.project.fits[0].style = { color: { mode: 'palette', index: 3 }, dash: 'dash', width: 1 }
      }),
    )
    expect(r.value.doc.plots[0].name).toBe('Kept')
    expect(r.value.doc.fits[0].style).toEqual({
      color: { mode: 'palette', index: 3 },
      dash: 'dash',
      width: 1,
    })
    expect(r.value.doc.fits[1].style).toEqual({ color: { mode: 'series' }, dash: 'auto', width: 2 })
    // ...and a malformed one is judged by the schema, not replaced by a default.
    const e = failure(edited((j) => (j.project.fits[0].perGroup = 'yes')))
    expect(String(e.params?.summary)).toContain('project.fits[0].perGroup')
  })

  it('rejects a malformed workspace, split or fit style', () => {
    const cases: [string, (j: Json) => void, string][] = [
      ['5 panes', (j) => (j.workspace.panes = ['a', 'b', 'c', 'd', 'e']), 'workspace.panes'],
      ['unknown layout', (j) => (j.workspace.layout = 'triple'), 'workspace.layout'],
      ['focused pane 4', (j) => (j.workspace.focused = 4), 'workspace.focused'],
      ['split without column', (j) => delete j.project.plots[1].series[0].split.column, 'split.column'],
      ['unknown symbol', (j) => (j.project.plots[1].series[0].split.overrides[0].symbol = 'star'), 'symbol'],
      ['width 0', (j) => (j.project.fits[2].style.width = 0), 'project.fits[2].style.width'],
      [
        'region past the end',
        (j) => (j.rawTables[1].source.region.blocks[0].rowCount = 8),
        'region.blocks[0]',
      ],
      ['label column 3', (j) => (j.rawTables[1].source.region.labelColumns = [3]), 'region.labelColumns[0]'],
    ]
    for (const [name, edit, path] of cases) {
      const e = failure(edited(edit, V2))
      expect(e.code, name).toBe('E_PROJECT_INVALID')
      expect(String(e.params?.summary), name).toContain(path)
    }
  })

  it('repairs a split or histogram grouping whose column is gone', () => {
    const r = loaded(
      edited((j) => {
        j.project.plots[1].series[0].split.column = 'col_gone'
        j.project.plots[1].histogram.groupBy = 'col_gone'
      }, V2),
    )
    expect(r.warnings).toEqual([issue('W_PROJECT_REPAIRED', { count: 2 })])
    const pend = r.value.doc.plots[1]
    expect(pend.series[0].split).toBeNull()
    expect(pend.histogram.groupBy).toBeNull()
    expect(pend.series).toHaveLength(1) // the series itself stays, as one curve
  })
})

describe('deserializeProject: prototype pollution', () => {
  it('drops __proto__ / constructor keys and never pollutes Object.prototype', () => {
    const text = fixture('proto-pollution.sciplot')
    // The fixture really carries them: a plain JSON.parse keeps an own "__proto__" property.
    expect(Object.hasOwn(JSON.parse(text), '__proto__')).toBe(true)
    const { value, warnings } = loaded(text)
    // Dropped right after parsing: nothing reaches validation or repair (the file is a v1 file).
    expect(warnings).toEqual([MIGRATED])
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined()
    expect(Object.getPrototypeOf(value.doc)).toBe(Object.prototype)
    expect(Object.hasOwn(value.doc, '__proto__')).toBe(false)
    expect(Object.hasOwn(value.doc, 'constructor')).toBe(false)
    const spring = value.doc.datasets[2] as NotebookDataset
    expect(Object.keys(spring.cells)).toEqual(['col_8bad0f46f', 'col_9cbe1a57g'])
    expect(value.doc).toEqual(loaded(V1).value.doc)
    // Even a careless Object.assign of the loaded document is now harmless.
    const target = Object.assign({}, value.doc)
    expect(Object.getPrototypeOf(target)).toBe(Object.prototype)
  })
})

describe('deserializeProject: repairs', () => {
  it('repairs the broken-refs fixture and reports W_PROJECT_REPAIRED', () => {
    const r = loaded(fixture('broken-refs.sciplot'))
    const expected = [MIGRATED, issue('W_PROJECT_REPAIRED', { count: 11 })]
    expect(r.warnings).toEqual(expected)
    expect(r.value.repaired).toEqual(expected)
    const doc = r.value.doc
    expect(checkRefs(doc)).toEqual([])
    const [ohm, , spring] = doc.datasets
    const plot = doc.plots[0]
    expect(doc.fits).toEqual([]) // dangling series; the other one lost its series (P removed)
    expect(doc.exclusions.map((e) => e.id)).toEqual(['exc_8c9d0e1fn'])
    expect(plot.series.map((s) => s.id)).toEqual(['ser_1a2b3c4di'])
    expect(plot.series[0].errorBars.y).toEqual({ kind: 'none' })
    expect(plot.series[0].errorBars.x.kind).toBe('measurement') // valid spec left alone
    expect(plot.box.groupBy).toBeNull()
    expect(plot.box.value).toBe('col_7a9cbe35e')
    expect(doc.activePlotId).toBe(plot.id)
    expect(ohm.columns.map((c) => c.name)).toEqual(['I', 'V', 'u(V)'])
    expect(ohm.columns[2].uncertaintyOf).toBeNull()
    expect(doc.filters.map((f) => f.id)).toEqual(['flt_2a3b4c5do'])
    expect((spring as NotebookDataset).nextRowId).toBe(4)
    // Measured data is never touched by a repair.
    expect(r.value.rawTables).toEqual(loaded(V1).value.rawTables)
  })

  it('removes a dataset whose raw table is missing, with everything that refers to it', () => {
    const r = loaded(edited((j) => j.rawTables.splice(1, 1)))
    expect(r.warnings).toEqual([MIGRATED, issue('W_PROJECT_REPAIRED', { count: 11 })])
    const doc = r.value.doc
    expect(doc.datasets.map((d) => d.id)).not.toContain(DS_PEND)
    expect(doc.plots[0].bar).toMatchObject({ datasetId: null, category: null, value: null })
    expect(doc.plots[0].histogram).toMatchObject({ datasetId: null, value: null })
    expect(doc.plots[0].box).toMatchObject({ datasetId: null, value: null, groupBy: null })
    expect(doc.filters).toEqual([])
    expect(doc.plots[0].series).toHaveLength(2) // the Ohm series do not depend on it
    expect(checkRefs(doc)).toEqual([])
  })

  it('removes a dataset whose raw table is empty', () => {
    const r = loaded(
      edited((j) => {
        const t = j.rawTables[0]
        t.rowCount = 0
        t.sourceRow = []
        for (const c of t.columns) c.text = []
      }),
    )
    // dataset + its 2 series + their 2 fits + its exclusion
    expect(r.warnings).toEqual([MIGRATED, issue('W_PROJECT_REPAIRED', { count: 6 })])
    expect(r.value.doc.datasets.map((d) => d.id)).not.toContain(DS_OHM)
    expect(r.value.doc.fits).toEqual([])
    expect(checkRefs(r.value.doc)).toEqual([])
  })

  it('clamps layout rows that point past the end of the raw table', () => {
    const r = loaded(
      edited((j) => {
        j.project.datasets[0].layout.dataEndRow = 40
        j.project.datasets[0].layout.headerRow = 50
      }),
    )
    expect(r.warnings).toEqual([MIGRATED, issue('W_PROJECT_REPAIRED', { count: 2 })])
    const ohm = r.value.doc.datasets[0]
    expect(ohm.origin === 'import' && ohm.layout).toMatchObject({ headerRow: null, dataEndRow: 12 })
  })
})

describe('deserializeProject: robustness', () => {
  /** mulberry32: deterministic pseudo-random numbers for a reproducible fuzz. */
  function rng(seed: number) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }
  function slots(v: Json, out: [Json, string | number][] = []): [Json, string | number][] {
    if (v && typeof v === 'object')
      for (const k of Object.keys(v)) {
        out.push([v, Array.isArray(v) ? Number(k) : k])
        slots(v[k], out)
      }
    return out
  }
  const replacements: Json[] = [
    null,
    -1,
    0,
    2 ** 31,
    1e308,
    'bad id!',
    '',
    'ds_2a9f6c015',
    'col_2b4d6f809',
    true,
    [],
    {},
    'NaN',
  ]

  it('handles pathologically deep nesting without throwing', () => {
    const deep =
      '{"format":"sciplot","schemaVersion":1,"x":' + '['.repeat(100_000) + ']'.repeat(100_000) + '}'
    expect(failure(deep).code).toBe('E_PROJECT_INVALID')
    expect(failure('['.repeat(100_000)).code).toBe('E_PROJECT_NOT_JSON')
  })

  it.each([
    ['v1', V1, 20261014],
    ['v2', V2, 20261015],
  ])(
    'never throws on randomly damaged %s files, and an accepted file has no dangling reference',
    (_, text, seed) => {
      const random = rng(seed)
      const base = JSON.parse(text)
      const outcomes = new Set<string>()
      for (let iter = 0; iter < 400; iter++) {
        const j = structuredClone(base)
        for (let m = 0; m < 1 + Math.floor(random() * 3); m++) {
          const all = slots(j)
          const [parent, key] = all[Math.floor(random() * all.length)]
          const op = random()
          if (op < 0.3 && !Array.isArray(parent)) delete parent[key]
          else parent[key] = replacements[Math.floor(random() * replacements.length)]
        }
        let r: ReturnType<typeof deserializeProject> | undefined
        expect(() => (r = deserializeProject(JSON.stringify(j)))).not.toThrow()
        outcomes.add(r!.ok ? 'ok' : r!.error.code)
        if (r!.ok) expect(checkRefs(r!.value.doc)).toEqual([])
        else
          expect(['E_PROJECT_INVALID', 'E_PROJECT_NOT_SCIPLOT', 'E_PROJECT_NEWER_VERSION']).toContain(
            r!.error.code,
          )
      }
      expect(outcomes.has('ok')).toBe(true)
      expect(outcomes.has('E_PROJECT_INVALID')).toBe(true)
    },
  )
})
