// SPDX-License-Identifier: Apache-2.0
// Derived from runtime/line_engine.py in iapp/OpenThai2.0-OCR-Text
// (https://huggingface.co/iapp/OpenThai2.0-OCR-Text), Copyright (c) iApp Technology,
// licensed under the Apache License 2.0. Ported to TypeScript and modified by the
// FreeThaiOCR contributors. See NOTICE.
// CTC line recognizer: LineOCR.prep_crop, recognize_detail and _ctc_detail.
import type { Mat } from '@techstark/opencv-js'
import type { OcrConfig } from './config'
import type { CvOps } from './cvops'
import { searchsorted } from './geom'
import type { InferenceModel } from './model'

/** (char, x0, x1, prob): x0..x1 is the share of the crop width the char was read from. */
export type CharSpan = [string, number, number, number]
export interface RecResult {
  text: string
  conf: number
  chars: CharSpan[] | null
}

export class Recognizer {
  private ops: CvOps
  private model: InferenceModel
  private cfg: OcrConfig['rec']
  /** CTC classes: 0 = blank, then the dictionary, then a space. */
  private chars: string[]

  constructor(ops: CvOps, model: InferenceModel, cfg: OcrConfig['rec'], chars: string[]) {
    this.ops = ops
    this.model = model
    this.cfg = cfg
    this.chars = chars
  }

  static charsFromDict(dictText: string): string[] {
    return ['', ...dictText.split('\n').filter((c) => c), ' ']
  }

  /** What a crop looks like before recognition (the model was trained on grey lines). */
  private prepCrop(crop: Mat): Mat {
    const ops = this.ops
    const mode = this.cfg.color
    if (mode === 'bgr' || crop.channels() !== 3 || crop.rows * crop.cols === 0) return crop.clone()
    const g = ops.gray(crop)
    try {
      if (mode === 'gray') return ops.grayToBgr(g)
      if (mode === 'flatten') {
        const f = ops.flatten(g)
        const out = ops.grayToBgr(f)
        f.delete()
        return out
      }
      // Levels from a 256-bin histogram.
      const px: Uint8Array = g.data
      const c = new Float64Array(256)
      for (const v of px) c[v]++
      for (let i = 1; i < 256; i++) c[i] += c[i - 1]
      const [lo, med, hi] = [0.02, 0.5, 0.98].map((q) => searchsorted(c, q * c[255]))
      let lut = Array.from({ length: 256 }, (_, i) => i)
      if (mode === 'stretch' && hi - lo >= 16) lut = lut.map((v) => Math.min(Math.max((v - lo) * (255 / (hi - lo)), 0), 255))
      if (lut[med] < 128) lut = lut.map((v) => 255 - v) // dark background = light text
      const mapped = g.clone()
      const m: Uint8Array = mapped.data
      for (let i = 0; i < m.length; i++) m[i] = Math.trunc(lut[m[i]])
      const out = ops.grayToBgr(mapped)
      mapped.delete()
      return out
    } finally {
      g.delete()
    }
  }

  /** Recognise crops (BGR Mats, not consumed). Batches by aspect ratio as the reference does. */
  async recognizeDetail(input: Mat[]): Promise<RecResult[]> {
    const ops = this.ops
    const H = Math.trunc(this.cfg.height)
    const maxW = Math.trunc(this.cfg.max_w)
    const bs = Math.trunc(this.cfg.batch)
    let crops: Mat[]
    if (this.cfg.color === 'flatten') {
      // Cheaper at the recognizer's height: resize first, then flatten.
      crops = input.map((cr) => {
        const r = ops.resize(cr, Math.max(1, Math.ceil((H * cr.cols) / Math.max(cr.rows, 1))), H)
        const p = this.prepCrop(r)
        r.delete()
        return p
      })
    } else {
      crops = input.map((cr) => this.prepCrop(cr))
    }
    try {
      const ratios = crops.map((cr) => cr.cols / Math.max(cr.rows, 1))
      const out: RecResult[] = crops.map(() => ({ text: '', conf: 0, chars: [] }))
      const order = ratios.map((_, i) => i).sort((a, b) => ratios[a] - ratios[b])
      for (let b = 0; b < order.length; b += bs) {
        const idx = order.slice(b, b + bs)
        const W = Math.min(maxW, Math.max(16, Math.ceil(H * Math.max(...idx.map((i) => ratios[i])))))
        const plane = H * W
        const batch = new Float32Array(idx.length * 3 * plane) // 0 = mid-grey after normalising
        const widths: number[] = []
        idx.forEach((i, n) => {
          const rw = Math.min(W, Math.max(1, Math.ceil(H * ratios[i])))
          widths.push(rw)
          const im = ops.resize(crops[i], rw, H)
          const px: Uint8Array = im.data
          for (let c = 0; c < 3; c++) {
            const base = (n * 3 + c) * plane
            for (let y = 0; y < H; y++) {
              for (let x = 0; x < rw; x++) {
                const v = Math.fround(px[(y * rw + x) * 3 + c] / 255)
                batch[base + y * W + x] = Math.fround(Math.fround(v - 0.5) / 0.5)
              }
            }
          }
          im.delete()
        })
        const probs = await this.model.run(batch, [idx.length, 3, H, W])
        const [, T, C] = probs.dims
        idx.forEach((i, n) => {
          out[i] = this.ctcDetail(probs.data.subarray(n * T * C, (n + 1) * T * C), T, C, W / T, widths[n])
        })
      }
      return out
    } finally {
      for (const c of crops) c.delete()
    }
  }

  async recognize(crops: Mat[]): Promise<{ text: string; conf: number }[]> {
    return (await this.recognizeDetail(crops)).map(({ text, conf }) => ({ text, conf }))
  }

  /** Greedy CTC decode with the frame span of each emitted character. */
  private ctcDetail(p: Float32Array, T: number, C: number, stride: number, width: number): RecResult {
    const ids = new Int32Array(T)
    const conf = new Float32Array(T)
    for (let t = 0; t < T; t++) {
      let best = 0
      let bv = p[t * C]
      for (let c = 1; c < C; c++) {
        const v = p[t * C + c]
        if (v > bv) {
          bv = v
          best = c
        }
      }
      ids[t] = best
      conf[t] = bv
    }
    const chars: CharSpan[] = []
    let t = 0
    while (t < T) {
      let end = t + 1
      while (end < T && ids[end] === ids[t]) end++
      if (ids[t] !== 0) {
        const ch = ids[t] < this.chars.length ? this.chars[ids[t]] : ''
        chars.push([ch, Math.min(1, (t * stride) / width), Math.min(1, (end * stride) / width), conf[t]])
      }
      t = end
    }
    const text = chars.map((c) => c[0]).join('')
    const conf_ = chars.length ? chars.reduce((a, c) => a + c[3], 0) / chars.length : 0
    return { text, conf: conf_, chars }
  }
}
