import { describe, expect, it } from 'vitest'
import { visibleTabs } from './levels'

describe('progressive disclosure of the inspector tabs', () => {
  it('beginner sees plot, statistics and style only', () => {
    expect(visibleTabs('beginner', false)).toEqual(['plot', 'statistics', 'style'])
  })
  it('an existing fit keeps its tab visible at beginner level (changing level never hides an analysis)', () => {
    expect(visibleTabs('beginner', true)).toContain('fit')
  })
  it('intermediate and advanced add fit and uncertainty', () => {
    for (const level of ['intermediate', 'advanced'] as const) {
      expect(visibleTabs(level, false)).toEqual(['plot', 'fit', 'uncertainty', 'statistics', 'style'])
    }
  })
})
