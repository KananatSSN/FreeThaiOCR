import { create } from 'zustand'
import type { OcrLine } from '@/ocr/engine'
import type { Backend, EngineModel } from '@/ocr/worker'

export type Status = 'idle' | 'running' | 'done' | 'error'
export type DocKind = 'image' | 'pdf'

export interface PageResult {
  text: string
  lines: OcrLine[]
  /** Clockwise degrees the engine turned the page to read it. */
  rotation?: number
  /** Which OCR engine read it. */
  engine?: EngineModel
  /** Akson document mode: the page as Markdown; shown and edited in place of `text`. */
  markdown?: string
}

/** One engine's reading of a page: its status, result and the user's corrections. */
export interface EngineRead {
  status: Status
  error?: string
  result?: PageResult
  /** User corrections to the text; undefined = untouched. */
  edited?: string
}

/**
 * A page. Its own read fields are OpenThai's (read automatically); `akson` holds
 * AksonOCR-Lite's read, made only when its tab is open (see `readOf`).
 */
export interface PageState extends EngineRead {
  akson?: EngineRead
  thumb?: string
}

export interface FileMeta {
  pageCount: number
  /** Page sizes in render pixels, known up front so layout never jumps. */
  sizes: { width: number; height: number }[]
}

/** One uploaded file. Bytes stay in the (disk-backed) File until needed. */
export interface FileEntry {
  id: string
  file: File
  /** Relative path ("reports/a.pdf") when it came from a folder, else the name. */
  path: string
  kind: DocKind
  status: 'loading' | 'ready' | 'error'
  error?: string
  meta?: FileMeta
  pages: PageState[]
}

export type EngineState = 'idle' | 'loading' | 'ready' | 'error'
export interface EngineInfo {
  state: EngineState
  stage?: string
  /** Download progress of the current stage, 0..1 (null = unknown size). */
  progress?: number | null
  error?: string
}

export interface BatchJob {
  scope: 'file' | 'all' | 'export'
  filesTotal: number
  filesDone: number
  pagesTotal: number
  pagesDone: number
  currentPath?: string
  cancelled: boolean
}

interface AppState {
  files: FileEntry[]
  activeId: string | null
  current: number
  backend: Backend
  /** The user has agreed to AksonOCR-Lite's download (its tab then reads the page on screen). */
  aksonEnabled: boolean
  /** Akson document mode (layout + tables). */
  documentMode: boolean
  /** The user has agreed to document mode's download once. */
  documentConsented: boolean
  engines: Record<EngineModel, EngineInfo>
  /** The results panel's open tab: the viewer shows that engine's lines. */
  resultsTab: EngineModel
  /** Background OpenThai reading was stopped by the user. */
  autoPaused: boolean
  batch: BatchJob | null
  hoveredLine: number | null
  /** A line clicked in the viewer, for the results panel to reveal (then cleared). */
  focusLine: number | null

  addFiles(entries: FileEntry[]): void
  patchFile(id: string, patch: Partial<FileEntry>): void
  removeFile(id: string): void
  clearFiles(): void
  setActive(id: string | null): void
  setCurrent(i: number): void
  setBackend(b: Backend): void
  enableAkson(): void
  setDocumentMode(on: boolean): void
  setEngine(model: EngineModel, state: EngineState, extra?: Omit<EngineInfo, 'state'>): void
  setResultsTab(t: EngineModel): void
  setAutoPaused(on: boolean): void
  patchPage(fileId: string, i: number, patch: Partial<PageState>): void
  /** Patch one engine's read of a page (see `readOf` for where it lives). */
  patchRead(fileId: string, i: number, engine: EngineModel, patch: Partial<EngineRead>): void
  hoverLine(i: number | null): void
  setFocusLine(i: number | null): void
  setBatch(b: BatchJob | null): void
}

const readPref = <T extends string>(key: string, fallback: T): T => {
  try {
    return (localStorage.getItem(key) as T) || fallback
  } catch {
    return fallback
  }
}
const writePref = (key: string, v: string) => {
  try {
    localStorage.setItem(key, v)
  } catch {
    /* private mode: preferences just don't persist */
  }
}

export const freshPages = (n: number): PageState[] => Array.from({ length: n }, () => ({ status: 'idle' }))

const revokeThumbs = (f: FileEntry) => f.pages.forEach((p) => p.thumb && URL.revokeObjectURL(p.thumb))

/** Apply `fn` to one page of one file, leaving everything else untouched. */
const mapPage = (files: FileEntry[], fileId: string, i: number, fn: (p: PageState) => PageState) =>
  files.map((f) => (f.id === fileId ? { ...f, pages: f.pages.map((p, k) => (k === i ? fn(p) : p)) } : f))

export const useApp = create<AppState>((set, get) => ({
  files: [],
  activeId: null,
  current: 0,
  backend: readPref<Backend>('freethaiocr.backend', 'wasm'),
  // Earlier versions chose one engine in Settings: someone who picked Akson there already agreed.
  aksonEnabled: readPref<string>('freethaiocr.akson', 'off') === 'on' || readPref<string>('freethaiocr.engine', '') === 'akson',
  documentMode: readPref<string>('freethaiocr.documentMode', 'off') === 'on',
  documentConsented: readPref<string>('freethaiocr.documentMode', 'off') === 'on' || readPref<string>('freethaiocr.documentConsent', 'off') === 'on',
  engines: { openthai: { state: 'idle' }, akson: { state: 'idle' } },
  resultsTab: 'openthai',
  autoPaused: false,
  batch: null,
  hoveredLine: null,
  focusLine: null,

  addFiles(entries) {
    set((s) => ({
      files: [...s.files, ...entries],
      autoPaused: false, // new files start reading even after a Stop
      activeId: s.activeId ?? entries[0]?.id ?? null,
      current: s.activeId ? s.current : 0,
    }))
  },
  patchFile(id, patch) {
    set((s) => ({ files: s.files.map((f) => (f.id === id ? { ...f, ...patch } : f)) }))
  },
  removeFile(id) {
    const s = get()
    const idx = s.files.findIndex((f) => f.id === id)
    if (idx < 0) return
    revokeThumbs(s.files[idx])
    const files = s.files.filter((f) => f.id !== id)
    const wasActive = s.activeId === id
    const next = wasActive ? (files[Math.min(idx, files.length - 1)]?.id ?? null) : s.activeId
    set({ files, activeId: next, ...(wasActive ? { current: 0, hoveredLine: null } : {}) })
  },
  clearFiles() {
    get().files.forEach(revokeThumbs)
    set({ files: [], activeId: null, current: 0, hoveredLine: null, batch: null, autoPaused: false })
  },
  setActive(activeId) {
    if (activeId === get().activeId) return
    set({ activeId, current: 0, hoveredLine: null })
  },
  setCurrent(current) {
    set({ current, hoveredLine: null })
  },
  enableAkson() {
    writePref('freethaiocr.akson', 'on')
    set({ aksonEnabled: true })
  },
  setDocumentMode(on) {
    writePref('freethaiocr.documentMode', on ? 'on' : 'off')
    if (on) writePref('freethaiocr.documentConsent', 'on')
    set({ documentMode: on, ...(on ? { documentConsented: true } : {}) })
  },
  setBackend(backend) {
    writePref('freethaiocr.backend', backend)
    set({ backend, engines: { openthai: { state: 'idle' }, akson: { state: 'idle' } } })
  },
  setEngine(model, state, extra) {
    set((s) => ({ engines: { ...s.engines, [model]: { state, ...extra } } }))
  },
  setResultsTab(resultsTab) {
    set({ resultsTab })
  },
  setAutoPaused(autoPaused) {
    set({ autoPaused })
  },
  patchPage(fileId, i, patch) {
    set((s) => ({ files: mapPage(s.files, fileId, i, (p) => ({ ...p, ...patch })) }))
  },
  patchRead(fileId, i, engine, patch) {
    set((s) => ({
      files: mapPage(s.files, fileId, i, (p) => (engine === 'openthai' ? { ...p, ...patch } : { ...p, akson: { ...(p.akson ?? IDLE_READ), ...patch } })),
    }))
  },
  hoverLine(hoveredLine) {
    set({ hoveredLine })
  },
  setFocusLine(focusLine) {
    set({ focusLine, hoveredLine: focusLine })
  },
  setBatch(batch) {
    set({ batch })
  },
}))

// --- selectors ------------------------------------------------------------------
type S = ReturnType<typeof useApp.getState>
export const getFile = (s: S, id: string | null | undefined) => (id ? s.files.find((f) => f.id === id) : undefined)
export const selectActive = (s: S) => getFile(s, s.activeId)
export const useActiveFile = () => useApp(selectActive)
export const useActivePage = () => useApp((s) => selectActive(s)?.pages[s.current])

const IDLE_READ: EngineRead = { status: 'idle' }
/** One engine's read of a page. */
export const readOf = (p: PageState, engine: EngineModel): EngineRead => (engine === 'openthai' ? p : (p.akson ?? IDLE_READ))

/** Akson can only be used once its download was agreed to; until then everything uses OpenThai. */
const usable = (s: S, engine: EngineModel): EngineModel => (engine === 'akson' && s.aksonEnabled ? 'akson' : 'openthai')
/** Engine of the open tab: the viewer shows its lines and exports use its text. */
export const viewEngine = (s: S) => usable(s, s.resultsTab)

/** A read counts as done when it has a result. */
export const readDone = (r: EngineRead) => r.status === 'done' && !!r.result
/** OpenThai has read the page. */
export const pageDone = (p: PageState) => readDone(p)
export const pagesDone = (f: FileEntry) => f.pages.filter(pageDone).length
export const fileName = (f: FileEntry) => f.path.split('/').pop() || f.path

/**
 * Character range of line `i` in the page text (rows joined by newlines, lines in
 * a row by spaces), or null if the user has edited the text.
 */
export function lineRange(p: EngineRead, i: number): [number, number] | null {
  const r = p.result
  if (!r || p.edited !== undefined || !r.lines[i]) return null
  let pos = 0
  for (let k = 0; k < i; k++) pos += r.lines[k].text.length + 1 // +1: the space or newline after it
  return [pos, pos + r.lines[i].text.length]
}

/** What the results panel shows and edits: the user's text, else the Markdown (document mode), else the text. */
export const pageText = (p: EngineRead) => p.edited ?? p.result?.markdown ?? p.result?.text ?? ''
