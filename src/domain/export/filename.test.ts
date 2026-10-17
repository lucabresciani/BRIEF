import { describe, it, expect } from 'vitest'
import { figureFileBase, safeFileName } from './filename'

const SAFE = /^[A-Za-z0-9._-]+$/

describe('safeFileName', () => {
  it('turns a project name into an ASCII slug with the extension', () => {
    expect(safeFileName("Ohm's law — R1", 'sciplot')).toBe('Ohm-s-law-R1.sciplot')
    expect(safeFileName('Caduta libera: 2° prova (è già)', 'csv')).toBe('Caduta-libera-2deg-prova-e-gia.csv')
    expect(safeFileName('Resistenza 47 Ω, I in µA', 'png')).toBe('Resistenza-47-Ohm-I-in-uA.png')
    expect(safeFileName('Straße Œuvre Łódź', 'svg')).toBe('Strasse-OEuvre-Lodz.svg')
    expect(safeFileName('data_v2.1', '.csv')).toBe('data_v2.1.csv')
  })

  it('never returns an empty name', () => {
    expect(safeFileName('', 'sciplot')).toBe('project.sciplot')
    expect(safeFileName('!!!', 'sciplot')).toBe('project.sciplot')
    expect(safeFileName('数据', 'csv')).toBe('project.csv')
    expect(safeFileName('...', '')).toBe('project')
  })

  it('removes path separators, characters Windows forbids and leading dots', () => {
    expect(safeFileName('../../etc/passwd', 'csv')).toBe('etc-passwd.csv')
    expect(safeFileName('a<b>c:d"e/f\\g|h?i*j', 'csv')).toBe('a-b-c-d-e-f-g-h-i-j.csv')
    expect(safeFileName('.env', 'txt')).toBe('env.txt')
    expect(safeFileName('trailing dot.', 'csv')).toBe('trailing-dot.csv')
  })

  it('avoids Windows device names', () => {
    expect(safeFileName('CON', 'csv')).toBe('CON_.csv')
    expect(safeFileName('nul', '')).toBe('nul_')
    expect(safeFileName('com1.backup', 'csv')).toBe('com1_.backup.csv')
    expect(safeFileName('console', 'csv')).toBe('console.csv')
  })

  it('caps the whole name at 80 characters without a dangling separator', () => {
    const long = 'Misura '.repeat(40)
    const out = safeFileName(long, 'sciplot')
    expect(out.length).toBeLessThanOrEqual(80)
    expect(out.endsWith('.sciplot')).toBe(true)
    expect(out).not.toMatch(/[-._]\.sciplot$/)
  })

  it('always produces a safe name, whatever the input', () => {
    const pieces = [
      'a',
      'Z',
      '9',
      ' ',
      '.',
      '-',
      '_',
      '/',
      '\\',
      'é',
      'Ω',
      '😀',
      '\n',
      '\t',
      String.fromCharCode(0),
      '..',
      '数',
      'ﬁ',
    ]
    let seed = 7
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    for (let i = 0; i < 500; i++) {
      let name = ''
      for (let k = Math.floor(random() * 120); k > 0; k--)
        name += pieces[Math.floor(random() * pieces.length)]
      const out = safeFileName(name, 'csv')
      expect(out, JSON.stringify(name)).toMatch(SAFE)
      expect(out.length).toBeLessThanOrEqual(80)
      expect(out.endsWith('.csv')).toBe(true)
      expect(out.startsWith('.')).toBe(false)
    }
  })
})

describe('figureFileBase', () => {
  it('names the figure after the project (or dataset) and the plot', () => {
    expect(figureFileBase('Ohm lab', 'V vs I')).toBe('Ohm lab – V vs I')
    expect(safeFileName(figureFileBase('Ohm lab', 'V vs I'), 'png')).toBe('Ohm-lab-V-vs-I.png')
    expect(safeFileName(figureFileBase('Pendolo', 'Grafico 2'), 'svg')).toBe('Pendolo-Grafico-2.svg')
  })

  it('uses one part alone when the other is empty or the same', () => {
    expect(figureFileBase('  ', 'V vs I')).toBe('V vs I')
    expect(figureFileBase('Ohm lab', '')).toBe('Ohm lab')
    expect(figureFileBase('pendulum', ' pendulum ')).toBe('pendulum')
    expect(figureFileBase('', '')).toBe('figure')
  })
})
