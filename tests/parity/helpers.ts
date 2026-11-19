// Node-side harness: the same engine the browser runs, with onnxruntime-node
// in place of onnxruntime-web (the goldens came from ONNX Runtime CPU too).
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import * as ort from 'onnxruntime-node'
import { PNG } from 'pngjs'
import { LineOCR } from '../../src/ocr/engine'
import type { InferenceModel } from '../../src/ocr/model'

export const root = path.resolve(__dirname, '..', '..')
const manifest = JSON.parse(readFileSync(path.join(root, 'models.json'), 'utf8'))
const folder = (key: string) => `${key}-${manifest[key].revision ? manifest[key].revision.slice(0, 7) : 'local'}`
export const modelDir = (key = 'openthai') => path.join(root, 'public', 'models', folder(key))

export async function session(file: string, key = 'openthai'): Promise<InferenceModel> {
  const s = await ort.InferenceSession.create(path.join(modelDir(key), file), {
    intraOpNumThreads: 1,
    interOpNumThreads: 1,
    graphOptimizationLevel: 'all',
    logSeverityLevel: 3, // the converted models make ORT log unused-initializer warnings
  })
  const input = s.inputNames[0]
  return {
    async run(data, dims) {
      const out = await s.run({ [input]: new ort.Tensor('float32', data, dims) })
      const t = out[s.outputNames[0]]
      return { data: t.data as Float32Array, dims: t.dims }
    },
    async runAll(named) {
      const out = await s.run(Object.fromEntries(Object.entries(named).map(([k, v]) => [k, new ort.Tensor('float32', v.data, v.dims)])))
      return s.outputNames.map((n) => ({ data: out[n].data as Float32Array | Int32Array, dims: out[n].dims }))
    },
  }
}

let cached: Promise<{ engine: LineOCR; cv: any }> | undefined
export function loadEngine() {
  cached ??= (async () => {
    // The package exports a Promise that resolves to the module; require() avoids ESM interop wrapping it.
    const cv = await createRequire(import.meta.url)('@techstark/opencv-js')
    const engine = new LineOCR(cv, {
      det: await session('det.onnx'),
      rec: await session('rec.onnx'),
      rec2: await session('rec2.onnx'),
      recDict: readFileSync(path.join(modelDir(), 'rec_dict.txt'), 'utf8'),
      configJson: JSON.parse(readFileSync(path.join(modelDir(), 'config.json'), 'utf8')),
      detYml: readFileSync(path.join(modelDir(), 'det.yml'), 'utf8'),
    })
    return { engine, cv }
  })()
  return cached
}

export function loadPng(engine: LineOCR, file: string) {
  const png = PNG.sync.read(readFileSync(file))
  return engine.ops.fromRGBA(png.data, png.width, png.height)
}

/** Character error rate (Levenshtein over code points). */
export function cer(ref: string, hyp: string): number {
  const a = [...ref]
  const b = [...hyp]
  if (!a.length) return b.length ? 1 : 0
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[b.length] / a.length
}

type P = [number, number]
const bbox = (q: P[]) => [Math.min(...q.map((p) => p[0])), Math.min(...q.map((p) => p[1])), Math.max(...q.map((p) => p[0])), Math.max(...q.map((p) => p[1]))]
export function iou(a: P[], b: P[]): number {
  const [ax0, ay0, ax1, ay1] = bbox(a)
  const [bx0, by0, bx1, by1] = bbox(b)
  const iw = Math.max(0, Math.min(ax1, bx1) - Math.max(ax0, bx0))
  const ih = Math.max(0, Math.min(ay1, by1) - Math.max(ay0, by0))
  const inter = iw * ih
  return inter / ((ax1 - ax0) * (ay1 - ay0) + (bx1 - bx0) * (by1 - by0) - inter)
}

let akson: Promise<{ engine: import('../../src/ocr/akson/page').AksonOCR; cv: any }> | undefined
/** The AksonOCR-Lite port with every model loaded (layout and table models included). */
export function loadAkson() {
  akson ??= (async () => {
    const { cv } = await loadEngine()
    const { AksonOCR } = await import('../../src/ocr/akson/page')
    const s = (f: string) => session(f, 'akson')
    const engine = new AksonOCR(cv, {
      det: await s('det.onnx'),
      rec: await s('rec.onnx'),
      docOri: await s('doc_ori.onnx'),
      lineOri: await s('textline_ori.onnx'),
      charset: JSON.parse(readFileSync(path.join(modelDir('akson'), 'rec_charset.json'), 'utf8')),
      loadLayout: async () => ({ layout: await s('layout.onnx'), tatr: await s('tatr.onnx') }),
    })
    return { engine, cv }
  })()
  return akson
}
