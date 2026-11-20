import { describe, expect, it } from 'vitest'
import { withScheme } from './hire'

describe('withScheme', () => {
  it('adds https:// to a bare domain or path', () => {
    expect(withScheme('dr-kana.com')).toBe('https://dr-kana.com')
    expect(withScheme(' dr-kana.com/cv.pdf ')).toBe('https://dr-kana.com/cv.pdf')
    expect(withScheme('//dr-kana.com')).toBe('https://dr-kana.com')
  })
  it('keeps full http(s) URLs', () => {
    expect(withScheme('https://dr-kana.com')).toBe('https://dr-kana.com')
    expect(withScheme('HTTP://example.com/x')).toBe('HTTP://example.com/x')
  })
  it('treats empty as unset', () => {
    expect(withScheme('')).toBeUndefined()
    expect(withScheme('  ')).toBeUndefined()
    expect(withScheme(undefined)).toBeUndefined()
  })
})
