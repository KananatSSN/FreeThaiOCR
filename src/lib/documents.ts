// Loading user files: images decode to one page; PDFs render page by page
// with pdf.js (all in the browser, nothing uploaded anywhere).
import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import pdfjsPkg from 'pdfjs-dist/package.json'
import type { DocKind, FileEntry, FileMeta } from '@/state/store'

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
const PDFJS_ASSETS = `${import.meta.env.BASE_URL}vendor/pdfjs-${pdfjsPkg.version}/`

/** Long side, in pixels, pages are rendered at for viewing and OCR. */
export const RENDER_LONG_SIDE = 2200
const THUMB_WIDTH = 160

/** A file opened for rendering. Kept only while needed (see openDoc). */
export interface LoadedDoc {
  kind: DocKind
  file: File
  mime: string
  pdf?: PDFDocumentProxy
}

async function openPdf(file: File): Promise<PDFDocumentProxy> {
  return pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    cMapUrl: `${PDFJS_ASSETS}cmaps/`,
    standardFontDataUrl: `${PDFJS_ASSETS}standard_fonts/`,
    wasmUrl: `${PDFJS_ASSETS}wasm/`,
    iccUrl: `${PDFJS_ASSETS}iccs/`,
  }).promise
}

/** Page count and render sizes, without keeping the document open. */
export async function readMeta(file: File, kind: DocKind): Promise<FileMeta> {
  if (kind === 'image') {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const size = { width: bmp.width, height: bmp.height }
    bmp.close()
    return { pageCount: 1, sizes: [size] }
  }
  const pdf = await openPdf(file)
  try {
    const sizes: FileMeta['sizes'] = []
    for (let i = 1; i <= pdf.numPages; i++) {
      const vp = (await pdf.getPage(i)).getViewport({ scale: 1 })
      const s = renderScale(vp.width, vp.height)
      sizes.push({ width: Math.round(vp.width * s), height: Math.round(vp.height * s) })
    }
    return { pageCount: pdf.numPages, sizes }
  } finally {
    void pdf.loadingTask.destroy()
  }
}

// Open documents: the file on screen plus the one a batch is working on. pdf.js
// keeps a parsed copy of each, so a folder of 100 PDFs must not all stay open.
const OPEN_LIMIT = 2
const opened = new Map<string, Promise<LoadedDoc>>()

export function openDoc(entry: FileEntry): Promise<LoadedDoc> {
  let p = opened.get(entry.id)
  if (p) {
    opened.delete(entry.id) // re-insert as most recent
  } else {
    const mime = entry.file.type || (entry.kind === 'pdf' ? 'application/pdf' : 'image/png')
    p = entry.kind === 'pdf' ? openPdf(entry.file).then((pdf) => ({ kind: entry.kind, file: entry.file, mime, pdf })) : Promise.resolve({ kind: entry.kind, file: entry.file, mime })
    p.catch(() => opened.delete(entry.id))
  }
  opened.set(entry.id, p)
  while (opened.size > OPEN_LIMIT) {
    const [oldId] = opened.keys()
    closeDoc(oldId)
  }
  return p
}

export function closeDoc(id: string) {
  const p = opened.get(id)
  opened.delete(id)
  p?.then((d) => d.pdf?.loadingTask.destroy()).catch(() => {})
}

export const renderScale = (w: number, h: number) => RENDER_LONG_SIDE / Math.max(w, h)

/** Render (or decode) page `index` at full working resolution. */
export async function renderPage(doc: LoadedDoc, index: number): Promise<ImageBitmap> {
  if (doc.kind === 'image') {
    return createImageBitmap(doc.file, { imageOrientation: 'from-image' })
  }
  const page = await doc.pdf!.getPage(index + 1)
  const base = page.getViewport({ scale: 1 })
  const vp = page.getViewport({ scale: renderScale(base.width, base.height) })
  const canvas = new OffscreenCanvas(Math.round(vp.width), Math.round(vp.height))
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport: vp }).promise
  page.cleanup()
  return canvas.transferToImageBitmap()
}

export async function renderThumb(doc: LoadedDoc, index: number): Promise<string> {
  const full = doc.kind === 'image' ? await renderPage(doc, 0) : null
  let canvas: OffscreenCanvas
  if (full) {
    canvas = new OffscreenCanvas(THUMB_WIDTH, Math.round((full.height / full.width) * THUMB_WIDTH))
    canvas.getContext('2d')!.drawImage(full, 0, 0, canvas.width, canvas.height)
    full.close()
  } else {
    const page = await doc.pdf!.getPage(index + 1)
    const base = page.getViewport({ scale: 1 })
    const vp = page.getViewport({ scale: THUMB_WIDTH / base.width })
    canvas = new OffscreenCanvas(Math.round(vp.width), Math.round(vp.height))
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport: vp }).promise
  }
  return URL.createObjectURL(await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 }))
}

/** Pages with at least this many non-space characters in their text layer count as having text. */
const MIN_EMBEDDED_CHARS = 20

/**
 * Whether a PDF page has its own text layer (born-digital, not a scan). Text is never
 * taken from it (every page is OCR'd); the searchable PDF export uses this only to avoid
 * adding a second, duplicate text layer to such pages.
 */
export async function hasTextLayer(doc: LoadedDoc, index: number): Promise<boolean> {
  if (doc.kind !== 'pdf') return false
  const page = await doc.pdf!.getPage(index + 1)
  const content = await page.getTextContent()
  const chars = content.items.reduce((n, it) => n + ('str' in it ? it.str.replace(/\s/g, '').length : 0), 0)
  page.cleanup()
  return chars >= MIN_EMBEDDED_CHARS
}

/** Page-pixel -> PDF user-space mapping for page `index` (for the searchable PDF export). */
export async function pdfPointMapper(doc: LoadedDoc, index: number): Promise<(x: number, y: number) => [number, number]> {
  const page = await doc.pdf!.getPage(index + 1)
  const base = page.getViewport({ scale: 1 })
  const vp = page.getViewport({ scale: renderScale(base.width, base.height) })
  return (x, y) => vp.convertToPdfPoint(x, y) as [number, number]
}
