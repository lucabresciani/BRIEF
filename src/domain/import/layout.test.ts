import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decodeBytes } from './decode'
import { detectDelimiter } from './delimiter'
import {
  blankDataRows,
  columnUnit,
  detectLayout,
  isFlagCell,
  looksLikeUnit,
  looseNumericLike,
  splitNameUnit,
} from './layout'
import { tokenize } from './tokenize'

function gridOf(text: string) {
  const d = detectDelimiter(text)
  const r = tokenize(text, d.delimiter, { maxCells: 1_000_000 })
  if (!r.ok) throw new Error(r.error.code)
  return { ...r.value, sepLineRow: d.sepLine ? 0 : null }
}
const fixtureGrid = (name: string) =>
  gridOf(decodeBytes(new Uint8Array(readFileSync(resolve('tests/fixtures/import', name)))).text)
const detect = (text: string, opts: Parameters<typeof detectLayout>[1] = {}) => {
  const g = gridOf(text)
  return detectLayout(g.rows, { sepLineRow: g.sepLineRow, sourceRow: g.sourceRow, ...opts })
}
const codes = (l: { issues: { code: string }[] }) => l.issues.map((i) => i.code)

describe('splitNameUnit', () => {
  it.each([
    ['Voltage (V)', 'Voltage', 'V'],
    ['V [V]', 'V', 'V'],
    ['V[V]', 'V', 'V'],
    ['V / V', 'V', 'V'],
    ['c / (mg/L)', 'c', 'mg/L'],
    ['I (A)', 'I', 'A'],
    ['T (°C)', 'T', '°C'],
    ['ΔT (K)', 'ΔT', 'K'],
    ['c (mg/L)', 'c', 'mg/L'],
    ['A (AU)', 'A', 'AU'],
    ['v (m s^-1)', 'v', 'm s^-1'],
    ['u(y) (m)', 'u(y)', 'm'],
    ['u(y)(m)', 'u(y)', 'm'],
    ['t(s)', 't', 's'],
    ['Tensione (µV)', 'Tensione', 'µV'],
  ])('%s → name %s, unit %s', (h, name, unit) => {
    expect(splitNameUnit(h)).toEqual({ name, unit })
  })

  it.each(['u(y)', 'σ(x)', 'err(y)', 'ln(c)', 'trial', 'mg/L', 'x (sample 2, dried)', '(s)', 'f(x)'])(
    '%s has no unit',
    (h) => {
      expect(splitNameUnit(h)).toEqual({ name: h, unit: null })
    },
  )

  it('trims surrounding whitespace', () => {
    expect(splitNameUnit('  t  (s) ')).toEqual({ name: 't', unit: 's' })
  })

  // Headers as lab sheets write them: brackets with or without a space, units spelled out or of two words.
  it.each([
    ['h [mm]', 'h', 'mm'],
    ['q [N/m2]', 'q', 'N/m2'],
    ['P[J/s]', 'P', 'J/s'],
    ['h - h0 [mm H2O]', 'h - h0', 'mm H2O'],
    ['tilt(deg)', 'tilt', 'deg'],
    ['heat received (watts)', 'heat received', 'watts'],
    ['plate area (m^2)', 'plate area', 'm^2'],
    ['inner radius (in)', 'inner radius', 'in'],
    ['Tip speed (m/s)', 'Tip speed', 'm/s'],
    ['Pressure (kPa)', 'Pressure', 'kPa'],
    ['Prezzo (€)', 'Prezzo', '€'],
    ['tariff (€/kWh)', 'tariff', '€/kWh'],
    ['Turbidity (NTU)', 'Turbidity', 'NTU'],
    // Not plain words: a notation, kept as the unit (escaped wherever it is shown).
    ['y (A&B)', 'y', 'A&B'],
    ['Current (10^-3 A)', 'Current', '10^-3 A'],
  ])('%s → name %s, unit %s', (h, name, unit) => {
    expect(splitNameUnit(h)).toEqual({ name, unit })
  })

  it('a word in round brackets is a qualifier, not a unit: "force (calibrated)" stays one name', () => {
    for (const h of ['force (calibrated)', 'T (max)', 'signal (raw)', 'mass (corrected)'])
      expect(splitNameUnit(h)).toEqual({ name: h, unit: null })
    // So it no longer collides with a "force" column next to it (no "force (2)").
    const l = detect('force,force (calibrated)\n1,1.1\n2,2.2\n')
    expect(l.names).toEqual(['force', 'force (calibrated)'])
    expect(l.units).toEqual([null, null])
    expect(codes(l)).not.toContain('I_DUPLICATE_HEADER_RENAMED')
  })

  it('a number in round brackets is a run or a trial, not a unit: the names stay apart', () => {
    for (const h of ['Voltage (trial 1)', 'y (run 2)', 'Measurement (2)', 'force (calibrated 2)'])
      expect(splitNameUnit(h)).toEqual({ name: h, unit: null })
    const l = detect('Voltage (trial 1),Voltage (trial 2)\n1,1.1\n2,2.2\n')
    expect(l.names).toEqual(['Voltage (trial 1)', 'Voltage (trial 2)'])
    expect(codes(l)).not.toContain('I_DUPLICATE_HEADER_RENAMED')
  })

  it('"Width mm" and "Amps mA" stay names: no unit is split off a plain space', () => {
    expect(splitNameUnit('Width mm')).toEqual({ name: 'Width mm', unit: null })
    expect(splitNameUnit('Width  mm')).toEqual({ name: 'Width  mm', unit: null })
    expect(splitNameUnit('Amps mA')).toEqual({ name: 'Amps mA', unit: null })
  })
})

describe('cell heuristics', () => {
  it('looseNumericLike accepts every decimal convention and unit tails, not dates or labels', () => {
    for (const s of ['1', '-0,5', '1.234,5', '1 234,5', '3.0e+08 m/s', '12%', '−3,2', '.5', '2,5 °C']) {
      expect([s, looseNumericLike(s)]).toEqual([s, true])
    }
    for (const s of ['', 'abc', '2024-10-14', '12:30', 'A1', 'x (m)', 'n/a']) {
      expect([s, looseNumericLike(s)]).toEqual([s, false])
    }
  })

  it('looksLikeUnit', () => {
    for (const s of [
      's',
      'm',
      'm/s',
      'mg/L',
      '°C',
      'AU',
      'a.u.',
      '%',
      'kg·m⁻³',
      'm s^-1',
      '1/K',
      'µS/cm',
      'counts',
    ]) {
      expect([s, looksLikeUnit(s)]).toEqual([s, true])
    }
    for (const s of ['', '1.5', 'a,b', 'a very long sentence that is no unit at all']) {
      expect([s, looksLikeUnit(s)]).toEqual([s, false])
    }
  })

  it('looksLikeUnit wants unit symbols, SI prefixes, exponents or known unit words', () => {
    for (const s of ['mm', 'mA', 'kPa', 'hPa', 'N/m2', 'J/s', 'mm H2O', 'kg/m3', 'm^2', 's-1', 'deg', 'rpm'])
      expect([s, looksLikeUnit(s)]).toEqual([s, true])
    for (const s of ['watts', 'in', 'ppm', 'Hz', 'µm', 'mol/L', 'Ω', 'kΩ', '‰', 'gradi'])
      expect([s, looksLikeUnit(s)]).toEqual([s, true])
    // Words that only sit in brackets, and names: never units.
    for (const s of ['calibrated', 'max', 'raw', 'position', 'area', 'Width mm', 'Amps mA', 'Sample A'])
      expect([s, looksLikeUnit(s)]).toEqual([s, false])
  })

  it('a row of variable names under a title is the header, not a units row', () => {
    // "position | Width mm | Amps mA | area" could pass for units under the title "oak | plank 1".
    const l = detect('oak,plank 1,,\nposition,Width mm,Amps mA,area\n5,48,1.2,960\n10,46,1.4,1012\n')
    expect(l.layout.unitsRow).toBeNull()
    expect(l.names).toEqual(['position', 'Width mm', 'Amps mA', 'area'])
  })
})

describe('detectLayout', () => {
  it('textual header over numeric data → header (high), names and units split', () => {
    const l = detect('I (A),V (V)\n0.010,0.464\n0.020,0.941\n')
    expect(l.layout).toEqual({ headerRow: 0, unitsRow: null, dataStartRow: 1, dataEndRow: 2 })
    expect(l.names).toEqual(['I', 'V'])
    expect(l.units).toEqual(['A', 'V'])
    expect(l.unitSources).toEqual(['header', 'header'])
    expect(l.headerConfidence).toBe('high')
    expect(l.issues).toEqual([])
  })

  it('numeric first row → no header, generated names', () => {
    const g = fixtureGrid('headerless-comma-decimal.csv')
    const l = detectLayout(g.rows)
    expect(l.layout).toEqual({ headerRow: null, unitsRow: null, dataStartRow: 0, dataEndRow: 5 })
    expect(l.names).toEqual(['Column 1', 'Column 2'])
    expect(l.units).toEqual([null, null])
    expect(l.headerConfidence).toBe('high')
    expect(l.issues).toEqual([])
  })

  it('all-text table → first row assumed header but W_HEADER_UNCERTAIN (low)', () => {
    const l = detect('apple,red\npear,green\nplum,purple\n')
    expect(l.layout.headerRow).toBe(0)
    expect(l.headerConfidence).toBe('low')
    expect(l.issues).toEqual([
      expect.objectContaining({ code: 'W_HEADER_UNCERTAIN', params: { row: 1 }, rows: [0] }),
    ])
  })

  it('categorical and identifier columns next to numeric ones (pendulum example)', () => {
    const l = detect(readFileSync(resolve('src/examples/pendulum.csv'), 'utf8'))
    expect(l.layout.headerRow).toBe(0)
    expect(l.names).toEqual(['trial', 'observer', 'T'])
    expect(l.units).toEqual([null, null, 's'])
    expect(l.headerConfidence).toBe('high')
  })

  it('units row under the header → I_UNITS_ROW, units taken from it', () => {
    const g = fixtureGrid('units-row.csv')
    const l = detectLayout(g.rows, { sourceRow: g.sourceRow })
    expect(l.layout).toEqual({ headerRow: 0, unitsRow: 1, dataStartRow: 2, dataEndRow: 6 })
    expect(l.names).toEqual(['time', 'position', 'velocity'])
    expect(l.units).toEqual(['s', 'm', 'm/s'])
    expect(l.unitSources).toEqual(['unitsRow', 'unitsRow', 'unitsRow'])
    expect(codes(l)).toEqual(['I_UNITS_ROW'])
    expect(l.issues[0]!.params).toEqual({ row: 2 })
  })

  it('bracketed units in a units row, and the header unit wins over the units row', () => {
    const l = detect('t,x (cm),label\n(s),[m],-\n0,1,a\n1,2,b\n')
    expect(l.layout.unitsRow).toBe(1)
    expect(l.units).toEqual(['s', 'cm', null])
    expect(l.unitSources).toEqual(['unitsRow', 'header', null])
  })

  it('a first data row with missing values is not a units row', () => {
    const l = detect('t,x\nNA,NA\n1,2\n2,4\n')
    expect(l.layout.unitsRow).toBeNull()
    expect(l.layout.dataStartRow).toBe(1)
  })

  it('12 preamble lines → notes + I_PREAMBLE_KEPT, header after them', () => {
    const g = fixtureGrid('preamble-12.csv')
    const l = detectLayout(g.rows, { sourceRow: g.sourceRow })
    expect(l.layout).toEqual({ headerRow: 12, unitsRow: null, dataStartRow: 13, dataEndRow: 27 })
    expect(l.notes.length).toBe(12)
    expect(l.notes[0]).toBe('Instrument: Vernier LabQuest 2')
    expect(l.notes[5]).toBe('Room temperature: 22.0 °C')
    expect(l.names).toEqual(['t', 'x', 'v'])
    expect(l.units).toEqual(['s', 'm', 'm/s'])
    expect(codes(l)).toEqual(['I_PREAMBLE_KEPT'])
    expect(l.issues[0]!.params).toEqual({ count: 12 })
    expect(l.issues[0]!.rows).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
  })

  it('key/value preamble with the same delimiter and fewer filled cells', () => {
    const text =
      'Strumento;Pasco 850;\nData;14/10/2026;\nt (s);x (m);v (m/s)\n0;0,00;0,0\n1;0,50;1,0\n2;2,00;2,0\n'
    const l = detect(text)
    expect(l.layout.headerRow).toBe(2)
    expect(l.notes).toEqual(['Strumento | Pasco 850', 'Data | 14/10/2026'])
  })

  it('pandas-style header with an empty first cell is still the header', () => {
    const l = detect(',x,y\n0,1.5,2.5\n1,3.5,4.5\n2,5.5,6.5\n')
    expect(l.layout.headerRow).toBe(0)
    expect(l.names).toEqual(['Column 1', 'x', 'y'])
    expect(codes(l)).toEqual(['I_EMPTY_HEADER_NAMED'])
  })

  it('duplicate names get " (2)", empty ones "Column n"', () => {
    const l = detect('x,x,,x\n1,2,3,4\n5,6,7,8\n')
    expect(l.names).toEqual(['x', 'x (2)', 'Column 3', 'x (3)'])
    expect(codes(l).sort()).toEqual(['I_DUPLICATE_HEADER_RENAMED', 'I_EMPTY_HEADER_NAMED'])
    expect(l.issues.find((i) => i.code === 'I_DUPLICATE_HEADER_RENAMED')!.params).toEqual({ count: 2 })
  })

  it('names that collide after splitting the unit are deduplicated', () => {
    const l = detect('T (s),T (K)\n1,300\n2,301\n')
    expect(l.names).toEqual(['T', 'T (2)'])
    expect(l.units).toEqual(['s', 'K'])
  })

  it('ragged fixture: the extra column has no header name', () => {
    const g = fixtureGrid('ragged.csv')
    const l = detectLayout(g.rows)
    expect(l.layout).toEqual({ headerRow: 0, unitsRow: null, dataStartRow: 1, dataEndRow: 5 })
    expect(l.names).toEqual(['x', 'y', 'z', 'Column 4'])
    expect(l.used).toEqual([true, true, true, true])
    expect(codes(l)).toEqual(['I_EMPTY_HEADER_NAMED'])
  })

  it('an all-empty column (trailing delimiter) is not in use → I_TRIMMED_EMPTY', () => {
    const l = detect('a;b;\n1;2;\n3;4;\n')
    expect(l.used).toEqual([true, true, false])
    expect(codes(l)).toEqual(['I_TRIMMED_EMPTY'])
  })

  it('sep line is skipped: neither header nor note', () => {
    const g = fixtureGrid('sep-line.csv')
    const l = detectLayout(g.rows, { sepLineRow: g.sepLineRow })
    expect(l.layout).toEqual({ headerRow: 1, unitsRow: null, dataStartRow: 2, dataEndRow: 5 })
    expect(l.notes).toEqual([])
    expect(l.names).toEqual(['x', 'y'])
    expect(l.issues).toEqual([])
  })

  it('blank rows inside the data block are found, trailing ones are outside the data', () => {
    const g = fixtureGrid('blank-lines.csv')
    const l = detectLayout(g.rows)
    expect(l.layout).toEqual({ headerRow: 0, unitsRow: null, dataStartRow: 1, dataEndRow: 8 })
    expect(blankDataRows(g.rows, l.layout)).toEqual([3, 6])
    const t = detectLayout(gridOf('x,y\n1,2\n\n\n').rows)
    expect(t.layout.dataEndRow).toBe(1)
  })

  it('header only → data range is empty', () => {
    const l = detect('x,y\n')
    expect(l.layout.headerRow).toBe(0)
    expect(l.layout.dataStartRow).toBeGreaterThan(l.layout.dataEndRow)
  })

  it('uses the provided classifiers', () => {
    // A classifier that knows nothing is numeric makes every table "all text".
    const l = detect('x,y\n1,2\n3,4\n', { isNumericLike: () => false })
    expect(l.headerConfidence).toBe('low')
  })

  it('overrides: header, units row, data start (no warnings for the user’s own choices)', () => {
    const noHeader = detect('apple,red\npear,green\n', { headerRow: null })
    expect(noHeader.layout).toEqual({ headerRow: null, unitsRow: null, dataStartRow: 0, dataEndRow: 1 })
    expect(noHeader.names).toEqual(['Column 1', 'Column 2'])
    expect(noHeader.issues).toEqual([])

    const header = detect('1;2\n3;4\n5;6\n', { headerRow: 0 })
    expect(header.layout).toEqual({ headerRow: 0, unitsRow: null, dataStartRow: 1, dataEndRow: 2 })
    expect(header.names).toEqual(['1', '2'])

    const units = detect('time,position\ns,m\n0,1\n', { unitsRow: null })
    expect(units.layout.unitsRow).toBeNull()
    expect(units.layout.dataStartRow).toBe(1)

    const start = detect('x,y\n1,2\n3,4\n5,6\n', { dataStartRow: 2 })
    expect(start.layout).toEqual({ headerRow: 0, unitsRow: null, dataStartRow: 2, dataEndRow: 3 })

    expect(() => detect('x\n1\n', { headerRow: 99 })).toThrow(RangeError)
  })

  it('empty grid', () => {
    const l = detectLayout([])
    expect(l.layout.dataEndRow).toBe(-1)
    expect(l.names).toEqual([])
  })
})

describe('detectLayout — the table is found from its data, never by counting filled cells', () => {
  it('a remarks column filled only in later rows does not push the header and data into the notes', () => {
    const l = detect(
      't (s),V (V)\n0,1.0\n1,1.9\n2,3.1\n3,4.0,check\n4,5.1,check\n5,6.0,recal\n6,7.1,ok\n7,8.0,ok\n',
    )
    expect(l.layout).toEqual({ headerRow: 0, unitsRow: null, dataStartRow: 1, dataEndRow: 8 })
    expect(l.notes).toEqual([])
    expect(l.units).toEqual(['s', 'V', null])
    expect(l.headerConfidence).toBe('high')
  })

  it('a header with unnamed columns is still the header', () => {
    const l = detect('Time,V,,\n0,1,0.1,a\n1,2,0.1,b\n2,3,0.2,c\n')
    expect(l.layout.headerRow).toBe(0)
    expect(l.names).toEqual(['Time', 'V', 'Column 3', 'Column 4'])
    expect(codes(l)).toEqual(['I_EMPTY_HEADER_NAMED'])
  })

  it('a headerless first data row with an empty cell is data', () => {
    const l = detect('0,1.2,\n1,1.5,0.1\n2,1.8,0.1\n3,2.1,0.1\n')
    expect(l.layout).toEqual({ headerRow: null, unitsRow: null, dataStartRow: 0, dataEndRow: 3 })
    expect(l.notes).toEqual([])
    expect(l.issues).toEqual([])
  })

  it('a title or key/value lines with the delimiter are notes; the closest text row above the data is the header', () => {
    const t = detect('Pendulum experiment, group 3\nTime (s),Angle (deg)\n0,10.1\n1,9.8\n2,9.5\n')
    expect(t.layout.headerRow).toBe(1)
    expect(t.notes).toEqual(['Pendulum experiment | group 3'])
    expect(t.units).toEqual(['s', 'deg'])
    expect(codes(t)).toEqual(['I_PREAMBLE_KEPT'])
    const kv = detect('Operator,Mario Rossi\nDate,2024-03-15\nTime (s),Voltage (V)\n0,1.21\n1,1.35\n')
    expect(kv.layout.headerRow).toBe(2)
    expect(kv.headerConfidence).toBe('high')
    const blank = detect(
      'Strumento;Termometro XYZ\nData;15/03/2024\n\nTempo (s);Temperatura (°C)\n0;20,5\n30;21,7\n',
    )
    expect(blank.layout).toEqual({ headerRow: 3, unitsRow: null, dataStartRow: 4, dataEndRow: 5 })
    expect(blank.notes).toEqual(['Strumento | Termometro XYZ', 'Data | 15/03/2024'])
  })

  it('a title above the header of a one-column file is a note', () => {
    const l = detect('Experiment: pendulum\nPeriod (s)\n1.425\n')
    expect(l.layout).toEqual({ headerRow: 1, unitsRow: null, dataStartRow: 2, dataEndRow: 2 })
    expect(l.notes).toEqual(['Experiment: pendulum'])
  })

  it('a first data row with a flag ("A,BDL", "1,ERR") is data: not a units row, not a header', () => {
    const bdl = detect('Sample,Conc (mg/L)\nA,BDL\nB,0.52\nC,0.71\nD,0.93\n')
    expect(bdl.layout).toEqual({ headerRow: 0, unitsRow: null, dataStartRow: 1, dataEndRow: 4 })
    expect(bdl.units).toEqual([null, 'mg/L'])
    expect(bdl.issues).toEqual([])
    const err = detect('t,V\n1,ERR\n2,3.1\n3,4.2\n')
    expect(err.layout).toMatchObject({ headerRow: 0, dataStartRow: 1 })
    expect(err.headerConfidence).toBe('high')
    // A real units row is still found, with a placeholder for the label column.
    const units = detect('Sample,Conc\n-,mg/L\nA,0.5\nB,0.7\nC,0.9\n')
    expect(units.layout).toMatchObject({ headerRow: 0, unitsRow: 1, dataStartRow: 2 })
    expect(units.units).toEqual([null, 'mg/L'])
  })

  it('isFlagCell: detection-limit and overload flags, censored values', () => {
    for (const s of ['BDL', 'bdl', '<LOD', 'LOQ', 'ERR', 'OVER', '<0.5', '> 1000', '< LOD'])
      expect([s, isFlagCell(s)]).toEqual([s, true])
    for (const s of ['V', 'Error', 'mg/L', '0.5', 'Sample']) expect([s, isFlagCell(s)]).toEqual([s, false])
  })

  it('header cells with a letter tail ("1st", "2Theta") are names when the body has no such tail', () => {
    const a = detect('Trial,1st,2nd,3rd\n1,1.42,1.45,1.43\n2,1.40,1.44,1.41\n3,1.43,1.42,1.44\n')
    expect(a.layout.headerRow).toBe(0)
    expect(a.names).toEqual(['Trial', '1st', '2nd', '3rd'])
    expect(a.headerConfidence).toBe('high')
    const b = detect('2Theta,Intensity\n10.0,123\n10.5,130\n11.0,180\n')
    expect(b.names).toEqual(['2Theta', 'Intensity'])
    // Unit tails that the body shares are numbers ("12 mV" over "15 mV").
    const c = detect('12 mV,1\n15 mV,2\n18 mV,3\n')
    expect(c.layout.headerRow).toBeNull()
  })

  it('a key/value line right under the header is kept as data with W_HEADER_UNCERTAIN', () => {
    const l = detect('x,y\nSample rate,1000\n0,1\n1,2\n2,3\n')
    expect(l.layout).toEqual({ headerRow: 0, unitsRow: null, dataStartRow: 1, dataEndRow: 4 })
    expect(codes(l)).toEqual(['W_HEADER_UNCERTAIN'])
    // A stray word between data rows is not a header question.
    const s = detect('x,y\n1,2\n2,n/r\n3,4\n4,5\n')
    expect(s.layout).toMatchObject({ headerRow: 0, dataStartRow: 1 })
    expect(s.issues).toEqual([])
  })

  it('a numeric row above the header is a note but flagged (W_HEADER_UNCERTAIN), never dropped silently', () => {
    const l = detect('14,10,2024\nTime,V,I\n0,1,2\n1,2,3\n2,3,4\n')
    expect(l.layout.headerRow).toBe(1)
    expect(l.notes).toEqual(['14 | 10 | 2024'])
    expect(codes(l)).toEqual(['W_HEADER_UNCERTAIN', 'I_PREAMBLE_KEPT'])
    expect(l.issues[0]!.params).toEqual({ row: 2 })
  })

  it('a merged title copied across a sheet row is not taken as the header', () => {
    const rows = [
      ['Experiment 3', 'Experiment 3', 'Experiment 3'],
      ['t (s)', 'T1 (°C)', 'T2 (°C)'],
      ['0', '80', '81'],
      ['60', '71', '72'],
    ]
    const l = detectLayout(rows)
    expect(l.layout.headerRow).toBe(1)
    expect(l.units).toEqual(['s', '°C', '°C'])
  })

  it('columnUnit: the header unit wins, then the units-row cell; "-" is dimensionless', () => {
    expect(columnUnit('V (mV)', 'V')).toEqual({ unit: 'mV', source: 'header' })
    expect(columnUnit('V', '[mV]')).toEqual({ unit: 'mV', source: 'unitsRow' })
    expect(columnUnit('n', '-')).toEqual({ unit: null, source: null })
    expect(columnUnit(null, null)).toEqual({ unit: null, source: null })
  })
})
