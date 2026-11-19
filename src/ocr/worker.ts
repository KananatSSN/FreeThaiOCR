/// <reference lib="webworker" />
// OCR worker: everything heavy (OpenCV.js, ONNX Runtime, the models) lives here
// and loads lazily on the first request, so the UI thread never blocks.
// Two engines: OpenThai 2.1 (default) and AksonOCR-Lite (fp16), whose document mode
// (layout + tables) downloads its two large models only when first used.
import * as Comlink from 'comlink'
import type * as OrtNS from 'onnxruntime-web'
import type { AksonOCR, AksonResult } from './akson/page'
import type { LineOCR, OcrResult } from './engine'
import type { InferenceModel } from './model'
import { type ModelKey, modelFolder } from './modelPaths'

export type Backend = 'wasm' | 'webgpu'
export type EngineModel = ModelKey
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}
export type InitStage = 'runtime' | 'models' | 'document' | 'ready'
/** Download progress: 0..1, or null when the size is unknown. */
export type StageCallback = (stage: InitStage, progress?: number | null) => void
export interface EngineInfo {
  backend: Backend
  model: EngineModel
  threads: number
  isolated: boolean
}
export type RecognizeResult = OcrResult & Pick<AksonResult, 'markdown' | 'blocks'>

type Engine = { kind: 'openthai'; engine: LineOCR } | { kind: 'akson'; engine: AksonOCR }
let current: { key: string; engine: Promise<{ engine: Engine; info: EngineInfo }> } | null = null

async function loadOrt(backend: Backend): Promise<typeof OrtNS> {
  if (backend === 'webgpu') {
    const [ort, wasm, mjs] = await Promise.all([
      import('onnxruntime-web/webgpu'),
      import('onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url'),
      import('onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs?url'),
    ])
    ort.env.wasm.wasmPaths = { wasm: wasm.default, mjs: mjs.default }
    return ort
  }
  const [ort, wasm, mjs] = await Promise.all([
    import('onnxruntime-web/wasm'),
    import('onnxruntime-web/ort-wasm-simd-threaded.wasm?url'),
    import('onnxruntime-web/ort-wasm-simd-threaded.mjs?url'),
  ])
  ort.env.wasm.wasmPaths = { wasm: wasm.default, mjs: mjs.default }
  return ort
}

async function loadCv() {
  const { loadOpenCv } = await import('./opencvLoader')
  return (await loadOpenCv()).cv
}

const modelBase = (key: ModelKey) => `${import.meta.env.BASE_URL}models/${modelFolder(key)}/`

/**
 * Fetch several model files, reporting their combined progress. Content-Length is the
 * transfer size (possibly gzip), so the share is approximate and capped below 1.
 */
async function fetchFiles(key: ModelKey, names: string[], onProgress?: (p: number | null) => void): Promise<Uint8Array[]> {
  const totals = new Array<number>(names.length).fill(0)
  const loaded = new Array<number>(names.length).fill(0)
  const report = () => {
    if (!onProgress) return
    const t = totals.reduce((a, b) => a + b, 0)
    onProgress(totals.every((x) => x > 0) ? Math.min(0.99, loaded.reduce((a, b) => a + b, 0) / t) : null)
  }
  return Promise.all(
    names.map(async (name, i) => {
      const res = await fetch(modelBase(key) + name)
      if (!res.ok) throw new Error(`Failed to load ${name}: HTTP ${res.status}`)
      totals[i] = Number(res.headers.get('Content-Length')) || 0
      if (!res.body || !onProgress) return new Uint8Array(await res.arrayBuffer())
      const reader = res.body.getReader()
      const chunks: Uint8Array[] = []
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        loaded[i] += value.length
        report()
      }
      const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
      let o = 0
      for (const c of chunks) {
        out.set(c, o)
        o += c.length
      }
      return out
    }),
  )
}
const text = (b: Uint8Array) => new TextDecoder().decode(b)

async function createEngine(model: EngineModel, backend: Backend, onStage?: StageCallback): Promise<{ engine: Engine; info: EngineInfo }> {
  onStage?.('runtime')
  const isolated = self.crossOriginIsolated === true
  const threads = isolated ? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1)) : 1
  const [ort, cv] = await Promise.all([loadOrt(backend), loadCv()])
  ort.env.wasm.numThreads = threads
  ort.env.logLevel = 'error'

  const opts: OrtNS.InferenceSession.SessionOptions = {
    executionProviders: backend === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm'],
    graphOptimizationLevel: 'all',
    logSeverityLevel: 3, // the fp16 Akson models make ORT warn about unused initializers
  }
  const wrap = async (bytes: Uint8Array): Promise<InferenceModel> => {
    const s = await ort.InferenceSession.create(bytes, opts)
    const input = s.inputNames[0]
    const output = s.outputNames[0]
    return {
      async run(data, dims) {
        const feeds = { [input]: new ort.Tensor('float32', data, dims) }
        const out = await s.run(feeds)
        const t = out[output]
        // getData() downloads GPU tensors; for CPU tensors it returns the data as is.
        const res = { data: (await t.getData()) as Float32Array, dims: t.dims }
        feeds[input].dispose()
        return res
      },
      async runAll(named) {
        const feeds = Object.fromEntries(Object.entries(named).map(([k, v]) => [k, new ort.Tensor('float32', v.data, v.dims)]))
        const out = await s.run(feeds)
        const res = []
        for (const name of s.outputNames) {
          const t = out[name]
          res.push({ data: (await t.getData()) as Float32Array | Int32Array, dims: t.dims })
          t.dispose()
        }
        for (const t of Object.values(feeds)) t.dispose()
        return res
      },
    }
  }
  const info = { backend, model, threads, isolated }
  const progress = (stage: InitStage) => (p: number | null) => onStage?.(stage, p)

  if (model === 'akson') {
    onStage?.('models', null)
    const [det, rec, docOri, lineOri, charset] = await fetchFiles('akson', ['det.onnx', 'rec.onnx', 'doc_ori.onnx', 'textline_ori.onnx', 'rec_charset.json'], progress('models'))
    const sessions = await Promise.all([wrap(det), wrap(rec), wrap(docOri), wrap(lineOri)])
    const { AksonOCR } = await import('./akson/page')
    const engine = new AksonOCR(cv, {
      det: sessions[0],
      rec: sessions[1],
      docOri: sessions[2],
      lineOri: sessions[3],
      charset: JSON.parse(text(charset)),
      loadLayout: async () => {
        const [layout, tatr] = await fetchFiles('akson', ['layout.onnx', 'tatr.onnx'], (p) => documentProgress?.(p))
        return { layout: await wrap(layout), tatr: await wrap(tatr) }
      },
    })
    onStage?.('ready')
    return { engine: { kind: 'akson', engine }, info }
  }

  onStage?.('models', null)
  const [detBytes, recBytes, recDict, configBytes, detYml] = await fetchFiles('openthai', ['det.onnx', 'rec.onnx', 'rec_dict.txt', 'config.json', 'det.yml'], progress('models'))
  const configJson = JSON.parse(text(configBytes))
  const [det, rec] = await Promise.all([wrap(detBytes), wrap(recBytes)])
  const { LineOCR } = await import('./engine')
  // The loopless-font recognizer is fetched the first time a page needs it (a line read with
  // Latin letters inside Thai words), so most visitors never download it.
  const rec2File = (configJson as { rec2?: { file?: string } }).rec2?.file
  const loadRec2 = rec2File ? async () => wrap((await fetchFiles('openthai', [rec2File]))[0]) : undefined
  const engine = new LineOCR(cv, { det, rec, rec2: loadRec2, recDict: text(recDict), configJson, detYml: text(detYml) })
  onStage?.('ready')
  return { engine: { kind: 'openthai', engine }, info }
}

/** Where document-mode download progress goes while prepareDocument() runs. */
let documentProgress: ((p: number | null) => void) | null = null

function getEngine(model: EngineModel, backend: Backend, onStage?: StageCallback) {
  const key = `${model}:${backend}`
  if (!current || current.key !== key) {
    const engine = createEngine(model, backend, onStage)
    current = { key, engine }
    // A failed load must not stick: let the next call retry.
    engine.catch(() => {
      if (current?.engine === engine) current = null
    })
  }
  return current.engine
}

/** Shift every box of a region result back into page coordinates. */
function offset(r: RecognizeResult, dx: number, dy: number): RecognizeResult {
  const mv = (b: [number, number][]) => b.map(([x, y]) => [x + dx, y + dy] as [number, number])
  return {
    ...r,
    lines: r.lines.map((l) => ({ ...l, box: mv(l.box), words: l.words?.map((w) => ({ ...w, box: mv(w.box) })) })),
    dropped: r.dropped.map((l) => ({ ...l, box: mv(l.box) })),
    blocks: r.blocks?.map((b) => ({ ...b, box: mv(b.box) })),
  }
}

const api = {
  async init(model: EngineModel, backend: Backend, onStage?: StageCallback): Promise<EngineInfo> {
    return (await getEngine(model, backend, onStage)).info
  },

  /** Akson document mode: download the layout and table models now, reporting progress. */
  async prepareDocument(backend: Backend, onProgress?: (p: number | null) => void): Promise<void> {
    const { engine } = await getEngine('akson', backend)
    if (engine.kind !== 'akson') return
    documentProgress = onProgress ?? null
    try {
      await engine.engine.prepareDocument()
    } finally {
      documentProgress = null
    }
  },

  /** OCR a whole page, or only `rect` of it (page pixel coordinates). A drawn box is always read as text. */
  async recognize(model: EngineModel, backend: Backend, image: ImageBitmap, rect?: Rect, document = false): Promise<RecognizeResult> {
    const { engine } = await getEngine(model, backend)
    const x = rect ? Math.max(0, Math.floor(rect.x)) : 0
    const y = rect ? Math.max(0, Math.floor(rect.y)) : 0
    const w = rect ? Math.min(image.width - x, Math.ceil(rect.w)) : image.width
    const h = rect ? Math.min(image.height - y, Math.ceil(rect.h)) : image.height
    if (w < 2 || h < 2) throw new Error('Region is too small')
    const canvas = new OffscreenCanvas(w, h)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.fillStyle = '#fff' // transparent PNG areas read as white paper, not black
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(image, x, y, w, h, 0, 0, w, h)
    const { data } = ctx.getImageData(0, 0, w, h)
    const mat = engine.engine.ops.fromRGBA(data, w, h)
    try {
      const res: RecognizeResult = engine.kind === 'akson' ? await engine.engine.read(mat, { document: document && !rect }) : await engine.engine.read(mat)
      return rect ? offset(res, x, y) : res
    } finally {
      mat.delete()
    }
  },
}

export type OcrWorkerApi = typeof api
Comlink.expose(api)
