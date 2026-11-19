import { create } from 'zustand'
import type { OcrLine } from '@/ocr/engine'
import type { Backend, EngineModel } from '@/ocr/worker'

export type Status = 'idle' | 'running' | 'done' | 'error'
export type ResultSource = 'ocr' | 'pdf'
export type DocKind = 'image' | 'pdf'

export interface PageResult {
  source: ResultSource
  text: string
  lines: OcrLine[]
  /** Clockwise degrees the engine turned the page to read it. */
  rotation?: number
  /** Which OCR engine read it (absent for embedded PDF text). */
  engine?: EngineModel
  /** Akson document mode: the page as Markdown; shown and edited in place of `text`. */
  markdown?: string
}

export interface RegionBox {
  id: string
  /** Display number; stays stable while other boxes are added or removed. */
  n: number
  x: number
  y: number
  w: number
  h: number
  status: Status
  result?: PageResult
  edited?: string
  error?: string
}

export interface PageState {
  status: Status
  error?: string
  result?: PageResult
  /** User corrections to the page text; undefined = untouched. */
  edited?: string
  /** The page has its own text layer (a born-digital PDF). */
  hasPdfText?: boolean
  thumb?: string
  boxes: RegionBox[]
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
  /** Embedded PDF text detection has run for this file. */
  textScanned: boolean
}

export type Mode = 'pan' | 'box'
export type EngineState = 'idle' | 'loading' | 'ready' | 'error'

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
  mode: Mode
  backend: Backend
  engineModel: EngineModel
  /** Akson document mode (layout + tables); only used with engineModel 'akson'. */
  documentMode: boolean
  engine: EngineState
  engineStage?: string
  /** Download progress of the current stage, 0..1 (null = unknown size). */
  engineProgress?: number | null
  engineError?: string
  batch: BatchJob | null
  selectedBox: string | null
  hoveredLine: number | null
  /** A line clicked in the viewer, for the results panel to reveal (then cleared). */
  focusLine: number | null
  nextBoxN: number

  addFiles(entries: FileEntry[]): void
  patchFile(id: string, patch: Partial<FileEntry>): void
  removeFile(id: string): void
  clearFiles(): void
  setActive(id: string | null): void
  setCurrent(i: number): void
  setMode(m: Mode): void
  setBackend(b: Backend): void
  setEngineModel(m: EngineModel): void
  setDocumentMode(on: boolean): void
  setEngine(s: EngineState, extra?: { stage?: string; error?: string; progress?: number | null }): void
  patchPage(fileId: string, i: number, patch: Partial<PageState>): void
  addBox(fileId: string, i: number, rect: { x: number; y: number; w: number; h: number }): RegionBox
  patchBox(fileId: string, i: number, id: string, patch: Partial<RegionBox>): void
  removeBox(fileId: string, i: number, id: string): void
  clearBoxes(fileId: string, i: number): void
  selectBox(id: string | null): void
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

export const freshPages = (n: number): PageState[] => Array.from({ length: n }, () => ({ status: 'idle', boxes: [] }))

const revokeThumbs = (f: FileEntry) => f.pages.forEach((p) => p.thumb && URL.revokeObjectURL(p.thumb))

/** Apply `fn` to one page of one file, leaving everything else untouched. */
const mapPage = (files: FileEntry[], fileId: string, i: number, fn: (p: PageState) => PageState) =>
  files.map((f) => (f.id === fileId ? { ...f, pages: f.pages.map((p, k) => (k === i ? fn(p) : p)) } : f))

export const useApp = create<AppState>((set, get) => ({
  files: [],
  activeId: null,
  current: 0,
  mode: 'pan',
  backend: readPref<Backend>('freethaiocr.backend', 'wasm'),
  engineModel: readPref<EngineModel>('freethaiocr.engine', 'openthai') === 'akson' ? 'akson' : 'openthai',
  documentMode: readPref<string>('freethaiocr.documentMode', 'off') === 'on',
  engine: 'idle',
  batch: null,
  selectedBox: null,
  hoveredLine: null,
  focusLine: null,
  nextBoxN: 1,

  addFiles(entries) {
    set((s) => ({
      files: [...s.files, ...entries],
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
    set({ files, activeId: next, ...(wasActive ? { current: 0, selectedBox: null, hoveredLine: null } : {}) })
  },
  clearFiles() {
    get().files.forEach(revokeThumbs)
    set({ files: [], activeId: null, current: 0, mode: 'pan', selectedBox: null, hoveredLine: null, nextBoxN: 1, batch: null })
  },
  setActive(activeId) {
    if (activeId === get().activeId) return
    set({ activeId, current: 0, selectedBox: null, hoveredLine: null })
  },
  setCurrent(current) {
    set({ current, selectedBox: null, hoveredLine: null })
  },
  setMode(mode) {
    set({ mode, selectedBox: mode === 'pan' ? null : get().selectedBox })
  },
  setEngineModel(engineModel) {
    writePref('freethaiocr.engine', engineModel)
    set({ engineModel, engine: 'idle' })
  },
  setDocumentMode(on) {
    writePref('freethaiocr.documentMode', on ? 'on' : 'off')
    set({ documentMode: on })
  },
  setBackend(backend) {
    writePref('freethaiocr.backend', backend)
    set({ backend, engine: 'idle' })
  },
  setEngine(engine, extra) {
    set({ engine, engineStage: extra?.stage, engineError: extra?.error, engineProgress: extra?.progress })
  },
  patchPage(fileId, i, patch) {
    set((s) => ({ files: mapPage(s.files, fileId, i, (p) => ({ ...p, ...patch })) }))
  },
  addBox(fileId, i, rect) {
    const box: RegionBox = { id: crypto.randomUUID(), n: get().nextBoxN, ...rect, status: 'idle' }
    set((s) => ({
      nextBoxN: s.nextBoxN + 1,
      selectedBox: box.id,
      files: mapPage(s.files, fileId, i, (p) => ({ ...p, boxes: [...p.boxes, box] })),
    }))
    return box
  },
  patchBox(fileId, i, id, patch) {
    set((s) => ({ files: mapPage(s.files, fileId, i, (p) => ({ ...p, boxes: p.boxes.map((b) => (b.id === id ? { ...b, ...patch } : b)) })) }))
  },
  removeBox(fileId, i, id) {
    set((s) => ({
      selectedBox: s.selectedBox === id ? null : s.selectedBox,
      files: mapPage(s.files, fileId, i, (p) => ({ ...p, boxes: p.boxes.filter((b) => b.id !== id) })),
    }))
  },
  clearBoxes(fileId, i) {
    set((s) => ({ selectedBox: null, files: mapPage(s.files, fileId, i, (p) => ({ ...p, boxes: [] })) }))
  },
  selectBox(selectedBox) {
    set({ selectedBox })
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

/** A page counts as read when it has a result from OCR or the PDF's own text. */
export const pageDone = (p: PageState) => p.status === 'done' && !!p.result
export const pagesDone = (f: FileEntry) => f.pages.filter(pageDone).length
export const fileName = (f: FileEntry) => f.path.split('/').pop() || f.path

/**
 * Character range of line `i` in the page text (rows joined by newlines, lines in
 * a row by spaces), or null if the user has edited the text.
 */
export function lineRange(p: PageState, i: number): [number, number] | null {
  const r = p.result
  if (!r || p.edited !== undefined || !r.lines[i]) return null
  let pos = 0
  for (let k = 0; k < i; k++) pos += r.lines[k].text.length + 1 // +1: the space or newline after it
  return [pos, pos + r.lines[i].text.length]
}

/** The text a page currently shows: the user's edit, else the result. */
/** What the results panel shows and edits: the user's text, else the Markdown (document mode), else the text. */
export const pageText = (p: PageState) => p.edited ?? p.result?.markdown ?? p.result?.text ?? ''
export const boxText = (b: RegionBox) => b.edited ?? b.result?.text ?? ''
