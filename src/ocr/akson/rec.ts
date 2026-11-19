// SPDX-License-Identifier: Apache-2.0
// Derived from aksonocr_lite/rec.py in Remtir/AksonOCR-Lite (https://github.com/Remtir/AksonOCR-Lite),
// Copyright (c) 2026 Teetouch Jaknamon, licensed under the Apache License 2.0. Ported to TypeScript and
// modified by the FreeThaiOCR contributors. See NOTICE.
// Thai/English line recognizer: PP-OCRv6-tiny CTC whose classes are whole Thai grapheme clusters
// (a consonant with its vowel and tone marks is one token), so decoding is a lookup in rec_charset.json.
import type { Mat } from '@techstark/opencv-js'
import type { CvOps } from '../cvops'
import type { InferenceModel } from '../model'
import type { CharSpan } from '../recognize'

const H = 48
const MAX_W = 3200

export interface AksonRead {
  text: string
  conf: number
  /** Token positions as shares of the crop width; null when read turned (no positions along the box). */
  chars: CharSpan[] | null
}

export interface RecOptions {
  budget: number
  flip: boolean
  flipMargin: number
  bucket: number
}
export const REC_DEFAULTS: RecOptions = { budget: 3_000_000, flip: true, flipMargin: 0.05, bucket: 16 }

export class AksonRecognizer {
  private ops: CvOps
  private model: InferenceModel
  private chars: string[]
  private o: RecOptions

  constructor(ops: CvOps, model: InferenceModel, charsetJson: { chars: string[] }, o: RecOptions = REC_DEFAULTS) {
    this.ops = ops
    this.model = model
    this.chars = charsetJson.chars
    this.o = o
  }

  /**
   * BGR crops (not consumed) -> readings. Each crop is also read turned 180 degrees and the
   * reading with the better per-token log-confidence wins (upside-down lines on photos).
   */
  async read(crops: Mat[]): Promise<AksonRead[]> {
    if (!crops.length) return []
    if (!this.o.flip) return this.run(crops)
    const turned = crops.map((c) => this.ops.rot90(c, 2))
    try {
      const res = await this.run([...crops, ...turned])
      const n = crops.length
      const norm = (r: AksonRead) => Math.log(Math.max(r.conf, 1e-12)) / Math.max(1, [...r.text].length)
      return res.slice(0, n).map((a, i) => {
        const b = res[n + i]
        const useB = b.text && (!a.text || norm(b) > norm(a) + this.o.flipMargin)
        return useB ? { ...b, chars: null } : a
      })
    } finally {
      for (const m of turned) m.delete()
    }
  }

  /** _prep: height 48, width kept proportional (8..3200), RGB order as given (BGR), scaled to [-1, 1]. */
  private prep(img: Mat): { data: Float32Array; w: number } {
    const w0: number = img.cols
    const h0: number = img.rows
    const W = Math.min(MAX_W, Math.max(8, Math.ceil((H * w0) / Math.max(h0, 1))))
    const r = this.ops.resize(img, W, H)
    const px: Uint8Array = r.data
    const plane = H * W
    const data = new Float32Array(3 * plane)
    for (let c = 0; c < 3; c++) {
      for (let i = 0; i < plane; i++) data[c * plane + i] = Math.fround(Math.fround(Math.fround(px[i * 3 + c] / 255) - 0.5) / 0.5)
    }
    r.delete()
    return { data, w: W }
  }

  /** Batches only crops of the same bucketed width: right padding changes the SVTR neck's attention. */
  private async run(crops: Mat[]): Promise<AksonRead[]> {
    const xs = crops.map((c) => this.prep(c))
    const groups = new Map<number, number[]>()
    xs.forEach((x, i) => {
      const W = Math.ceil(x.w / this.o.bucket) * this.o.bucket
      groups.set(W, [...(groups.get(W) ?? []), i])
    })
    const out: AksonRead[] = xs.map(() => ({ text: '', conf: 0, chars: [] }))
    for (const [W, idx] of groups) {
      const step = Math.max(1, Math.floor(this.o.budget / (H * W)))
      for (let s = 0; s < idx.length; s += step) {
        const part = idx.slice(s, s + step)
        const plane = H * W
        const batch = new Float32Array(part.length * 3 * plane) // zero padding, as np.zeros
        part.forEach((k, t) => {
          const { data, w } = xs[k]
          for (let c = 0; c < 3; c++) {
            for (let y = 0; y < H; y++) {
              batch.set(data.subarray(c * H * w + y * w, c * H * w + (y + 1) * w), ((t * 3 + c) * H + y) * W)
            }
          }
        })
        const p = await this.model.run(batch, [part.length, 3, H, W])
        const [, T, C] = p.dims
        part.forEach((k, t) => {
          // Skip the timesteps over the padding.
          const Tk = Math.max(1, Math.ceil((xs[k].w / W) * T))
          out[k] = this.decode(p.data.subarray(t * T * C, (t + 1) * T * C), Tk, C, W / T, xs[k].w)
        })
      }
    }
    return out
  }

  /** Greedy CTC; confidence is the product of the kept tokens' probabilities (float32, like np.prod). */
  private decode(p: Float32Array, T: number, C: number, stride: number, width: number): AksonRead {
    let text = ''
    let conf = 1
    let any = false
    const chars: CharSpan[] = []
    let prev = 0
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
      if (best !== prev && best !== 0) {
        const ch = this.chars[best] ?? ''
        text += ch
        conf = Math.fround(conf * bv)
        any = true
        let end = t + 1
        while (end < T) {
          let b2 = 0
          let v2 = p[end * C]
          for (let c = 1; c < C; c++) {
            if (p[end * C + c] > v2) {
              v2 = p[end * C + c]
              b2 = c
            }
          }
          if (b2 !== best) break
          end++
        }
        chars.push([ch, Math.min(1, (t * stride) / width), Math.min(1, (end * stride) / width), bv])
      }
      prev = best
    }
    return { text, conf: any ? conf : 0, chars }
  }
}
