// Readers for the vendored NIST StRD files (tests/fixtures/nist, CRLF, US-Government public data).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const dir = resolve(process.cwd(), 'tests/fixtures/nist')

function lines(name: string): string[] {
  return readFileSync(resolve(dir, `${name}.dat`), 'latin1')
    .replace(/\r/g, '')
    .split('\n')
}

function dataRange(ls: string[]): [number, number] {
  const header = ls.slice(0, 15).join('\n')
  const m = header.match(/Data\s*(?:\(lines|:\s*lines)\s+(\d+)\s+to\s+(\d+)/)
  if (!m) throw new Error('NIST data range not found')
  return [Number(m[1]), Number(m[2])]
}

/** NIST number token, e.g. "0.429796848199937E-03" or ".11019". */
const num = (s: string) => Number(s)

export interface NistLLS {
  name: string
  x: number[]
  y: number[]
  /** Certified estimates B0..Bk and their standard deviations. */
  coefficients: number[]
  se: number[]
  residualSD: number
  r2: number
}

/** Linear least squares datasets: data columns are "y x". */
export function readNistLLS(name: string): NistLLS {
  const ls = lines(name)
  const [a, b] = dataRange(ls)
  const x: number[] = []
  const y: number[] = []
  for (let i = a - 1; i <= b - 1; i++) {
    const parts = ls[i].trim().split(/\s+/)
    if (parts.length < 2) continue
    y.push(num(parts[0]))
    x.push(num(parts[1]))
  }
  const coefficients: number[] = []
  const se: number[] = []
  let residualSD = NaN
  let r2 = NaN
  for (const l of ls.slice(0, a - 1)) {
    const mB = l.match(/^\s*B(\d+)\s+(\S+)\s+(\S+)/)
    if (mB) {
      coefficients[Number(mB[1])] = num(mB[2])
      se[Number(mB[1])] = num(mB[3])
    }
    const mS = l.match(/Standard Deviation\s+(\S+)\s*$/)
    if (mS && /^\s*Standard Deviation/.test(l)) residualSD = num(mS[1])
    const mR = l.match(/R-Squared\s+(\S+)/)
    if (mR) r2 = num(mR[1])
  }
  return { name, x, y, coefficients, se, residualSD, r2 }
}

export interface NistUniv {
  name: string
  y: number[]
  mean: number
  sd: number
}

/** Univariate summary statistics datasets. */
export function readNistUniv(name: string): NistUniv {
  const ls = lines(name)
  const [a, b] = dataRange(ls)
  const y: number[] = []
  for (let i = a - 1; i <= b - 1; i++) {
    const t = ls[i].trim()
    if (t) y.push(num(t.split(/\s+/)[0]))
  }
  let mean = NaN
  let sd = NaN
  for (const l of ls.slice(0, a - 1)) {
    const mM = l.match(/Sample Mean\s+ybar:\s+(\S+)/)
    if (mM) mean = num(mM[1])
    const mS = l.match(/Sample Standard Deviation.*?s:\s+(\S+)/)
    if (mS) sd = num(mS[1])
  }
  return { name, y, mean, sd }
}

/** Log relative error (number of correct significant digits), capped at 15. */
export function lre(q: number, c: number): number {
  if (q === c) return 15
  const v = c === 0 ? -Math.log10(Math.abs(q)) : -Math.log10(Math.abs(q - c) / Math.abs(c))
  return Math.min(15, v)
}
