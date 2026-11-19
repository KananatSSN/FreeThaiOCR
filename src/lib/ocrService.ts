// Main-thread side of OCR: owns the worker, a small cache of rendered pages, and
// the scheduler that reads pages automatically, one at a time. Every job names
// its file, so results land in the right place even when the user has moved on.
import * as Comlink from 'comlink'
import type { EngineModel, InitStage, OcrWorkerApi, RecognizeResult } from '@/ocr/worker'
import { type BatchJob, type EngineRead, type FileEntry, freshPages, getFile, readDone, readOf, useApp } from '@/state/store'
import { documentModeCapable } from './device'
import { closeDoc, openDoc, readMeta, renderPage, renderThumb } from './documents'
import { fileKey, isPdf, naturalCompare, triageFiles } from './fileTypes'

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

// --- scheduler -----------------------------------------------------------------
// One job at a time, so OCR never runs two pages at once (phones). Explicit jobs
// (exports) go first; otherwise the scheduler picks the next automatic read:
// Akson on the page on screen while its tab is open, then OpenThai on every page,
// starting with the page on screen, the rest of its file, then the other files.
type Job = () => Promise<unknown>
const urgent: Job[] = []
let looping = false

function kick() {
  if (!looping) void loop()
}
async function loop() {
  looping = true
  try {
    for (;;) {
      const job = urgent.shift() ?? nextAuto()
      if (!job) return
      try {
        await job()
      } catch {
        /* recorded on the page */
      }
    }
  } finally {
    looping = false
  }
}
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    urgent.push(() => job().then(resolve, reject))
    kick()
  })
}

/** Files in the order the sidebar lists them, the one on screen first. */
function autoOrder(): FileEntry[] {
  const s = app()
  const sorted = [...s.files].sort((a, b) => naturalCompare(a.path, b.path))
  const active = sorted.findIndex((f) => f.id === s.activeId)
  return active > 0 ? [sorted[active], ...sorted.slice(0, active), ...sorted.slice(active + 1)] : sorted
}

/**
 * Akson should read the page: it hasn't yet, or it read it in the other mode (document mode
 * was switched meanwhile, even during that read). Text the user edited is never replaced.
 */
function aksonNeedsRead(r: EngineRead): boolean {
  if (r.status === 'idle') return true
  return r.status === 'done' && !!r.result && r.edited === undefined && (r.result.markdown !== undefined) !== documentModeActive()
}

/** The next automatic read, or null when there's nothing to do (or it's paused). */
function nextAuto(): Job | null {
  const s = app()
  if (s.batch) return null // an export is reading pages itself
  const active = getFile(s, s.activeId)
  // Akson: only the page on screen, only while its tab is open.
  if (s.resultsTab === 'akson' && s.aksonEnabled && s.engines.akson.state !== 'error' && active?.status === 'ready') {
    const page = active.pages[s.current]
    if (page && aksonNeedsRead(readOf(page, 'akson'))) return () => readPage(active.id, s.current, 'akson')
  }
  if (s.autoPaused || s.engines.openthai.state === 'error') return null
  for (const f of autoOrder()) {
    if (f.status !== 'ready') continue
    const first = f.id === s.activeId && f.pages[s.current] ? s.current : 0
    for (let k = 0; k < f.pages.length; k++) {
      const i = (first + k) % f.pages.length
      if (f.pages[i].status === 'idle') return () => readPage(f.id, i, 'openthai')
    }
  }
  return null
}

// Re-plan when anything the scheduler looks at changes.
useApp.subscribe((s, prev) => {
  if (
    s.files !== prev.files ||
    s.activeId !== prev.activeId ||
    s.current !== prev.current ||
    s.resultsTab !== prev.resultsTab ||
    s.aksonEnabled !== prev.aksonEnabled ||
    s.documentMode !== prev.documentMode ||
    s.autoPaused !== prev.autoPaused ||
    s.batch !== prev.batch ||
    s.engines !== prev.engines
  )
    kick()
})

/** Stop or resume background OpenThai reading (the page being read finishes). */
export const setAutoPaused = (on: boolean) => app().setAutoPaused(on)

// --- engines -----------------------------------------------------------------------
class EngineLoadError extends Error {}

export async function ensureEngine(model: EngineModel): Promise<void> {
  const s = app()
  if (s.engines[model].state === 'ready') return
  s.setEngine(model, 'loading', { stage: 'runtime' })
  try {
    await getWorker().init(
      model,
      s.backend,
      Comlink.proxy((stage: InitStage, progress?: number | null) => app().setEngine(model, stage === 'ready' ? 'ready' : 'loading', { stage, progress })),
    )
    app().setEngine(model, 'ready')
  } catch (e) {
    app().setEngine(model, 'error', { error: errMsg(e) })
    throw new EngineLoadError(errMsg(e))
  }
}

/** Retry an engine that failed to load; the scheduler then carries on. */
export const retryEngine = (model: EngineModel) => ensureEngine(model).catch(() => {})

/** Akson document mode is on (and offered on this device). */
export const documentModeActive = () => app().documentMode && documentModeCapable(app().backend)

let documentReady = false
/** Download the document-mode models before the first such page, showing progress. */
async function ensureDocument(): Promise<void> {
  if (documentReady) return
  app().setEngine('akson', 'loading', { stage: 'document', progress: null })
  try {
    await getWorker().prepareDocument(
      app().backend,
      Comlink.proxy((progress: number | null) => app().setEngine('akson', 'loading', { stage: 'document', progress })),
    )
    documentReady = true
    app().setEngine('akson', 'ready')
  } catch (e) {
    app().setEngine('akson', 'error', { error: errMsg(e) })
    throw new EngineLoadError(errMsg(e))
  }
}
// The worker keeps one engine per (model, backend); switching backend means loading again.
useApp.subscribe((s, prev) => {
  if (s.backend !== prev.backend) documentReady = false
})

async function recognize(model: EngineModel, fileId: string, index: number): Promise<RecognizeResult> {
  await ensureEngine(model)
  const document = model === 'akson' && documentModeActive()
  if (document) await ensureDocument()
  const bmp = await getPageBitmap(fileId, index)
  // Send a copy: the cached bitmap stays usable for display.
  const copy = await createImageBitmap(bmp)
  return getWorker().recognize(model, app().backend, Comlink.transfer(copy, [copy]), document)
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

/** When a file comes on screen: render its thumbnails. */
export async function prepareActive(id: string) {
  const e = fileById(id)
  if (!e || e.status !== 'ready') return
  await makeThumbs(id)
}

// Keep the active file prepared as the user switches between files.
useApp.subscribe((s, prev) => {
  if (s.activeId && s.activeId !== prev.activeId) void prepareActive(s.activeId)
})

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
/** Read one page with one engine (runs inside a scheduler job). */
async function readPage(fileId: string, index: number, engine: EngineModel): Promise<void> {
  if (!fileById(fileId)?.pages[index]) return
  app().patchRead(fileId, index, engine, { status: 'running', error: undefined })
  try {
    const r = await recognize(engine, fileId, index)
    if (!fileById(fileId)) return
    app().patchRead(fileId, index, engine, {
      status: 'done',
      edited: undefined,
      result: { text: r.text, lines: r.lines, rotation: r.rotation, engine, markdown: r.markdown },
    })
  } catch (e) {
    if (!fileById(fileId)) return
    // The engine didn't load: the page waits (the scheduler holds off until a retry).
    if (e instanceof EngineLoadError) app().patchRead(fileId, index, engine, { status: 'idle' })
    else app().patchRead(fileId, index, engine, { status: 'error', error: errMsg(e) })
    throw e
  }
}

/** Read a page again with an engine (after an error). */
export function rereadPage(fileId: string, index: number, engine: EngineModel) {
  if (fileById(fileId)?.pages[index]) app().patchRead(fileId, index, engine, { status: 'idle', error: undefined })
}

/** The page still needs reading for an export with `engine` (Akson: also when read in the other mode). */
const missing = (r: EngineRead, engine: EngineModel) => !readDone(r) || (engine === 'akson' && aksonNeedsRead(r))
const missingPages = (e: FileEntry, engine: EngineModel) => e.pages.map((p, i) => (missing(readOf(p, engine), engine) ? i : -1)).filter((i) => i >= 0)

/**
 * Make sure every page of the given files has text from `engine`: OCR the missing
 * pages one at a time (rendering each only when its turn
 * comes, so memory stays flat). Used by exports; background reading waits meanwhile.
 * Returns false if it was cancelled.
 */
export async function completeFiles(fileIds: string[], scope: BatchJob['scope'], engine: EngineModel = 'openthai'): Promise<boolean> {
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
    // Wait for page counts.
    for (const id of ids) {
      while (fileById(id)?.status === 'loading') await new Promise((r) => setTimeout(r, 100))
      if (cancelled()) return false
    }
    const work = ids.map((id) => ({ id, pages: fileById(id) ? missingPages(fileById(id)!, engine) : [] }))
    bump({ pagesTotal: work.reduce((n, w) => n + w.pages.length, 0) })
    for (const w of work) {
      const e = fileById(w.id)
      if (e) bump({ currentPath: e.path })
      for (const i of w.pages) {
        if (cancelled()) return false
        const page = fileById(w.id)?.pages[i]
        if (!page) break // removed mid-batch
        // A page already being read in the background finishes on its own.
        while (readOf(fileById(w.id)?.pages[i] ?? page, engine).status === 'running') await new Promise((r) => setTimeout(r, 100))
        if (missing(readOf(fileById(w.id)?.pages[i] ?? page, engine), engine)) {
          try {
            await enqueue(() => readPage(w.id, i, engine))
          } catch (err) {
            if (err instanceof EngineLoadError) throw err // nothing more can be read
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

let cancelPending = false

/** Cancel the running export batch, or the one about to start if none is running yet. */
export function cancelBatch() {
  const b = app().batch
  if (b) app().setBatch({ ...b, cancelled: true })
  else cancelPending = true
}
