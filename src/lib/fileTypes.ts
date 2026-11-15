// Small, dependency-free helpers for incoming files and output names, kept
// separate so the landing page doesn't pull in pdf.js (and so they're testable).

const SUPPORTED = /\.(pdf|png|jpe?g|webp|bmp|gif|tiff?)$/i

export function isSupported(file: { name: string; type: string }): boolean {
  return file.type === 'application/pdf' || file.type.startsWith('image/') || SUPPORTED.test(file.name)
}

export const isPdf = (file: { name: string; type: string }) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name)

/** Relative path of a dropped or folder-picked file ("reports/a.pdf"), else its name. */
export function relativePath(file: File): string {
  // react-dropzone sets `path` (sometimes with a leading "./" or "/"); folder pickers set webkitRelativePath.
  const p = (file as File & { path?: string }).path || file.webkitRelativePath || file.name
  return p.replace(/^\.?\//, '')
}

/** Dotfiles and OS clutter in any path segment (.DS_Store, __MACOSX/...). */
export const isHidden = (path: string) => path.split('/').some((seg) => seg.startsWith('.') || seg === '__MACOSX' || seg === 'Thumbs.db')

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
/** Natural order: "page2" before "page10". */
export const naturalCompare = (a: string, b: string) => collator.compare(a, b)

export const dirname = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')
export const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1)

/** Split incoming files into supported ones (deduped against `existing` keys) and skipped ones. */
export function triageFiles(files: File[], existing: Set<string>): { accepted: { file: File; path: string }[]; skipped: number; duplicates: number } {
  const accepted: { file: File; path: string }[] = []
  let skipped = 0
  let duplicates = 0
  const seen = new Set(existing)
  for (const file of files) {
    const path = relativePath(file)
    if (isHidden(path)) continue // silently: nobody meant to OCR .DS_Store
    if (!isSupported(file)) {
      skipped++
      continue
    }
    const key = fileKey(file, path)
    if (seen.has(key)) {
      duplicates++
      continue
    }
    seen.add(key)
    accepted.push({ file, path })
  }
  accepted.sort((a, b) => naturalCompare(a.path, b.path))
  return { accepted, skipped, duplicates }
}

export const fileKey = (file: { size: number; lastModified: number }, path: string) => `${path}\u0000${file.size}\u0000${file.lastModified}`

/**
 * Output path inside an export ZIP: the source path with its extension replaced
 * by `suffix` ("reports/a.pdf" + "-searchable.pdf" -> "reports/a-searchable.pdf"),
 * made unique against `used` with " (2)", " (3)", ...
 */
export function zipPath(sourcePath: string, suffix: string, used: Set<string>): string {
  const stem = safeZipPath(sourcePath).replace(/\.[^./]+$/, '') || 'document'
  let candidate = `${stem}${suffix}`
  for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${stem} (${n})${suffix}`
  used.add(candidate.toLowerCase())
  return candidate
}

/**
 * A path that is safe as a ZIP entry name: forward slashes only, no empty,
 * "." or ".." segments, no drive letters or control characters, so extracting
 * the archive can never write outside its folder ("zip slip").
 */
export function safeZipPath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .split('/')
    // Control characters are exactly what this strips.
    // eslint-disable-next-line no-control-regex
    .map((seg) => seg.replace(/[\u0000-\u001f\u007f]/g, '').replace(/^[A-Za-z]:$/, '').trim())
    .filter((seg) => seg && seg !== '.' && seg !== '..')
    .join('/')
}

/** ZIP name: the common top folder of the inputs when there is one. */
export function zipName(paths: string[]): string {
  const tops = new Set(paths.map((p) => (p.includes('/') ? p.split('/')[0] : '')))
  const [only] = [...tops]
  const safe = only ? safeZipPath(only).replace(/\//g, '') : ''
  return tops.size === 1 && safe ? `${safe}-freethaiocr.zip` : 'freethaiocr-export.zip'
}
