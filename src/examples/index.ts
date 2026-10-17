import type { ExampleId } from '@/domain/model'
import freeFall from './freeFall.csv?raw'
import ohm from './ohm.csv?raw'
import cooling from './cooling.csv?raw'
import beerLambert from './beerLambert.csv?raw'
import pendulum from './pendulum.csv?raw'

/**
 * Bundled example datasets: simulated measurements with fixed values. Reference
 * results for tests are produced independently by scripts/oracle/reference_values.py.
 */
export interface ExampleEntry {
  id: ExampleId
  fileName: string
  csv: string
  /** Walkthrough available for this example. */
  walkthrough: 'ohm' | 'freeFall' | null
}

export const EXAMPLES: readonly ExampleEntry[] = [
  { id: 'ohm', fileName: 'ohm.csv', csv: ohm, walkthrough: 'ohm' },
  { id: 'free-fall', fileName: 'freeFall.csv', csv: freeFall, walkthrough: 'freeFall' },
  { id: 'cooling', fileName: 'cooling.csv', csv: cooling, walkthrough: null },
  { id: 'beer-lambert', fileName: 'beerLambert.csv', csv: beerLambert, walkthrough: null },
  { id: 'pendulum', fileName: 'pendulum.csv', csv: pendulum, walkthrough: null },
]
