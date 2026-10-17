import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { APP_VERSION } from './project'

describe('APP_VERSION', () => {
  it('is the version in package.json, so a release changes it in one place', () => {
    const { version } = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string }
    expect(APP_VERSION).toBe(version)
    expect(APP_VERSION).toBe(__APP_VERSION__)
  })
})
