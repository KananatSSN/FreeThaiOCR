// SPDX-License-Identifier: Apache-2.0
// Derived from aksonocr_lite/det.py in Remtir/AksonOCR-Lite (https://github.com/Remtir/AksonOCR-Lite),
// Copyright (c) 2026 Teetouch Jaknamon, licensed under the Apache License 2.0, whose DB post-processing
// follows PaddleX (Copyright (c) 2024 PaddlePaddle Authors, Apache-2.0). Ported to TypeScript and
// modified by the FreeThaiOCR contributors. See NOTICE.
// Text-line detection: PP-OCRv6_medium_det (DB), Thai mark-fragment filter.
import ClipperLib from 'clipper-lib'
import type { Mat } from '@techstark/opencv-js'
import type { CvOps } from '../cvops'
import { boxScore } from '../detect'
import { type Pt, pyRound, type Quad } from '../geom'
import type { InferenceModel } from '../model'

const MEAN = [0.485, 0.456, 0.406]
const STD = [0.229, 0.224, 0.225]

export interface DetOptions {
  limitSideLen: number
  thresh: number
  boxThresh: number
  maxCandidates: number
  maxSideLimit: number
}
export const DET_DEFAULTS: DetOptions = { limitSideLen: 1280, thresh: 0.3, boxThresh: 0.3, maxCandidates: 3000, maxSideLimit: 4000 }

/** _mini_box: min-area rectangle, corners sorted by x then paired top/bottom; and its short side. */
function miniBox(ops: CvOps, contour: Mat): [Quad, number] {
  const cv = ops.cv
  const rect = cv.minAreaRect(contour)
  // Python's sorted() is stable: equal x keeps boxPoints order.
  const p = (cv.RotatedRect.points(rect) as { x: number; y: number }[]).map((q) => [q.x, q.y] as Pt).sort((a, b) => a[0] - b[0])
  const [i1, i4] = p[1][1] > p[0][1] ? [0, 1] : [1, 0]
  const [i2, i3] = p[3][1] > p[2][1] ? [2, 3] : [3, 2]
  return [[p[i1], p[i2], p[i3], p[i4]], Math.min(rect.size.width, rect.size.height)]
}

/** _unclip: grow by area * ratio / perimeter with pyclipper's defaults (float coordinates truncated). */
function unclip(box: Quad, ratio: number): Pt[] | null {
  let area = 0
  let length = 0
  for (let i = 0; i < 4; i++) {
    const a = box[i]
    const b = box[(i + 1) % 4]
    area += a[0] * b[1] - b[0] * a[1]
    length += Math.hypot(a[0] - b[0], a[1] - b[1])
  }
  area = Math.abs(area) / 2
  if (!length) return null
  const off = new ClipperLib.ClipperOffset(2, 0.25)
  off.AddPath(box.map(([x, y]) => ({ X: Math.trunc(x), Y: Math.trunc(y) })), ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon)
  const sol: { X: number; Y: number }[][] = []
  off.Execute(sol, (area * ratio) / length)
  if (!sol.length) return null
  // np.array(paths) merges several paths only when they have the same length; else the first is used.
  const paths = sol.every((s) => s.length === sol[0].length) ? sol : [sol[0]]
  return paths.flat().map((q) => [q.X, q.Y] as Pt)
}

/** PaddleOCR's sorted_boxes: top to bottom, then left to right within ~10 px rows. */
export function sortedBoxes(quads: Quad[]): Quad[] {
  const boxes = quads
    .map((b, i) => ({ b, i }))
    .sort((p, q) => p.b[0][1] - q.b[0][1] || p.b[0][0] - q.b[0][0] || p.i - q.i)
    .map((x) => x.b)
  for (let i = 0; i < boxes.length - 1; i++) {
    for (let j = i; j >= 0; j--) {
      if (Math.abs(boxes[j + 1][0][1] - boxes[j][0][1]) < 10 && boxes[j + 1][0][0] < boxes[j][0][0]) {
        ;[boxes[j], boxes[j + 1]] = [boxes[j + 1], boxes[j]]
      } else break
    }
  }
  return boxes
}

type Rect = [number, number, number, number]
const rectOf = (q: Quad): Rect => [Math.min(...q.map((p) => p[0])), Math.min(...q.map((p) => p[1])), Math.max(...q.map((p) => p[0])), Math.max(...q.map((p) => p[1]))]
const polyArea = (q: Quad) => Math.abs(q.reduce((a, p, i) => a + p[0] * q[(i + 1) % q.length][1] - q[(i + 1) % q.length][0] * p[1], 0)) / 2

/**
 * drop_mark_fragments: boxes around a lone Thai vowel or tone mark next to or inside a real line
 * (short, much smaller than that line, over it, centred near its top or bottom edge).
 */
export function dropMarkFragments(quads: Quad[]): Quad[] {
  const rects = quads.map(rectOf)
  const hs = rects.filter((r) => r[2] - r[0] >= 1.5 * (r[3] - r[1])).map((r) => r[3] - r[1]).sort((a, b) => a - b)
  const medH = hs.length ? hs[hs.length >> 1] : null
  const boxy = quads.map((q, i) => polyArea(q) >= 0.7 * Math.max((rects[i][2] - rects[i][0]) * (rects[i][3] - rects[i][1]), 1.0))
  const keep: Quad[] = []
  rects.forEach(([x0, y0, x1, y1], i) => {
    const w = Math.max(x1 - x0, 1.0)
    const h = Math.max(y1 - y0, 1.0)
    if (medH !== null && h >= 0.5 * medH) {
      keep.push(quads[i])
      return
    }
    const cy = (y0 + y1) / 2
    let frag = false
    for (let j = 0; j < rects.length; j++) {
      if (i === j || !boxy[j]) continue
      const [X0, Y0, X1, Y1] = rects[j]
      const W = X1 - X0
      const H = Y1 - Y0
      if (h > 0.55 * H || w > 0.5 * W) continue
      const ix = Math.max(0, Math.min(x1, X1) - Math.max(x0, X0))
      if (ix < 0.8 * w) continue
      const iy = Math.max(0, Math.min(y1, Y1) - Math.max(y0, Y0))
      const near = (Y0 - 0.8 * H <= cy && cy <= Y0 + 0.3 * H) || (Y1 - 0.3 * H <= cy && cy <= Y1 + 0.8 * H)
      if (near || ix * iy >= 0.6 * w * h) {
        frag = true
        break
      }
    }
    if (!frag) keep.push(quads[i])
  })
  return keep
}

/** BGR page -> text-line quads (integer corners, clockwise from top-left), sorted, mark fragments dropped. */
export async function detectLines(ops: CvOps, model: InferenceModel, input: Mat, unclipRatio: number, o: DetOptions = DET_DEFAULTS): Promise<Quad[]> {
  const cv = ops.cv
  // Not ops.scoped: that frees its Mats when the callback returns, before an async one has finished.
  const owned: { delete(): void }[] = []
  const keep = <M extends { delete(): void }>(m: M) => (owned.push(m), m)
  try {
    let img = input
    const h: number = img.rows
    const w: number = img.cols
    if (h + w < 64) {
      const pad = keep(cv.Mat.zeros(Math.max(32, h), Math.max(32, w), cv.CV_8UC3))
      img.copyTo(pad.roi(new cv.Rect(0, 0, w, h)))
      img = pad
    }
    // _resize (limit_type "max"): shrink only, cap the long side, round to multiples of 32.
    const ih: number = img.rows
    const iw: number = img.cols
    const ratio = Math.max(ih, iw) > o.limitSideLen ? o.limitSideLen / Math.max(ih, iw) : 1.0
    let rh = Math.trunc(ih * ratio)
    let rw = Math.trunc(iw * ratio)
    if (Math.max(rh, rw) > o.maxSideLimit) {
      const r2 = o.maxSideLimit / Math.max(rh, rw)
      rh = Math.trunc(rh * r2)
      rw = Math.trunc(rw * r2)
    }
    rh = Math.max(pyRound(rh / 32) * 32, 32)
    rw = Math.max(pyRound(rw / 32) * 32, 32)
    const x = rh === ih && rw === iw ? img : keep(ops.resize(img, rw, rh))
    const px: Uint8Array = x.data
    const plane = rh * rw
    const data = new Float32Array(3 * plane)
    for (let c = 0; c < 3; c++) {
      const mu = Math.fround(MEAN[c])
      const sd = Math.fround(STD[c])
      for (let i = 0; i < plane; i++) data[c * plane + i] = Math.fround(Math.fround(Math.fround(px[i * 3 + c] / 255) - mu) / sd)
    }
    const out = await model.run(data, [1, 3, rh, rw])
    const ph = out.dims[2]
    const pw = out.dims[3]
    const pred = out.data
    const bitmap = keep(new cv.Mat(ph, pw, cv.CV_8UC1))
    const bm: Uint8Array = bitmap.data
    for (let i = 0; i < ph * pw; i++) bm[i] = pred[i] > o.thresh ? 255 : 0
    const contours = keep(new cv.MatVector())
    cv.findContours(bitmap, contours, keep(new cv.Mat()), cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE)
    // Boxes map back to the size before padding (dest_w, dest_h), as in the reference.
    const sx = w / pw
    const sy = h / ph
    const quads: Quad[] = []
    const n = Math.min(contours.size(), o.maxCandidates)
    for (let k = 0; k < n; k++) {
      const cnt = contours.get(k)
      const [pts, side] = miniBox(ops, cnt)
      cnt.delete()
      if (side < 3) continue
      if (boxScore(ops, pred, ph, pw, pts) < o.boxThresh) continue
      const big = unclip(pts, unclipRatio)
      if (!big) continue
      const bigMat = cv.matFromArray(big.length, 1, cv.CV_32SC2, big.flat())
      const [box, side2] = miniBox(ops, bigMat)
      bigMat.delete()
      if (side2 < 5) continue
      // float32 corners times a Python float stay float32 in numpy 2, then np.round (half to even).
      const f32x = Math.fround(sx)
      const f32y = Math.fround(sy)
      quads.push(box.map(([bx, by]) => [Math.min(Math.max(pyRound(Math.fround(bx * f32x)), 0), w), Math.min(Math.max(pyRound(Math.fround(by * f32y)), 0), h)] as Pt))
    }
    return dropMarkFragments(sortedBoxes(quads))
  } finally {
    for (const m of owned) m.delete()
  }
}
