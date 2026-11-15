import { describe, expect, it } from 'vitest'
import { isHidden, naturalCompare, triageFiles, zipName, zipPath } from './fileTypes'

const file = (path: string, type = '', size = 1) => {
  const f = new File(['x'.repeat(size)], path.split('/').pop()!, { type, lastModified: 1 })
  Object.defineProperty(f, 'path', { value: path })
  return f
}

describe('fileTypes', () => {
  it('sorts naturally', () => {
    expect(['p10.pdf', 'p2.pdf', 'P1.pdf'].sort(naturalCompare)).toEqual(['P1.pdf', 'p2.pdf', 'p10.pdf'])
  })

  it('spots hidden files', () => {
    expect(isHidden('reports/.DS_Store')).toBe(true)
    expect(isHidden('__MACOSX/reports/a.pdf')).toBe(true)
    expect(isHidden('reports/a.pdf')).toBe(false)
  })

  it('triages: keeps supported, skips others, drops hidden and duplicates, natural order', () => {
    const files = [
      file('scans/p10.png', 'image/png'),
      file('scans/p2.png', 'image/png'),
      file('scans/notes.txt', 'text/plain'),
      file('scans/.DS_Store'),
      file('scans/a.pdf', 'application/pdf'),
      file('scans/a.pdf', 'application/pdf'), // same path, size, mtime
    ]
    const r = triageFiles(files, new Set())
    expect(r.accepted.map((a) => a.path)).toEqual(['scans/a.pdf', 'scans/p2.png', 'scans/p10.png'])
    expect(r.skipped).toBe(1)
    expect(r.duplicates).toBe(1)
  })

  it('strips a leading ./ or / from dropped paths', () => {
    const r = triageFiles([file('./x/a.pdf', 'application/pdf'), file('/y/b.png', 'image/png')], new Set())
    expect(r.accepted.map((a) => a.path)).toEqual(['x/a.pdf', 'y/b.png'])
  })

  it('makes unique ZIP paths', () => {
    const used = new Set<string>()
    expect(zipPath('reports/a.pdf', '-searchable.pdf', used)).toBe('reports/a-searchable.pdf')
    expect(zipPath('reports/a.png', '-searchable.pdf', used)).toBe('reports/a (2)-searchable.pdf')
    expect(zipPath('reports/A.pdf', '-searchable.pdf', used)).toBe('reports/A (3)-searchable.pdf')
    expect(zipPath('b.tar.gz', '.txt', used)).toBe('b.tar.txt')
  })

  it('never lets a ZIP entry escape its folder', () => {
    const used = new Set<string>()
    expect(zipPath('../../etc/passwd.pdf', '.txt', used)).toBe('etc/passwd.txt')
    expect(zipPath('C:\\Users\\x\\..\\a.pdf', '.txt', used)).toBe('Users/x/a.txt')
    expect(zipPath('./a/./b\u0000.pdf', '.txt', used)).toBe('a/b.txt')
    expect(zipName(['../x/a.pdf'])).toBe('freethaiocr-export.zip')
  })

  it('names the ZIP after a common folder', () => {
    expect(zipName(['reports/a.pdf', 'reports/sub/b.pdf'])).toBe('reports-freethaiocr.zip')
    expect(zipName(['a.pdf', 'reports/b.pdf'])).toBe('freethaiocr-export.zip')
    expect(zipName(['a.pdf'])).toBe('freethaiocr-export.zip')
  })
})
