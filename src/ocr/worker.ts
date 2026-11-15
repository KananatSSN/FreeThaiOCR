/// <reference lib="webworker" />
// OCR worker: everything heavy (OpenCV.js, ONNX Runtime, the models) lives here
// and loads lazily on the first request, so the UI thread never blocks.
import * as Comlink from 'comlink'
import type * as OrtNS from 'onnxruntime-web'
import models from '../../models.json'
import type { LineOCR, OcrResult } from './engine'
import type { InferenceModel } from './model'

export type Backend = 'wasm' | 'webgpu'
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}
export type InitStage = 'runtime' | 'models' | 'ready'
export interface EngineInfo {
  backend: Backend
  threads: number
  isolated: boolean
}

const MODEL_BASE = `${import.meta.env.BASE_URL}models/${models.revision.slice(0, 7)}/`

let current: { backend: Backend; engine: Promise<{ engine: LineOCR; info: EngineInfo }> } | null = null

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

async function fetchBytes(name: string): Promise<Uint8Array> {
  const res = await fetch(MODEL_BASE + name)
  if (!res.ok) throw new Error(`Failed to load ${name}: HTTP ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}
const fetchText = async (name: string) => new TextDecoder().decode(await fetchBytes(name))

async function createEngine(backend: Backend, onStage?: (s: InitStage) => void) {
  onStage?.('runtime')
  const isolated = self.crossOriginIsolated === true
  const threads = isolated ? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1)) : 1
  const [ort, cv] = await Promise.all([loadOrt(backend), loadCv()])
  ort.env.wasm.numThreads = threads
  ort.env.logLevel = 'error'

  onStage?.('models')
  const [detBytes, recBytes, recDict, configJson, detYml] = await Promise.all([
    fetchBytes('det.onnx'),
    fetchBytes('rec.onnx'),
    fetchText('rec_dict.txt'),
    fetchText('config.json').then((t) => JSON.parse(t)),
    fetchText('det.yml'),
  ])
  const opts: OrtNS.InferenceSession.SessionOptions = {
    executionProviders: backend === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm'],
    graphOptimizationLevel: 'all',
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
    }
  }
  const [det, rec] = await Promise.all([wrap(detBytes), wrap(recBytes)])
  const { LineOCR } = await import('./engine')
  const engine = new LineOCR(cv, { det, rec, recDict, configJson, detYml })
  onStage?.('ready')
  return { engine, info: { backend, threads, isolated } }
}

function getEngine(backend: Backend, onStage?: (s: InitStage) => void) {
  if (!current || current.backend !== backend) {
    const engine = createEngine(backend, onStage)
    current = { backend, engine }
    // A failed load must not stick: let the next call retry.
    engine.catch(() => {
      if (current?.engine === engine) current = null
    })
  }
  return current.engine
}

/** Shift every box of a region result back into page coordinates. */
function offset(r: OcrResult, dx: number, dy: number): OcrResult {
  const mv = (b: [number, number][]) => b.map(([x, y]) => [x + dx, y + dy] as [number, number])
  return {
    ...r,
    lines: r.lines.map((l) => ({ ...l, box: mv(l.box), words: l.words?.map((w) => ({ ...w, box: mv(w.box) })) })),
    dropped: r.dropped.map((l) => ({ ...l, box: mv(l.box) })),
  }
}

const api = {
  async init(backend: Backend, onStage?: (s: InitStage) => void): Promise<EngineInfo> {
    return (await getEngine(backend, onStage)).info
  },

  /** OCR a whole page, or only `rect` of it (page pixel coordinates). */
  async recognize(backend: Backend, image: ImageBitmap, rect?: Rect): Promise<OcrResult> {
    const { engine } = await getEngine(backend)
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
    const mat = engine.ops.fromRGBA(data, w, h)
    try {
      const res = await engine.read(mat)
      return rect ? offset(res, x, y) : res
    } finally {
      mat.delete()
    }
  },
}

export type OcrWorkerApi = typeof api
Comlink.expose(api)
