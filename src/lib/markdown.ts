// Plain text from a document-mode page's Markdown (headings, <figure> markers and HTML tables),
// for TXT export and "copy all text": tables become tab-separated rows.

const unescape = (s: string) => s.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')

export function markdownToText(md: string): string {
  const out: string[] = []
  let row: string[] | null = null
  for (const raw of md.split('\n')) {
    const line = raw.trim()
    if (/^<\/?table\b/i.test(line) || /^<\/?figure\b/i.test(line)) continue
    if (/^<tr\b/i.test(line)) {
      row = []
      continue
    }
    if (/^<\/tr>/i.test(line)) {
      if (row) out.push(row.join('\t'))
      row = null
      continue
    }
    const cell = /^<t[dh]\b[^>]*>(.*)<\/t[dh]>$/is.exec(line)
    if (cell && row) {
      row.push(unescape(cell[1]))
      continue
    }
    out.push(raw.replace(/^#{1,6}\s+/, ''))
  }
  return out.join('\n')
}
