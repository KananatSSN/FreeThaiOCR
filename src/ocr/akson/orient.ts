// SPDX-License-Identifier: Apache-2.0
// Derived from aksonocr_lite/orient.py in Remtir/AksonOCR-Lite (https://github.com/Remtir/AksonOCR-Lite),
// Copyright (c) 2026 Teetouch Jaknamon, licensed under the Apache License 2.0. Ported to TypeScript and
// modified by the FreeThaiOCR contributors. See NOTICE.
// Orientation classifiers: PP-LCNet_x1_0_doc_ori (page: 0/90/180/270) and textline_ori (line: 0/180).
import type { Mat } from '@techstark/opencv-js'
import type { CvOps } from '../cvops'
import { pyRound } from '../geom'
import type { InferenceModel } from '../model'

const MEAN = [0.485, 0.456, 0.406]
const STD = [0.229, 0.224, 0.225]
export type Angle = 0 | 90 | 180 | 270
const ANGLES: Angle[] = [0, 90, 180, 270]

/** HWC uint8 RGB (from a BGR Mat) -> CHW float, ImageNet-normalised, written at `offset`. */
function normRgbInto(ops: CvOps, bgr: Mat, out: Float32Array, offset: number) {
  const cv = ops.cv
  const rgb = new cv.Mat()
  cv.cvtColor(bgr, rgb, cv.COLOR_BGR2RGB)
  const px: Uint8Array = rgb.data
  const plane = rgb.rows * rgb.cols
  for (let c = 0; c < 3; c++) {
    const mu = Math.fround(MEAN[c])
    const sd = Math.fround(STD[c])
    for (let i = 0; i < plane; i++) out[offset + c * plane + i] = Math.fround(Math.fround(Math.fround(px[i * 3 + c] / 255) - mu) / sd)
  }
  rgb.delete()
}

/** rotate(): counter-clockwise by angle, like PIL's rotate(expand=True). New Mat (a clone for 0). */
export function rotateCcw(ops: CvOps, img: Mat, angle: Angle): Mat {
  if (angle === 0) return img.clone()
  return ops.rot90(img, angle === 90 ? 1 : angle === 180 ? 2 : -1)
}

export class PageOrientation {
  private ops: CvOps
  private model: InferenceModel
  constructor(ops: CvOps, model: InferenceModel) {
    this.ops = ops
    this.model = model
  }

  /** -> (label, score): label is the counter-clockwise rotation that makes the page upright. */
  async classify(img: Mat): Promise<[Angle, number]> {
    const cv = this.ops.cv
    const h: number = img.rows
    const w: number = img.cols
    const s = 256 / Math.min(h, w)
    const r = this.ops.resize(img, pyRound(w * s), pyRound(h * s))
    const y = (r.rows - 224) >> 1
    const x = (r.cols - 224) >> 1
    const crop = r.roi(new cv.Rect(x, y, 224, 224))
    const data = new Float32Array(3 * 224 * 224)
    const c = crop.clone()
    normRgbInto(this.ops, c, data, 0)
    c.delete()
    crop.delete()
    r.delete()
    const p = (await this.model.run(data, [1, 3, 224, 224])).data
    let k = 0
    for (let i = 1; i < 4; i++) if (p[i] > p[k]) k = i
    return [ANGLES[k], p[k]]
  }

  /**
   * Counter-clockwise rotation to apply. One pass when the classifier is confident; otherwise each
   * candidate rotation is scored by its "upright" probability, 90/270 settled first, then 0/180,
   * and an ambiguous page is left alone.
   */
  async angle(img: Mat, singlePassMin = 0.92, minConf = 0.85, margin = 0.05): Promise<Angle> {
    const probe = this.downscale(img, 1280)
    try {
      const [label, conf] = await this.classify(probe)
      if (conf >= singlePassMin) return label
      let scores = await this.uprightScores(probe)
      const side: Angle = scores[90] >= scores[270] ? 90 : 270
      let stage1: Angle = 0
      if (scores[side] >= minConf && scores[side] >= Math.max(scores[0], scores[180]) + margin) {
        stage1 = side
        const turned = rotateCcw(this.ops, probe, side)
        scores = await this.uprightScores(turned)
        turned.delete()
      }
      const flip = scores[180] >= scores[0] + margin && scores[180] >= minConf ? 180 : 0
      return ((stage1 + flip) % 360) as Angle
    } finally {
      probe.delete()
    }
  }

  private async uprightScores(img: Mat): Promise<Record<Angle, number>> {
    const out = {} as Record<Angle, number>
    for (const a of ANGLES) {
      const t = rotateCcw(this.ops, img, a)
      const [label, conf] = await this.classify(t)
      t.delete()
      out[a] = label === 0 ? conf : 0
    }
    return out
  }

  private downscale(img: Mat, maxSide: number): Mat {
    const h: number = img.rows
    const w: number = img.cols
    if (Math.max(h, w) <= maxSide) return img.clone()
    const s = maxSide / Math.max(h, w)
    return this.ops.resize(img, Math.max(1, Math.trunc(w * s)), Math.max(1, Math.trunc(h * s)), this.ops.cv.INTER_AREA)
  }
}

export class LineOrientation {
  private ops: CvOps
  private model: InferenceModel
  private batch: number
  constructor(ops: CvOps, model: InferenceModel, batch = 64) {
    this.ops = ops
    this.model = model
    this.batch = batch
  }

  /** -> true for crops classified as upside down. */
  async upsideDown(crops: Mat[]): Promise<boolean[]> {
    const out: boolean[] = []
    const plane = 3 * 80 * 160
    for (let i = 0; i < crops.length; i += this.batch) {
      const part = crops.slice(i, i + this.batch)
      const data = new Float32Array(part.length * plane)
      part.forEach((c, n) => {
        const r = this.ops.resize(c, 160, 80)
        normRgbInto(this.ops, r, data, n * plane)
        r.delete()
      })
      const p = (await this.model.run(data, [part.length, 3, 80, 160])).data
      for (let n = 0; n < part.length; n++) out.push(p[n * 2 + 1] > p[n * 2])
    }
    return out
  }
}
