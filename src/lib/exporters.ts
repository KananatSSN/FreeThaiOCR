// Exports: plain text, Markdown, JSON (lines + boxes + confidence), and a searchable PDF
// (the original pages with an invisible, selectable text layer on top).
import fontkit from '@pdf-lib/fontkit'
import {
  beginText,
  endText,
  type PDFFont,
  PDFDocument,
  type PDFPage,
  popGraphicsState,
  pushGraphicsState,
  setCharacterSqueeze,
  setFontAndSize,
  setTextMatrix,
  setTextRenderingMode,
  showText,
  TextRenderingMode,
  PDFName,
} from 'pdf-lib'
import { Zip, ZipDeflate, ZipPassThrough } from 'fflate'
import i18n from '@/i18n'
import type { OcrLine } from '@/ocr/engine'
import { type FileEntry, getFile, type PageState, pageText, useApp } from '@/state/store'
import { type LoadedDoc, openDoc, pdfPointMapper } from './documents'
import { basename, zipName, zipPath } from './fileTypes'
import { markdownToText } from './markdown'
import { completeFiles } from './ocrService'

export type ExportKind = 'txt' | 'md' | 'json' | 'pdf'
const SUFFIX: Record<ExportKind, string> = { txt: '.txt', md: '.md', json: '.json', pdf: '-searchable.pdf' }

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** A page as plain text (user edits included): document-mode Markdown is flattened. */
export const plainText = (p: PageState) => (p.result?.markdown !== undefined ? markdownToText(pageText(p)) : pageText(p))

/** All page texts (user edits included), with page markers for multi-page files. */
export function allText(pages: PageState[]): string {
  if (pages.length === 1) return plainText(pages[0])
  return pages.map((p, i) => `--- ${i + 1} ---\n${plainText(p)}`).join('\n\n')
}

const buildTxt = (e: FileEntry) => new Blob([allText(e.pages)], { type: 'text/plain;charset=utf-8' })

/** Markdown: document-mode pages as read (or edited), other pages as paragraphs; pages split by rules. */
const buildMd = (e: FileEntry) => new Blob([e.pages.map((p) => pageText(p)).join('\n\n---\n\n') + '\n'], { type: 'text/markdown;charset=utf-8' })

const ENGINE_NAMES = { openthai: 'OpenThai2.1-OCR-Text-20261118', akson: 'AksonOCR-Lite (fp16)' } as const

function buildJson(e: FileEntry): Blob {
  const data = {
    file: e.path,
    generator: 'FreeThaiOCR',
    created: new Date().toISOString(),
    pages: e.pages.map((p, i) => ({
      page: i + 1,
      width: e.meta?.sizes[i].width,
      height: e.meta?.sizes[i].height,
      source: p.result?.source ?? null,
      engine: p.result?.engine ? ENGINE_NAMES[p.result.engine] : null,
      text: plainText(p),
      ...(p.result?.markdown !== undefined ? { markdown: pageText(p) } : {}),
      edited: p.edited !== undefined,
      lines: p.result?.lines.map(({ text, confidence, box, words }) => ({ text, confidence, box, words })) ?? [],
      regions: p.boxes.map((b) => ({
        n: b.n,
        rect: { x: b.x, y: b.y, w: b.w, h: b.h },
        text: b.edited ?? b.result?.text ?? '',
        lines: b.result?.lines.map(({ text, confidence, box }) => ({ text, confidence, box })) ?? [],
      })),
    })),
  }
  return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
}

async function build(e: FileEntry, kind: ExportKind): Promise<Blob> {
  if (kind === 'txt') return buildTxt(e)
  if (kind === 'md') return buildMd(e)
  if (kind === 'json') return buildJson(e)
  return buildSearchablePdf(e)
}

export type ExportOutcome = 'done' | 'cancelled'
const latest = (id: string) => getFile(useApp.getState(), id)

/** Export one file, OCRing any pages that have no text yet first. */
export async function exportFile(id: string, kind: ExportKind): Promise<ExportOutcome> {
  if (!(await completeFiles([id], 'export'))) return 'cancelled'
  const e = latest(id)
  if (!e) return 'cancelled'
  download(await build(e, kind), basename(zipPath(e.path, SUFFIX[kind], new Set())))
  return 'done'
}

/**
 * Export every file into one ZIP (one output per file, folder structure kept),
 * OCRing missing pages first. Outputs are built one file at a time, so only one
 * searchable PDF is ever being assembled in memory.
 */
export async function exportAll(kind: ExportKind): Promise<ExportOutcome> {
  const ids = useApp.getState().files.map((f) => f.id)
  if (!(await completeFiles(ids, 'export'))) return 'cancelled'
  const files = ids.map(latest).filter((f): f is FileEntry => !!f)
  const chunks: Uint8Array[] = []
  let zipError: Error | null = null
  const zip = new Zip((err, data) => {
    if (err) zipError = err
    else chunks.push(data)
  })
  const used = new Set<string>()
  const errors: string[] = []
  for (const e of files) {
    if (e.status !== 'ready') {
      errors.push(`${e.path}: ${e.error ?? 'could not be read'}`)
      continue
    }
    try {
      const data = new Uint8Array(await (await build(e, kind)).arrayBuffer())
      // PDFs are already compressed: store them; deflate text and JSON.
      const entry = kind === 'pdf' ? new ZipPassThrough(zipPath(e.path, SUFFIX[kind], used)) : new ZipDeflate(zipPath(e.path, SUFFIX[kind], used), { level: 6 })
      zip.add(entry)
      entry.push(data, true)
    } catch (err) {
      errors.push(`${e.path}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  if (errors.length) {
    const note = new ZipDeflate(zipPath('errors', '.txt', used))
    zip.add(note)
    note.push(new TextEncoder().encode(`These files were skipped:\n${errors.join('\n')}\n`), true)
  }
  zip.end()
  if (zipError) throw zipError
  download(new Blob(chunks as BlobPart[], { type: 'application/zip' }), zipName(files.map((f) => f.path)))
  return 'done'
}

let fontBytes: Promise<ArrayBuffer> | null = null
const loadFont = () =>
  (fontBytes ??= fetch(`${import.meta.env.BASE_URL}fonts/Sarabun-Regular.ttf`).then((r) => {
    if (!r.ok) throw new Error('Failed to load the PDF font')
    return r.arrayBuffer()
  }))

type Mapper = (x: number, y: number) => [number, number]

/**
 * Draw `text` invisibly so it covers the quad `box` (page pixels -> PDF points
 * via `map`): baseline along the box's bottom edge, squeezed to its width.
 */
function drawInvisible(page: PDFPage, font: PDFFont, fontKey: PDFName, text: string, box: [number, number][], map: Mapper) {
  const clean = [...text].filter((c) => font.getCharacterSet().includes(c.codePointAt(0)!) || c === ' ').join('')
  if (!clean.trim()) return
  const [tl, , br, bl] = box.map(([x, y]) => map(x, y))
  const width = Math.hypot(br[0] - bl[0], br[1] - bl[1])
  const height = Math.hypot(tl[0] - bl[0], tl[1] - bl[1])
  if (width < 1 || height < 1) return
  const size = height * 0.8
  const natural = font.widthOfTextAtSize(clean, size)
  if (natural <= 0) return
  const angle = Math.atan2(br[1] - bl[1], br[0] - bl[0])
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  // Baseline sits a little above the box bottom (descenders and below-marks).
  const lift = height * 0.2
  const ox = bl[0] - sin * lift
  const oy = bl[1] + cos * lift
  page.pushOperators(
    pushGraphicsState(),
    beginText(),
    setFontAndSize(fontKey, size),
    setTextRenderingMode(TextRenderingMode.Invisible),
    setCharacterSqueeze((width / natural) * 100),
    setTextMatrix(cos, sin, -sin, cos, ox, oy),
    showText(font.encodeText(clean)),
    endText(),
    popGraphicsState(),
  )
}

/** Lines to place on a page: OCR words where available (better selection), else lines. */
function segments(lines: OcrLine[]): { text: string; box: [number, number][] }[] {
  return lines.flatMap((l) => (l.words?.length ? l.words : [l]).map((w) => ({ text: w.text, box: w.box })))
}

async function buildSearchablePdf(e: FileEntry): Promise<Blob> {
  const doc = await openDoc(e)
  const pages = e.pages
  const out = doc.kind === 'pdf' ? await loadUnencrypted(e) : await PDFDocument.create()
  out.registerFontkit(fontkit)
  // The text layer is invisible, so shaping buys nothing, and it breaks extraction:
  // Thai GSUB rules swap tone marks for positional variants and split ำ into two
  // glyphs, which copy/search then read back wrongly. Map each character to its
  // plain glyph instead.
  const noShaping = Object.fromEntries(['ccmp', 'locl', 'liga', 'clig', 'calt', 'rlig', 'mark', 'mkmk', 'kern', 'rclt', 'abvs', 'blws', 'psts'].map((f) => [f, false]))
  const font = await out.embedFont(await loadFont(), { subset: false, features: noShaping })
  out.setProducer('FreeThaiOCR')

  for (let i = 0; i < pages.length; i++) {
    const p = pages[i]
    let page: PDFPage
    let map: Mapper
    if (doc.kind === 'pdf') {
      page = out.getPage(i)
      map = await pdfPointMapper(doc, i)
    } else {
      // An image becomes one page at 96 dpi (1 px = 0.75 pt), drawn full size.
      const { width, height } = e.meta!.sizes[0]
      const s = 0.75
      page = out.addPage([width * s, height * s])
      const img = await embedImage(out, doc)
      page.drawImage(img, { x: 0, y: 0, width: width * s, height: height * s })
      map = (x, y) => [x * s, (height - y) * s]
    }
    // Only OCR results need a text layer: a PDF's own text is already searchable.
    const r = p.result
    if (!r || r.source !== 'ocr') continue
    const fontKey = page.node.newFontDictionary(font.name, font.ref)
    if (p.edited !== undefined) {
      // The user corrected the text, so word positions no longer apply: place
      // each edited line over the detected line with the same index.
      const edited = p.edited.split('\n')
      r.lines.forEach((l, k) => edited[k] !== undefined && drawInvisible(page, font, fontKey, edited[k], l.box, map))
    } else {
      for (const s of segments(r.lines)) drawInvisible(page, font, fontKey, s.text, s.box, map)
    }
  }
  return new Blob([(await out.save()) as BlobPart], { type: 'application/pdf' })
}

/**
 * Open the original PDF for adding a text layer. Encrypted PDFs are refused:
 * pdf-lib cannot decrypt them, so the result would be broken, or would drop
 * the owner's copy/print restrictions. TXT and JSON exports still work.
 */
async function loadUnencrypted(e: FileEntry): Promise<PDFDocument> {
  // Load without decrypting, then check the flag: pdf-lib's own "encrypted"
  // error is a plain Error, so it can't be told apart reliably.
  const pdf = await PDFDocument.load(await e.file.arrayBuffer(), { ignoreEncryption: true })
  if (pdf.isEncrypted) throw new Error(i18n.t('export.encrypted', { name: basename(e.path) }))
  return pdf
}

async function embedImage(out: PDFDocument, doc: LoadedDoc) {
  if (doc.mime === 'image/png') return out.embedPng(await doc.file.arrayBuffer())
  // Everything else goes through a canvas: it applies JPEG EXIF rotation (which
  // pdf-lib ignores) and converts formats PDF cannot hold (webp, bmp, ...).
  const bmp = await createImageBitmap(doc.file, { imageOrientation: 'from-image' })
  const c = new OffscreenCanvas(bmp.width, bmp.height)
  c.getContext('2d')!.drawImage(bmp, 0, 0)
  bmp.close()
  if (doc.mime === 'image/jpeg') return out.embedJpg(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.92 })).arrayBuffer())
  return out.embedPng(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())
}
