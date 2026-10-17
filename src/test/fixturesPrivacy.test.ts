import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import * as XLSX from 'xlsx'
import { afterEach, describe, expect, it } from 'vitest'

const SCRIPT = resolve('scripts/fixtures/check-fixtures.mjs')
const check = (dir?: string) => {
  const r = spawnSync(process.execPath, dir ? [SCRIPT, dir] : [SCRIPT], { encoding: 'utf8' })
  return { status: r.status, output: `${r.stdout}${r.stderr}` }
}

const book = (cell: string) => {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['note'], [cell]]), 'S')
  return wb
}

let dir: string | null = null
const scratch = () => (dir = mkdtempSync(join(tmpdir(), 'fixture-check-')))
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = null
})

describe('test fixtures carry no local paths or personal names', () => {
  it('every file in tests/fixtures passes the check', () => {
    const r = check()
    expect(r.output).toContain('ok: no personal or local traces')
    expect(r.status).toBe(0)
  })

  it('the check fails and names the file: a deflated workbook part, UTF-16 text, an author, a .xls user', () => {
    const d = scratch()
    const deflated = book('<x15ac:absPath url="D:\\Data\\"/>')
    writeFileSync(join(d, 'saved-path.xlsx'), XLSX.write(deflated, { type: 'buffer', compression: true }))
    const authored = book('x')
    authored.Props = { Author: 'A. Person' }
    writeFileSync(join(d, 'author.xlsx'), XLSX.write(authored, { type: 'buffer', compression: true }))
    writeFileSync(join(d, 'utf16.txt'), Buffer.from('path C:\\Users\\someone\\x.csv', 'utf16le'))
    writeFileSync(join(d, 'user.xls'), XLSX.write(book('x'), { type: 'buffer', bookType: 'biff8' }))
    writeFileSync(join(d, 'clean.csv'), 'x,y\n1,2\n')
    const r = check(d)
    expect(r.status).toBe(1)
    expect(r.output).toMatch(/saved-path\.xlsx › xl\/.+: contains "absPath"/)
    expect(r.output).toMatch(/author\.xlsx › docProps\/core\.xml: dc:creator is "A\. Person"/)
    expect(r.output).toMatch(/utf16\.txt: contains "Users\\"/)
    expect(r.output).toMatch(/user\.xls: WRITEACCESS user name is "\S+"/)
    expect(r.output).not.toContain('clean.csv')
  })

  it('the check also looks for the git name of whoever runs it (the machine a fixture is made on)', () => {
    const name = spawnSync('git', ['config', '--get', 'user.name'], { encoding: 'utf8' }).stdout?.trim() ?? ''
    if (name.length < 5) return // no git identity here (a CI runner): nothing to look for
    const d = scratch()
    writeFileSync(join(d, 'notes.txt'), `saved by ${name.toUpperCase()}`)
    const r = check(d)
    expect(r.status).toBe(1)
    expect(r.output).toContain(`notes.txt: contains "${name}"`)
  })

  it('also checks the user and printer names LibreOffice keeps in meta.xml', () => {
    const d = scratch()
    const meta = '<office:meta><meta:printed-by>A. Person</meta:printed-by></office:meta>'
    writeFileSync(join(d, 'meta.xml'), meta)
    const r = check(d)
    expect(r.status).toBe(1)
    expect(r.output).toContain('meta.xml: meta:printed-by is "A. Person"')
  })
})
