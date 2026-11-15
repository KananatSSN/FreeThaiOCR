// Main-thread side of OCR: owns the worker, a small cache of rendered pages,
// and a one-at-a-time job queue so OCR never runs two pages at once (phones).
// Every job names its file, so results land in the right place even when the
// user has moved on to another file.
import * as Comlink from 'comlink'
import type { OcrResult } from '@/ocr/engine'
import type { InitStage, OcrWorkerApi, Rect } from '@/ocr/worker'
import { type BatchJob, type FileEntry, freshPages, getFile, pageDone, useApp } from '@/state/store'
import { closeDoc, extractPdfText, openDoc, readMeta, renderPage, renderThumb } from './documents'
import { fileKey, isPdf, triageFiles } from './fileTypes'

let worker: Comlink.Remote<OcrWorkerApi> | null = null
function getWorker() {
  worker ??= Comlink.wrap<OcrWorkerApi>(new Worker(new URL('../ocr/worker.ts', import.meta.url), { type: 'module' }))
  return worker
}

const app = () => useApp.getState()
const fileById = (id: string) => getFile(app(), id)
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

// --- rendered page cache (bitmaps are big: keep only a few) -----------------
const CACHE_SIZE = 4
const bitmaps = new Map<string, Promise<ImageBitmap>>()

export function getPageBitmap(fileId: string, index: number): Promise<ImageBitmap> {
  const entry = fileById(fileId)
  if (!entry) return Promise.reject(new Error('File was removed'))
  const key = `${fileId}:${index}`
  let p = bitmaps.get(key)
  if (p) {
    bitmaps.delete(key) // re-insert as most recent
  } else {
    p = openDoc(entry).then((doc) => renderPage(doc, index))
    p.catch(() => bitmaps.delete(key))
  }
  bitmaps.set(key, p)
  while (bitmaps.size > CACHE_SIZE) {
    const [oldest, old] = bitmaps.entries().next().value!
    bitmaps.delete(oldest)
    old.then((b) => b.close()).catch(() => {})
  }
  return p
}

function dropBitmaps(fileId?: string) {
  for (const [key, p] of bitmaps) {
    if (fileId && !key.startsWith(`${fileId}:`)) continue
    bitmaps.delete(key)
    p.then((b) => b.close()).catch(() => {})
  }
}

// --- job queue ---------------------------------------------------------------
let chain: Promise<unknown> = Promise.resolve()
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = chain.then(job, job)
  chain = run.catch(() => {})
  return run
}

export async function ensureEngine(): Promise<void> {
  const s = app()
  if (s.engine === 'ready') return
  s.setEngine('loading', { stage: 'runtime' })
  try {
    await getWorker().init(
      s.backend,
      Comlink.proxy((stage: InitStage) => app().setEngine(stage === 'ready' ? 'ready' : 'loading', { stage })),
    )
    app().setEngine('ready')
  } catch (e) {
    app().setEngine('error', { error: errMsg(e) })
    throw e
  }
}

async function recognize(fileId: string, index: number, rect?: Rect): Promise<OcrResult> {
  await ensureEngine()
  const bmp = await getPageBitmap(fileId, index)
  // Send a copy: the cached bitmap stays usable for display.
  const copy = await createImageBitmap(bmp)
  return getWorker().recognize(app().backend, Comlink.transfer(copy, [copy]), rect)
}

// --- adding and removing files --------------------------------------------------
export interface AddResult {
  added: number
  skipped: number
  duplicates: number
}

/** Add files (from a picker, a folder or a drop). Metadata loads in the background. */
export function addFiles(files: File[]): AddResult {
  const existing = new Set(app().files.map((f) => fileKey(f.file, f.path)))
  const { accepted, skipped, duplicates } = triageFiles(files, existing)
  const entries: FileEntry[] = accepted.map(({ file, path }) => ({
    id: crypto.randomUUID(),
    file,
    path,
    kind: isPdf(file) ? 'pdf' : 'image',
    status: 'loading',
    pages: [],
    textScanned: false,
  }))
  if (entries.length) {
    app().addFiles(entries)
    void loadMetadata(entries)
  }
  return { added: entries.length, skipped, duplicates }
}

/** Page counts and sizes, one file at a time (cheap, and keeps memory flat). */
async function loadMetadata(entries: FileEntry[]) {
  for (const e of entries) {
    if (!fileById(e.id)) continue
    try {
      const meta = await readMeta(e.file, e.kind)
      app().patchFile(e.id, { status: 'ready', meta, pages: freshPages(meta.pageCount) })
      if (app().activeId === e.id) void prepareActive(e.id)
    } catch (err) {
      app().patchFile(e.id, { status: 'error', error: errMsg(err) })
    }
  }
}

export function removeFile(id: string) {
  closeDoc(id)
  dropBitmaps(id)
  app().removeFile(id)
}

export function clearFiles() {
  for (const f of app().files) closeDoc(f.id)
  dropBitmaps()
  app().clearFiles()
}

/** When a file comes on screen: read its PDF text layer and render thumbnails. */
export async function prepareActive(id: string) {
  const e = fileById(id)
  if (!e || e.status !== 'ready') return
  await scanEmbeddedText(id)
  await makeThumbs(id)
}

// Keep the active file prepared as the user switches between files.
useApp.subscribe((s, prev) => {
  if (s.activeId && s.activeId !== prev.activeId) void prepareActive(s.activeId)
})

/** Use a born-digital PDF's own text layer where it has one (instant, exact). Once per file. */
const scanning = new Map<string, Promise<void>>()
function scanEmbeddedText(id: string): Promise<void> {
  const e = fileById(id)
  if (!e || e.kind !== 'pdf' || e.textScanned || e.status !== 'ready') return Promise.resolve()
  let p = scanning.get(id)
  if (!p) {
    p = (async () => {
      const doc = await openDoc(e)
      for (let i = 0; i < e.pages.length; i++) {
        if (!fileById(id)) return
        try {
          const t = await extractPdfText(doc, i)
          const page = fileById(id)?.pages[i]
          if (t && page) app().patchPage(id, i, { hasPdfText: true, ...(page.result ? {} : { status: 'done', result: { source: 'pdf', ...t } }) })
        } catch {
          /* unreadable text layer: OCR still works */
        }
      }
      if (fileById(id)) app().patchFile(id, { textScanned: true })
    })().finally(() => scanning.delete(id))
    scanning.set(id, p)
  }
  return p
}

async function makeThumbs(id: string) {
  const e = fileById(id)
  if (!e || e.pages.length < 2) return
  for (let i = 0; i < e.pages.length; i++) {
    const cur = fileById(id)
    if (!cur || app().activeId !== id) return // only for the file on screen
    if (cur.pages[i]?.thumb) continue
    try {
      const url = await renderThumb(await openDoc(cur), i)
      if (fileById(id)) app().patchPage(id, i, { thumb: url })
      else URL.revokeObjectURL(url)
    } catch {
      /* thumbnail is cosmetic */
    }
  }
}

// --- OCR actions ----------------------------------------------------------------
export function ocrPage(fileId: string, index: number): Promise<void> {
  app().patchPage(fileId, index, { status: 'running', error: undefined })
  return enqueue(async () => {
    if (!fileById(fileId)) return
    try {
      const r = await recognize(fileId, index)
      if (!fileById(fileId)) return
      app().patchPage(fileId, index, {
        status: 'done',
        edited: undefined,
        result: { source: 'ocr', text: r.text, lines: r.lines, rotation: r.rotation },
      })
    } catch (e) {
      if (fileById(fileId)) app().patchPage(fileId, index, { status: 'error', error: errMsg(e) })
      throw e
    }
  })
}

export function ocrBox(fileId: string, index: number, id: string): Promise<void> {
  const box = fileById(fileId)?.pages[index]?.boxes.find((b) => b.id === id)
  if (!box) return Promise.resolve()
  app().patchBox(fileId, index, id, { status: 'running', error: undefined })
  return enqueue(async () => {
    // Re-read the box: it may have been moved, resized or deleted while queued.
    const cur = fileById(fileId)?.pages[index]?.boxes.find((b) => b.id === id)
    if (!cur) return
    try {
      const r = await recognize(fileId, index, { x: cur.x, y: cur.y, w: cur.w, h: cur.h })
      app().patchBox(fileId, index, id, { status: 'done', edited: undefined, result: { source: 'ocr', text: r.text, lines: r.lines } })
    } catch (e) {
      app().patchBox(fileId, index, id, { status: 'error', error: errMsg(e) })
    }
  })
}

const missingPages = (e: FileEntry) => e.pages.map((p, i) => (pageDone(p) ? -1 : i)).filter((i) => i >= 0)

/**
 * Make sure every page of the given files has text: read embedded PDF text,
 * then OCR the remaining pages one at a time (rendering each only when its turn
 * comes, so memory stays flat). Shared by "OCR all pages", "OCR all files" and
 * exports. Returns false if it was cancelled.
 */
export async function completeFiles(fileIds: string[], scope: BatchJob['scope']): Promise<boolean> {
  if (app().batch) return false
  if (cancelPending) {
    // Cancel was pressed before this batch got going (e.g. while export code loaded).
    cancelPending = false
    return false
  }
  const ids = fileIds.filter((id) => fileById(id)?.status !== 'error')
  app().setBatch({ scope, filesTotal: ids.length, filesDone: 0, pagesTotal: 0, pagesDone: 0, cancelled: false })
  const bump = (patch: Partial<BatchJob>) => {
    const b = app().batch
    if (b) app().setBatch({ ...b, ...patch })
  }
  const cancelled = () => !!app().batch?.cancelled
  try {
    // Wait for page counts, then read text layers so those pages need no OCR.
    for (const id of ids) {
      while (fileById(id)?.status === 'loading') await new Promise((r) => setTimeout(r, 100))
      if (cancelled()) return false
      await scanEmbeddedText(id)
    }
    const work = ids.map((id) => ({ id, pages: fileById(id) ? missingPages(fileById(id)!) : [] }))
    bump({ pagesTotal: work.reduce((n, w) => n + w.pages.length, 0) })
    for (const w of work) {
      const e = fileById(w.id)
      if (e) bump({ currentPath: e.path })
      for (const i of w.pages) {
        if (cancelled()) return false
        if (!fileById(w.id)) break // removed mid-batch
        if (!pageDone(fileById(w.id)!.pages[i])) {
          try {
            await ocrPage(w.id, i)
          } catch {
            /* recorded on the page; keep going */
          }
        }
        bump({ pagesDone: (app().batch?.pagesDone ?? 0) + 1 })
      }
      bump({ filesDone: (app().batch?.filesDone ?? 0) + 1 })
      // Free the batch's document unless it's the one on screen.
      if (app().activeId !== w.id) {
        closeDoc(w.id)
        dropBitmaps(w.id)
      }
    }
    return !cancelled()
  } finally {
    cancelPending = false
    app().setBatch(null)
  }
}

export const ocrAll = (fileId: string) => completeFiles([fileId], 'file')
export const ocrAllFiles = () => completeFiles(app().files.map((f) => f.id), 'all')

let cancelPending = false

/** Cancel the running batch, or the one about to start if none is running yet. */
export function cancelBatch() {
  const b = app().batch
  if (b) app().setBatch({ ...b, cancelled: true })
  else cancelPending = true
}
