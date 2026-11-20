import { describe, expect, it } from 'vitest'
import { confLevel, pct } from './confidence'

describe('confLevel', () => {
  it('splits at 95% and 80%', () => {
    expect(confLevel(1)).toBe('high')
    expect(confLevel(0.95)).toBe('high')
    expect(confLevel(0.9499)).toBe('mid')
    expect(confLevel(0.8)).toBe('mid')
    expect(confLevel(0.7999)).toBe('low')
    expect(confLevel(0)).toBe('low')
  })
  it('formats a percentage', () => {
    expect(pct(0.9876)).toBe('99%')
    expect(pct(0.5)).toBe('50%')
  })
})
