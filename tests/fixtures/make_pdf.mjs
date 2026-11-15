// Builds tests/fixtures/sample.pdf: page 1 has a real text layer (Chrome
// print-to-PDF of html/mixed.html), pages 2-3 are scans (PNG images only).
// Run: node tests/fixtures/make_pdf.mjs   (after printing _text_page.pdf, see README)
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { PDFDocument } from 'pdf-lib'

const dir = import.meta.dirname
import { existsSync } from 'node:fs'
const textPage = path.join(dir, 'html', '_text_page.pdf')
if (existsSync(textPage)) {
  const out = await PDFDocument.create()
  const text = await PDFDocument.load(readFileSync(textPage))
  const [p1] = await out.copyPages(text, [0])
  out.addPage(p1)
  for (const name of ['th_doc.png', 'two_col.png']) {
    const img = await out.embedPng(readFileSync(path.join(dir, name)))
    const w = 595
    const h = (img.height / img.width) * w
    out.addPage([w, h]).drawImage(img, { x: 0, y: 0, width: w, height: h })
  }
  writeFileSync(path.join(dir, 'sample.pdf'), await out.save())
  console.log('wrote sample.pdf with', out.getPageCount(), 'pages')
}

// Batch fixture folder for the multi-file tests: two scanned PDFs in a subfolder
// (named to check natural sorting), an image, and a file that must be skipped.
import { copyFileSync, mkdirSync } from 'node:fs'
const batch = path.join(dir, 'batch')
mkdirSync(path.join(batch, 'reports'), { recursive: true })
for (const [name, png] of [['scan-2.pdf', 'th_doc.png'], ['scan-10.pdf', 'dark.png']]) {
  const doc = await PDFDocument.create()
  const img = await doc.embedPng(readFileSync(path.join(dir, png)))
  const w = 595
  const h = (img.height / img.width) * w
  doc.addPage([w, h]).drawImage(img, { x: 0, y: 0, width: w, height: h })
  writeFileSync(path.join(batch, 'reports', name), await doc.save())
}
copyFileSync(path.join(dir, 'line_crop.png'), path.join(batch, 'title.png'))
writeFileSync(path.join(batch, 'notes.txt'), 'not an image\n')
console.log('wrote batch/ fixtures')
