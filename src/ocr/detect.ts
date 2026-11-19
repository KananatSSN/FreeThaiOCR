// SPDX-License-Identifier: Apache-2.0
// Derived from runtime/line_engine.py in iapp/OpenThai2.1-OCR-Text-20261118
// (https://huggingface.co/iapp/OpenThai2.1-OCR-Text-20261118), Copyright (c) iApp Technology,
// licensed under the Apache License 2.0. Ported to TypeScript and modified by the
// FreeThaiOCR contributors. See NOTICE.
// DB text-line detector: LineOCR.detect, _detect_at and their helpers (_mini_box, _box_score, _unclip).
import ClipperLib from 'clipper-lib'
import type { Mat } from '@techstark/opencv-js'
import type { OcrConfig } from './config'
import type { CvOps } from './cvops'
import { dist, maxOf, minOf, orderPoints, type Pt, pyRound, type Quad, xs, ys } from './geom'
import { lineHeight } from './layout'
import type { InferenceModel } from './model'

const DET_MEAN = [0.485, 0.456, 0.406]
const DET_STD = [0.229, 0.224, 0.225]

/** _mini_box: min-area rectangle of a contour, corners ordered, and its short side. */
function miniBox(ops: CvOps, contour: Mat): [Quad, number] {
  const cv = ops.cv
  const rect = cv.minAreaRect(contour)
  const pts = (cv.RotatedRect.points(rect) as { x: number; y: number }[]).map((p) => [p.x, p.y] as Pt)
  return [orderPoints(pts), Math.min(rect.size.width, rect.size.height)]
}

/** _box_score: mean probability inside the box polygon. */
export function boxScore(ops: CvOps, prob: Float32Array, h: number, w: number, box: Quad): number {
  const cv = ops.cv
  const clip = (v: number, hi: number) => Math.min(Math.max(v, 0), hi)
  const x0 = clip(Math.floor(minOf(xs(box))), w - 1)
  const x1 = clip(Math.ceil(maxOf(xs(box))), w - 1)
  const y0 = clip(Math.floor(minOf(ys(box))), h - 1)
  const y1 = clip(Math.ceil(maxOf(ys(box))), h - 1)
  const mw = x1 - x0 + 1
  const mh = y1 - y0 + 1
  const mask = cv.Mat.zeros(mh, mw, cv.CV_8UC1)
  const poly = cv.matFromArray(4, 1, cv.CV_32SC2, box.flatMap(([x, y]) => [Math.trunc(x - x0), Math.trunc(y - y0)]))
  const polys = new cv.MatVector()
  polys.push_back(poly)
  cv.fillPoly(mask, polys, new cv.Scalar(1))
  const m: Uint8Array = mask.data
  let sum = 0
  let n = 0
  for (let y = 0; y < mh; y++) {
    const row = (y0 + y) * w + x0
    for (let x = 0; x < mw; x++) {
      if (m[y * mw + x]) {
        sum += prob[row + x]
        n++
      }
    }
  }
  mask.delete()
  poly.delete()
  polys.delete()
  return n ? sum / n : 0
}

/** _unclip: grow the box by area * ratio / perimeter (round joins), like pyclipper. */
function unclip(box: Quad, ratio: number): Pt[] | null {
  let area = 0
  let length = 0
  for (let i = 0; i < box.length; i++) {
    const a = box[i]
    const b = box[(i + 1) % box.length]
    area += a[0] * b[1] - b[0] * a[1]
    length += dist(a, b)
  }
  area = Math.abs(area) / 2
  if (length === 0) return null
  const off = new ClipperLib.ClipperOffset(2, 0.25)
  // pyclipper truncates float coordinates toward zero.
  off.AddPath(box.map(([x, y]) => ({ X: Math.trunc(x), Y: Math.trunc(y) })), ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon)
  const sol: { X: number; Y: number }[][] = []
  off.Execute(sol, (area * ratio) / length)
  return sol.length ? sol[0].map((p) => [p.X, p.Y] as Pt) : null
}

/** Detect, then (rescan_below) again at a larger size when the page's lines came out tiny at `limit`. */
export async function detect(ops: CvOps, model: InferenceModel, img: Mat, cfg: OcrConfig['det']): Promise<Quad[]> {
  let boxes = await detectAt(ops, model, img, cfg, cfg.limit)
  if (cfg.rescan_below && cfg.limit && boxes.length) {
    const H0: number = img.rows
    const W0: number = img.cols
    const pad = Math.max(8, Math.trunc(0.05 * Math.min(H0, W0)))
    const s = Math.min(cfg.limit / Math.max(H0 + 2 * pad, W0 + 2 * pad), 4.0)
    const hdet = lineHeight(boxes) * s // the page's line height at the detector's working size
    if (s < 1.0 && hdet < cfg.rescan_below) {
      const limit = Math.min(cfg.rescan_max, (cfg.limit * cfg.rescan_target) / Math.max(hdet, 1.0))
      if (limit > cfg.limit * 1.15) boxes = await detectAt(ops, model, img, cfg, limit)
    }
  }
  return boxes
}

async function detectAt(ops: CvOps, model: InferenceModel, img: Mat, cfg: OcrConfig['det'], limit: number): Promise<Quad[]> {
  const cv = ops.cv
  const H0: number = img.rows
  const W0: number = img.cols
  // A white border so text touching the edge still gets a closed region, then the
  // long side scaled to the working size in both directions (resize_long).
  const pad = Math.max(8, Math.trunc(0.05 * Math.min(H0, W0)))
  const padded = new cv.Mat()
  cv.copyMakeBorder(img, padded, pad, pad, pad, pad, cv.BORDER_CONSTANT, new cv.Scalar(255, 255, 255, 255))
  const h: number = padded.rows
  const w: number = padded.cols
  const s = limit ? Math.min(limit / Math.max(h, w), 4.0) : 1.0
  const rh = Math.max(32, pyRound((h * s) / 32) * 32)
  const rw = Math.max(32, pyRound((w * s) / 32) * 32)
  const resized = ops.resize(padded, rw, rh)
  padded.delete()

  // HWC BGR uint8 -> NCHW float, (x/255 - mean) / std per channel, in float32 like numpy.
  const px: Uint8Array = resized.data
  const plane = rh * rw
  const input = new Float32Array(3 * plane)
  for (let c = 0; c < 3; c++) {
    const mu = Math.fround(DET_MEAN[c])
    const sd = Math.fround(DET_STD[c])
    for (let i = 0; i < plane; i++) {
      input[c * plane + i] = Math.fround(Math.fround(Math.fround(px[i * 3 + c] / 255) - mu) / sd)
    }
  }
  resized.delete()

  const out = await model.run(input, [1, 3, rh, rw])
  const ph = out.dims[2]
  const pw = out.dims[3]
  const prob = out.data

  const bitmap = new cv.Mat(ph, pw, cv.CV_8UC1)
  const bm: Uint8Array = bitmap.data
  for (let i = 0; i < ph * pw; i++) bm[i] = prob[i] > cfg.thresh ? 1 : 0
  const contours = new cv.MatVector()
  const hierarchy = new cv.Mat()
  cv.findContours(bitmap, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE)
  bitmap.delete()
  hierarchy.delete()

  const sx = w / pw
  const sy = h / ph
  const boxes: Quad[] = []
  const n = Math.min(contours.size(), Math.trunc(cfg.max_candidates))
  for (let k = 0; k < n; k++) {
    const cnt = contours.get(k)
    let [box, side] = miniBox(ops, cnt)
    cnt.delete()
    if (side < cfg.min_size || boxScore(ops, prob, ph, pw, box) < cfg.box_thresh) continue
    const core = side
    const big = unclip(box, cfg.unclip)
    if (!big) continue
    const bigMat = cv.matFromArray(big.length, 1, cv.CV_32SC2, big.flat())
    ;[box, side] = miniBox(ops, bigMat)
    bigMat.delete()
    if (side < cfg.min_size + 2) continue
    // short_pad: DB's unclip margin is area * unclip / perimeter, so a short box (one word in a
    // table cell) gets less room above and below than a long line; grow it across the line.
    let grow = 0
    if (cfg.short_pad && dist(box[0], box[1]) >= dist(box[0], box[3])) grow = Math.max(0, cfg.short_pad * (1 + cfg.unclip) * core - side) / 2
    const clipX = (v: number) => Math.min(Math.max(v, 0), W0 - 1)
    const clipY = (v: number) => Math.min(Math.max(v, 0), H0 - 1)
    box = box.map(([x, y]) => [clipX(x * sx - pad), clipY(y * sy - pad)])
    if (grow > 0) {
      // Along the left edge's direction (top-left -> bottom-left).
      const vx = box[3][0] - box[0][0]
      const vy = box[3][1] - box[0][1]
      const f = (grow * sy) / Math.max(Math.hypot(vx, vy), 1e-6)
      const d: Pt = [vx * f, vy * f]
      box = box.map(([x, y], k) => (k < 2 ? [clipX(x - d[0]), clipY(y - d[1])] : [clipX(x + d[0]), clipY(y + d[1])]))
    }
    if (cfg.v_pad) {
      // Thai marks above/below the core band: grow height only.
      const hh = (Math.max(dist(box[0], box[3]), 1.0) * cfg.v_pad) / 2
      box[0][1] = Math.min(Math.max(box[0][1] - hh, 0), H0 - 1)
      box[1][1] = Math.min(Math.max(box[1][1] - hh, 0), H0 - 1)
      box[2][1] = Math.min(Math.max(box[2][1] + hh, 0), H0 - 1)
      box[3][1] = Math.min(Math.max(box[3][1] + hh, 0), H0 - 1)
    }
    if (maxOf(xs(box)) - minOf(xs(box)) >= 2 && maxOf(ys(box)) - minOf(ys(box)) >= 2) boxes.push(box)
  }
  contours.delete()
  return boxes
}
