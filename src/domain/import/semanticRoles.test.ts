import { describe, expect, it } from 'vitest'
import type { ColumnKind } from '@/domain/model'
import { suggestRoles, type RoleInput } from './semanticRoles'

const num = (name: string, extra: Partial<RoleInput> = {}): RoleInput => ({
  name,
  unit: null,
  kind: 'numeric',
  ...extra,
})
const col = (name: string, kind: ColumnKind): RoleInput => ({ name, unit: null, kind })
const roles = (cols: RoleInput[]) => suggestRoles(cols).map((r) => r.role)

describe('suggestRoles — the example datasets', () => {
  it('free fall: u(y) is the uncertainty of y', () => {
    const r = suggestRoles([num('t', { unit: 's' }), num('y', { unit: 'm' }), num('u(y)', { unit: 'm' })])
    expect(r).toEqual([
      { role: 'measurement', uncertaintyOf: null },
      { role: 'measurement', uncertaintyOf: null },
      { role: 'uncertainty', uncertaintyOf: 1 },
    ])
  })

  it('cooling: ΔT is a temperature difference, not an uncertainty', () => {
    expect(roles([num('t'), num('T'), num('ΔT', { unit: 'K' })])).toEqual([
      'measurement',
      'measurement',
      'measurement',
    ])
  })

  it('pendulum: trial → identifier, observer → group', () => {
    expect(roles([num('trial', { integerValued: true }), col('observer', 'categorical'), num('T')])).toEqual([
      'identifier',
      'group',
      'measurement',
    ])
  })

  it('Beer–Lambert: replicate → identifier', () => {
    expect(roles([num('c'), num('A'), num('replicate')])).toEqual([
      'measurement',
      'measurement',
      'identifier',
    ])
  })

  it('Ohm: plain measurements', () => {
    expect(roles([num('I'), num('V')])).toEqual(['measurement', 'measurement'])
  })
})

describe('suggestRoles — uncertainty names', () => {
  it('explicit references resolve to the named column', () => {
    const cases: [string, number][] = [
      ['u(V)', 1],
      ['u_V', 1],
      ['σ_V', 1],
      ['σV', 1],
      ['δV', 1],
      ['dV', 1],
      ['± V', 1],
      ['V_err', 1],
      ['V error', 1],
      ['Verr', 1],
      ['sigma I', 0],
      ['err I', 0],
      ['uncertainty of I', 0],
      ['incertezza di V', 1],
      ['u(y) (m)', -1],
    ]
    for (const [name, ref] of cases) {
      const r = suggestRoles([num('I'), num('V'), num(name)])[2]
      expect(r.role, name).toBe('uncertainty')
      expect(r.uncertaintyOf, name).toBe(ref < 0 ? null : ref)
    }
  })

  it('generic names refer to the nearest numeric measurement on the left', () => {
    for (const name of [
      'σ',
      'sigma',
      'err',
      'Error',
      'SD',
      'SEM',
      'uncertainty',
      'incertezza',
      '±',
      'std dev',
      'errore',
    ]) {
      const r = suggestRoles([num('x'), num('y'), num(name)])[2]
      expect(r, name).toEqual({ role: 'uncertainty', uncertaintyOf: 1 })
    }
    // skips identifiers and other uncertainty columns
    const r = suggestRoles([num('y'), num('run'), num('σ')])
    expect(r[2]).toEqual({ role: 'uncertainty', uncertaintyOf: 0 })
  })

  it('reference matching is exact first, case-insensitive only when unique', () => {
    expect(suggestRoles([num('t'), num('T'), num('u(T)')])[2].uncertaintyOf).toBe(1)
    expect(suggestRoles([num('t'), num('T'), num('u(tt)')])[2].uncertaintyOf).toBeNull()
    expect(suggestRoles([num('Voltage'), num('u(voltage)')])[1].uncertaintyOf).toBe(0)
  })

  it('an explicit reference that does not exist gives no target', () => {
    expect(suggestRoles([num('x'), num('u(z)')])[1]).toEqual({ role: 'uncertainty', uncertaintyOf: null })
  })

  it('attached prefixes/suffixes and word prefixes need an existing column', () => {
    expect(roles([num('t'), num('depth')])).toEqual(['measurement', 'measurement'])
    expect(roles([num('t'), num('density')])).toEqual(['measurement', 'measurement'])
    expect(roles([num('t'), num('Error rate')])).toEqual(['measurement', 'measurement'])
    expect(roles([num('t'), num('dx')])).toEqual(['measurement', 'measurement'])
  })

  it('Δ is never an uncertainty; non-numeric columns are never uncertainties', () => {
    expect(roles([num('y'), num('Δy')])).toEqual(['measurement', 'measurement'])
    expect(roles([num('y'), col('error', 'text')])).toEqual(['measurement', 'measurement'])
  })

  it('a reference to another uncertainty column is dropped', () => {
    const r = suggestRoles([num('y'), num('σ'), num('u(σ)')])
    expect(r[2]).toEqual({ role: 'uncertainty', uncertaintyOf: null })
  })
})

describe('suggestRoles — physical symbols are not uncertainties', () => {
  it('σ / sigma with a unit that does not fit the column on the left is a quantity (stress, conductivity)', () => {
    expect(roles([num('ε', { unit: '%' }), num('σ', { unit: 'MPa' })])).toEqual([
      'measurement',
      'measurement',
    ])
    expect(roles([num('T', { unit: 'K' }), num('sigma', { unit: 'S/m' })])).toEqual([
      'measurement',
      'measurement',
    ])
    expect(roles([num('x'), num('σ', { unit: 'MPa' })])).toEqual(['measurement', 'measurement'])
    expect(roles([num('σ', { unit: 'MPa' }), num('ε', { unit: '%' })])).toEqual([
      'measurement',
      'measurement',
    ])
  })

  it('a fitting unit (same, none, or %) keeps σ as the uncertainty of its neighbour', () => {
    for (const unit of ['m', null, '%']) {
      const r = suggestRoles([num('t', { unit: 's' }), num('y', { unit: 'm' }), num('σ', { unit })])[2]
      expect([unit, r]).toEqual([unit, { role: 'uncertainty', uncertaintyOf: 1 }])
    }
    expect(suggestRoles([num('d', { unit: 'μm' }), num('σ', { unit: 'µm' })])[1].uncertaintyOf).toBe(0)
  })

  it('a generic WORD with a unit that does not fit stays an uncertainty, without a target', () => {
    expect(suggestRoles([num('y', { unit: 'm' }), num('err', { unit: 's' })])[1]).toEqual({
      role: 'uncertainty',
      uncertaintyOf: null,
    })
  })

  it('"U_C" (a capacitor voltage) is not "u_C"; the u_ prefix needs an existing column', () => {
    expect(roles([num('t', { unit: 's' }), num('U_C', { unit: 'V' })])).toEqual([
      'measurement',
      'measurement',
    ])
    expect(roles([num('t'), num('u_C')])).toEqual(['measurement', 'measurement'])
    expect(suggestRoles([num('C'), num('u_C')])[1]).toEqual({ role: 'uncertainty', uncertaintyOf: 0 })
    expect(roles([num('x'), num('σ_y')])).toEqual(['measurement', 'measurement'])
  })

  it('a symbol prefix with an incompatible unit is a quantity ("σ_x (MPa)" next to "x (mm)")', () => {
    expect(roles([num('x', { unit: 'mm' }), num('σ_x', { unit: 'MPa' })])).toEqual([
      'measurement',
      'measurement',
    ])
    expect(suggestRoles([num('x', { unit: 'mm' }), num('u_x', { unit: 'mm' })])[1].uncertaintyOf).toBe(0)
  })

  it('"Se" is selenium; SE / se / SD / sd are abbreviations', () => {
    expect(roles([num('Fe', { unit: 'mg/L' }), num('Se', { unit: 'mg/L' })])).toEqual([
      'measurement',
      'measurement',
    ])
    for (const name of ['SE', 'se', 'SD', 'sd']) {
      expect([name, suggestRoles([num('y'), num(name)])[1]]).toEqual([
        name,
        { role: 'uncertainty', uncertaintyOf: 0 },
      ])
    }
  })
})

describe('suggestRoles — groups and identifiers', () => {
  it('categorical columns are groups', () => {
    expect(
      roles([col('observer', 'categorical'), col('colour', 'categorical'), col('trial', 'categorical')]),
    ).toEqual(['group', 'group', 'group'])
  })

  it('identifier names need integer values when known', () => {
    expect(roles([num('#'), num('id'), num('Run'), num('Trial', { integerValued: false })])).toEqual([
      'identifier',
      'identifier',
      'identifier',
      'measurement',
    ])
    expect(roles([num('n', { integerValued: true, consecutive: true }), num('n')])).toEqual([
      'identifier',
      'measurement',
    ])
  })

  it('a bare "N" of counts is a measurement; only a 1, 2, 3… counter is an identifier', () => {
    expect(
      roles([num('N', { integerValued: true, consecutive: false }), num('N', { integerValued: true })]),
    ).toEqual(['measurement', 'measurement'])
  })

  it('numeric group names (sample 1, 2, 3) are groups; text and datetime columns are measurements', () => {
    expect(
      roles([num('Sample', { integerValued: true }), col('Notes', 'text'), col('Date', 'datetime')]),
    ).toEqual(['group', 'measurement', 'measurement'])
  })
})
