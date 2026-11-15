import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { canonical, fixScripts, invalidShare } from '../../src/ocr/thaiNorm'

const rows: { in: string; canonical: string; fixed: string; invalid: number }[] = JSON.parse(
  readFileSync(path.join(__dirname, 'goldens', 'thai_norm.json'), 'utf8'),
)

describe('thaiNorm matches the Python reference', () => {
  it('canonical()', () => {
    const bad = rows.filter((r) => canonical(r.in) !== r.canonical)
    expect(bad.map((r) => ({ in: r.in, want: r.canonical, got: canonical(r.in) }))).toEqual([])
  })
  it('fixScripts(canonical())', () => {
    const bad = rows.filter((r) => fixScripts(canonical(r.in)) !== r.fixed)
    expect(bad.map((r) => r.in)).toEqual([])
  })
  it('invalidShare()', () => {
    const bad = rows.filter((r) => Math.abs(invalidShare(r.in) - r.invalid) > 1e-12)
    expect(bad.map((r) => r.in)).toEqual([])
  })
})
