// SPDX-License-Identifier: Apache-2.0
// Derived from aksonocr_lite/layout.py and aksonocr_lite/_vendor/paddlex_layout.py in Remtir/AksonOCR-Lite
// (https://github.com/Remtir/AksonOCR-Lite), Copyright (c) 2026 Teetouch Jaknamon, whose post-processing is
// PaddleX's LayoutAnalysisProcess (Copyright (c) 2024 PaddlePaddle Authors); both under the Apache License
// 2.0. Ported to TypeScript and modified by the FreeThaiOCR contributors (clipper-lib in place of shapely).
// See NOTICE.
// Layout analysis: PP-DocLayoutV3 (RT-DETR with mask and reading-order heads) + PaddleX post-processing.
import ClipperLib from 'clipper-lib'
import type { Mat } from '@techstark/opencv-js'
import type { CvOps } from '../cvops'
import { type Pt, pyRound } from '../geom'
import type { InferenceModel } from '../model'

export const LABELS = [
  'abstract', 'algorithm', 'aside_text', 'chart', 'content', 'display_formula', 'doc_title',
  'figure_title', 'footer', 'footer_image', 'footnote', 'formula_number', 'header', 'header_image',
  'image', 'inline_formula', 'number', 'paragraph_title', 'reference', 'reference_content', 'seal',
  'table', 'text', 'vertical_text', 'vision_footnote',
]
const SIZE = 800
const SKIP_ORDER_LABELS = new Set([
  'figure_title', 'vision_footnote', 'image', 'chart', 'table', 'header', 'header_image', 'footer', 'footer_image', 'footnote', 'aside_text',
])

export interface LayoutBlock {
  label: string
  score: number
  /** x0, y0, x1, y1 in page pixels. */
  bbox: [number, number, number, number]
  /** Reading order (filled in for labels the model leaves unordered). */
  order: number
}

type Row = number[] // cls, score, x0, y0, x1, y1, order
type Poly = Pt[]

// --- polygon geometry (shapely's Polygon area / intersection / union, via clipper) ----------------
const SCALE = 1000 // clipper works on integers
const toPath = (p: Poly) => p.map(([x, y]) => ({ X: Math.round(x * SCALE), Y: Math.round(y * SCALE) }))
const pathsArea = (paths: { X: number; Y: number }[][]) => paths.reduce((a, q) => a + ClipperLib.Clipper.Area(q), 0) / (SCALE * SCALE)

/** make_valid (buffer(0)): self-intersections resolved by the non-zero rule. */
function valid(p: Poly) {
  const sol = ClipperLib.Clipper.SimplifyPolygon(toPath(p), ClipperLib.PolyFillType.pftNonZero)
  return { paths: sol, area: Math.abs(pathsArea(sol)) }
}

/** calculate_polygon_overlap_ratio. */
export function polyOverlap(a: Poly, b: Poly, mode: 'union' | 'small'): number {
  const A = valid(a)
  const B = valid(b)
  const c = new ClipperLib.Clipper()
  c.AddPaths(A.paths, ClipperLib.PolyType.ptSubject, true)
  c.AddPaths(B.paths, ClipperLib.PolyType.ptClip, true)
  const sol: { X: number; Y: number }[][] = []
  c.Execute(ClipperLib.ClipType.ctIntersection, sol, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero)
  const inter = Math.abs(pathsArea(sol))
  if (mode === 'union') return inter / (A.area + B.area - inter)
  return inter / Math.min(A.area, B.area)
}

// --- PaddleX helpers ------------------------------------------------------------------------------
/** iou() of PaddleX NMS: pixel-inclusive (+1) areas. */
function iouPx(a: number[], b: number[]) {
  const iw = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]) + 1)
  const ih = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]) + 1)
  const inter = iw * ih
  return inter / ((a[2] - a[0] + 1) * (a[3] - a[1] + 1) + (b[2] - b[0] + 1) * (b[3] - b[1] + 1) - inter)
}

function nms(rows: Row[], iouSame: number, iouDiff: number): number[] {
  // np.argsort(scores)[::-1]: highest score first (ties: later index first).
  let indices = rows.map((_, i) => i).sort((p, q) => rows[p][1] - rows[q][1] || p - q).reverse()
  const selected: number[] = []
  while (indices.length) {
    const cur = indices[0]
    selected.push(cur)
    indices = indices.slice(1).filter((i) => iouPx(rows[cur].slice(2, 6), rows[i].slice(2, 6)) < (rows[cur][0] === rows[i][0] ? iouSame : iouDiff))
  }
  return selected
}

function isContained(a: Row, b: Row) {
  const area = (a[4] - a[2]) * (a[5] - a[3])
  const inter = Math.max(0, Math.min(a[4], b[4]) - Math.max(a[2], b[2])) * Math.max(0, Math.min(a[5], b[5]) - Math.max(a[3], b[3]))
  return (area > 0 ? inter / area : 0) >= 0.9
}

const rectFromBox = (b: number[]): Poly => {
  const [x0, y0, x1, y1] = b.map(Math.trunc)
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
}

function cvPoints(m: Mat): Pt[] {
  const d: Int32Array = m.data32S
  const out: Pt[] = []
  for (let i = 0; i < d.length; i += 2) out.push([d[i], d[i + 1]])
  return out
}

const norm = (v: Pt) => Math.hypot(v[0], v[1])

/** extract_custom_vertices: keep convex corners (and runs of wide concave ones), fill long edges. */
function customVertices(poly: Pt[], maxAllowed: number, sharpAngle = 45, maxDistRatio = 0.3): Pt[] {
  const n = poly.length
  const maxDist = maxAllowed * maxDistRatio
  const info = poly.map((pc, i) => {
    const pp = poly[(i - 1 + n) % n]
    const pn = poly[(i + 1) % n]
    const v1: Pt = [pp[0] - pc[0], pp[1] - pc[1]]
    const v2: Pt = [pn[0] - pc[0], pn[1] - pc[1]]
    const a: Pt = [pc[0] - pp[0], pc[1] - pp[1]]
    const convex = a[0] * v2[1] - a[1] * v2[0] < 0
    const dot = Math.min(1, Math.max(-1, (v1[0] / norm(v1)) * (v2[0] / norm(v2)) + (v1[1] / norm(v1)) * (v2[1] / norm(v2))))
    return { convex, angle: (Math.acos(dot) * 180) / Math.PI, v1, v2 }
  })
  const concave = info.map((x, i) => (x.convex ? -1 : i)).filter((i) => i >= 0)
  const preserve = new Set<number>()
  if (concave.length) {
    const groups: number[] = []
    let cur = [concave[0]]
    for (let i = 1; i < concave.length; i++) {
      if (concave[i] - concave[i - 1] === 1 || (concave[i - 1] === n - 1 && concave[i] === 0)) cur.push(concave[i])
      else {
        if (cur.length >= 2) groups.push(...cur)
        cur = [concave[i]]
      }
    }
    if (cur.length >= 2) groups.push(...cur)
    if (concave.length >= 2 && concave[0] === 0 && concave[concave.length - 1] === n - 1) {
      if (groups.includes(0) && groups.includes(n - 1)) groups.forEach((g) => preserve.add(g))
    } else groups.forEach((g) => preserve.add(g))
  }
  const kept = info.map((x, i) => (x.convex || (preserve.has(i) && x.angle >= 120) ? i : -1)).filter((i) => i >= 0)
  const finalPts: number[] = []
  for (let k = 0; k < kept.length; k++) {
    const ci = kept[k]
    const ni = kept[(k + 1) % kept.length]
    finalPts.push(ci)
    const d = norm([poly[ci][0] - poly[ni][0], poly[ci][1] - poly[ni][1]])
    if (d > maxDist) {
      const mid: number[] = []
      if (ni > ci) for (let i = ci + 1; i < ni; i++) mid.push(i)
      else {
        for (let i = ci + 1; i < n; i++) mid.push(i)
        for (let i = 0; i < ni; i++) mid.push(i)
      }
      if (mid.length) {
        const need = Math.ceil(d / maxDist) - 1
        if (mid.length <= need) finalPts.push(...mid)
        else {
          const step = mid.length / need
          for (let i = 0; i < need; i++) finalPts.push(mid[Math.trunc(i * step)])
        }
      }
    }
  }
  return [...new Set(finalPts)]
    .sort((a, b) => a - b)
    .map((i) => {
      const x = info[i]
      const p = poly[i]
      if (x.convex && Math.abs(x.angle - sharpAngle) < 1) {
        const u1: Pt = [x.v1[0] / norm(x.v1), x.v1[1] / norm(x.v1)]
        const u2: Pt = [x.v2[0] / norm(x.v2), x.v2[1] / norm(x.v2)]
        let dir: Pt = [u1[0] + u2[0], u1[1] + u2[1]]
        dir = [dir[0] / norm(dir), dir[1] / norm(dir)]
        const dd = (norm(x.v1) + norm(x.v2)) / 2
        return [p[0] + dir[0] * dd, p[1] + dir[1] * dd] as Pt
      }
      return [p[0], p[1]] as Pt
    })
}

/** mask2polygon: largest outer contour, simplified (approxPolyDP), then customVertices. */
function maskPolygon(ops: CvOps, mask: Mat, maxAllowed: number): Pt[] | null {
  const cv = ops.cv
  const cnts = new cv.MatVector()
  const hier = new cv.Mat()
  cv.findContours(mask, cnts, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)
  hier.delete()
  try {
    if (!cnts.size()) return null
    let best = 0
    let bestArea = -Infinity
    for (let i = 0; i < cnts.size(); i++) {
      const c = cnts.get(i)
      const a = cv.contourArea(c)
      c.delete()
      if (a > bestArea) {
        bestArea = a
        best = i
      }
    }
    const cnt = cnts.get(best)
    const approx = new cv.Mat()
    cv.approxPolyDP(cnt, approx, 0.004 * cv.arcLength(cnt, true), true)
    const pts = cvPoints(approx)
    cnt.delete()
    approx.delete()
    return customVertices(pts, maxAllowed)
  } finally {
    cnts.delete()
  }
}

/** convert_polygon_to_quad: min-area rectangle, corners by angle around the centre, top-left first. */
function polygonToQuad(ops: CvOps, poly: Poly): Poly | null {
  if (poly.length < 3) return null
  const cv = ops.cv
  const m = cv.matFromArray(poly.length, 1, cv.CV_32FC2, poly.flat().map(Math.fround))
  const rect = cv.minAreaRect(m)
  m.delete()
  let q = (cv.RotatedRect.points(rect) as { x: number; y: number }[]).map((p) => [p.x, p.y] as Pt)
  const cx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4
  const cy = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4
  q = q.map((p, i) => ({ p, i, a: Math.atan2(p[1] - cy, p[0] - cx) })).sort((u, v) => u.a - v.a || u.i - v.i).map((x) => x.p)
  let tl = 0
  for (let i = 1; i < 4; i++) if (q[i][0] + q[i][1] < q[tl][0] + q[tl][1]) tl = i
  return [...q.slice(tl), ...q.slice(0, tl)]
}

/** _normalize_layout_polygon, "auto": the rectangle, its quad, or the polygon itself. */
function normalizePolygon(ops: CvOps, box: number[], poly: Poly | null, prev: Poly | null): Poly {
  const rect = rectFromBox(box)
  if (!poly || poly.length < 4) return rect
  const p = poly.map(([x, y]) => [Math.fround(x), Math.fround(y)] as Pt)
  const quad = polygonToQuad(ops, p)
  if (quad) {
    if (polyOverlap(rect, quad, 'union') >= 0.95) return rect
    const pq = polyOverlap(p, quad, 'union')
    const pre = prev ? polyOverlap(prev, rect, 'small') : 0
    if (pq >= 0.8 && pre < 0.01) return quad
  }
  return p
}

function polygonsFromMasks(ops: CvOps, rows: Row[], masks: Int32Array, hm: number, wm: number, imgW: number, imgH: number, maskIdx: number[]): Poly[] {
  const cv = ops.cv
  const sw = SIZE / imgW / 4
  const sh = SIZE / imgH / 4
  const maxBoxW = Math.max(...rows.map((r) => r[4] - r[3])) // sic: PaddleX subtracts ymin from xmax
  const out: Poly[] = []
  rows.forEach((r, i) => {
    const [x0, y0, x1, y1] = r.slice(2, 6).map(Math.trunc)
    const bw = x1 - x0
    const bh = y1 - y0
    const rect = rectFromBox(r.slice(2, 6))
    if (bw <= 0 || bh <= 0) {
      out.push(rect)
      return
    }
    const clip = (v: number, hi: number) => Math.min(Math.max(v, 0), hi)
    const xs = [clip(pyRound(x0 * sw), wm), clip(pyRound(x1 * sw), wm)]
    const ys = [clip(pyRound(y0 * sh), hm), clip(pyRound(y1 * sh), hm)]
    const cw = xs[1] - xs[0]
    const ch = ys[1] - ys[0]
    const base = maskIdx[i] * hm * wm
    let sum = 0
    const crop = cw > 0 && ch > 0 ? new cv.Mat(ch, cw, cv.CV_8UC1) : null
    if (crop) {
      const d: Uint8Array = crop.data
      for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
          const v = masks[base + (ys[0] + y) * wm + xs[0] + x]
          d[y * cw + x] = v & 0xff
          sum += v
        }
      }
    }
    if (!crop || sum === 0) {
      crop?.delete()
      out.push(rect)
      return
    }
    const resized = ops.resize(crop, bw, bh, cv.INTER_NEAREST)
    crop.delete()
    const maxAllowed = bw > maxBoxW * 0.6 ? bw : maxBoxW
    let poly = maskPolygon(ops, resized, maxAllowed)
    resized.delete()
    if (poly && poly.length) poly = poly.map(([x, y]) => [x + x0, y + y0] as Pt)
    out.push(normalizePolygon(ops, r.slice(2, 6), poly, out.length ? out[out.length - 1] : null))
  })
  return out
}

interface Box {
  label: string
  score: number
  coordinate: [number, number, number, number]
  polygon: Poly
  order: number | null
}

/** filter_boxes: drop tiny boxes and the smaller of two that overlap > 70 % (polygons must agree). */
function filterBoxes(src: Box[]): Box[] {
  const boxes = src.filter((b) => b.label !== 'reference')
  const dropped = new Set<number>()
  const area = (c: number[]) => Math.abs((c[2] - c[0]) * (c[3] - c[1]))
  const overlapSmall = (a: number[], b: number[]) => {
    const inter = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]))
    const ref = Math.min(area(a), area(b))
    return ref === 0 ? 0 : inter / ref
  }
  for (let i = 0; i < boxes.length; i++) {
    const [x1, y1, x2, y2] = boxes[i].coordinate
    if (x2 - x1 < 6 || y2 - y1 < 6) dropped.add(i)
    for (let j = i + 1; j < boxes.length; j++) {
      if (dropped.has(i) || dropped.has(j)) continue
      const r = overlapSmall(boxes[i].coordinate, boxes[j].coordinate)
      const li = boxes[i].label
      const lj = boxes[j].label
      if (li === 'inline_formula' || lj === 'inline_formula') {
        if (r > 0.5) {
          if (li === 'inline_formula') dropped.add(i)
          if (lj === 'inline_formula') dropped.add(j)
          continue
        }
      }
      if (r > 0.7) {
        if (polyOverlap(boxes[i].polygon, boxes[j].polygon, 'small') < 0.7) continue
        const labels = new Set([li, lj])
        const visual = ['image', 'table', 'seal', 'chart']
        if (visual.some((l) => labels.has(l)) && labels.size > 1) {
          if (!labels.has('table') || [...labels].every((l) => visual.includes(l))) continue
        }
        if (area(boxes[i].coordinate) >= area(boxes[j].coordinate)) dropped.add(j)
        else dropped.add(i)
      }
    }
  }
  return boxes.filter((_, i) => !dropped.has(i))
}

/** fill_missing_order: unordered blocks go between the ordered blocks above and below them. */
function fillMissingOrder(blocks: (Omit<LayoutBlock, 'order'> & { order: number | null })[]): void {
  const ordered = blocks.filter((b) => b.order !== null) as LayoutBlock[]
  const real = [...ordered]
  const unordered = blocks
    .map((b, i) => ({ b, i }))
    .filter((x) => x.b.order === null)
    .sort((p, q) => p.b.bbox[1] - q.b.bbox[1] || p.b.bbox[0] - q.b.bbox[0] || p.i - q.i)
  for (const { b: u } of unordered) {
    const base = Math.max(0, ...ordered.filter((b) => b.bbox[1] <= u.bbox[1]).map((b) => b.order))
    const below = real.filter((b) => b.bbox[1] > u.bbox[1]).map((b) => b.order)
    const nxt = below.length ? Math.min(...below) : null
    u.order = nxt !== null && nxt > base ? (base + nxt) / 2 : base + 0.5
    ordered.push(u as LayoutBlock)
  }
}

export class LayoutDetector {
  private ops: CvOps
  private model: InferenceModel
  private threshold: number
  constructor(ops: CvOps, model: InferenceModel, threshold = 0.1) {
    this.ops = ops
    this.model = model
    this.threshold = threshold
  }

  /** BGR page -> blocks in reading order. */
  async detect(img: Mat): Promise<LayoutBlock[]> {
    const ops = this.ops
    const cv = ops.cv
    const h: number = img.rows
    const w: number = img.cols
    const rgb = new cv.Mat()
    cv.cvtColor(img, rgb, cv.COLOR_BGR2RGB)
    const x = ops.resize(rgb, SIZE, SIZE, cv.INTER_CUBIC)
    rgb.delete()
    const px: Uint8Array = x.data
    const plane = SIZE * SIZE
    const image = new Float32Array(3 * plane)
    for (let c = 0; c < 3; c++) for (let i = 0; i < plane; i++) image[c * plane + i] = Math.fround(px[i * 3 + c] / 255)
    x.delete()
    const [boxesT, numT, masksT] = await this.model.runAll({
      im_shape: { data: Float32Array.from([SIZE, SIZE]), dims: [1, 2] },
      image: { data: image, dims: [1, 3, SIZE, SIZE] },
      scale_factor: { data: Float32Array.from([SIZE / h, SIZE / w]), dims: [1, 2] },
    })
    const n = Number(numT.data[0])
    const cols = boxesT.dims[1]
    let rows: Row[] = []
    for (let i = 0; i < n; i++) rows.push(Array.from(boxesT.data.subarray(i * cols, (i + 1) * cols)))
    let maskIdx = rows.map((_, i) => i)
    const [, hm, wm] = masksT.dims
    const masks = masksT.data as Int32Array

    // LayoutAnalysisProcess.apply
    rows.forEach((r) => {
      for (let k = 2; k < 6; k++) r[k] = Math.trunc(pyRound(r[k]))
    })
    const keepIdx = (keep: boolean[]) => {
      rows = rows.filter((_, i) => keep[i])
      maskIdx = maskIdx.filter((_, i) => keep[i])
    }
    keepIdx(rows.map((r) => r[1] > this.threshold && r[0] > -1))
    const sel = nms(rows, 0.6, 0.98)
    rows = sel.map((i) => rows[i])
    maskIdx = sel.map((i) => maskIdx[i])
    if (rows.length > 1) {
      const areaThres = w > h ? 0.82 : 0.93
      const imageIdx = LABELS.indexOf('image')
      const keep = rows.map((r) => {
        if (r[0] !== imageIdx) return true
        const a = (Math.min(w, r[4]) - Math.max(0, r[2])) * (Math.min(h, r[5]) - Math.max(0, r[3]))
        return a <= areaThres * w * h
      })
      if (keep.some(Boolean)) keepIdx(keep)
    }
    // Merge mode "large": drop boxes contained in another.
    const containedBy = rows.map((r, i) => rows.some((o, j) => i !== j && isContained(r, o)))
    keepIdx(containedBy.map((c) => !c))
    if (!rows.length) return []
    if (cols >= 7) {
      const order = rows.map((_, i) => i).sort((p, q) => rows[p][6] - rows[q][6] || p - q)
      rows = order.map((i) => rows[i])
      maskIdx = order.map((i) => maskIdx[i])
    }
    const polys = polygonsFromMasks(ops, rows, masks, hm, wm, w, h, maskIdx)
    // restructured_boxes
    const boxes: Box[] = []
    rows.forEach((r, idx) => {
      const x0 = Math.trunc(Math.max(0, r[2]))
      const y0 = Math.trunc(Math.max(0, r[3]))
      const x1 = Math.trunc(Math.min(w, r[4]))
      const y1 = Math.trunc(Math.min(h, r[5]))
      if (x1 <= x0 || y1 <= y0) return
      boxes.push({ label: LABELS[Math.trunc(r[0])], score: r[1], coordinate: [x0, y0, x1, y1], polygon: polys[idx], order: idx + 1 })
    })
    const filtered = filterBoxes(boxes)
    // update_order_index
    let k = 1
    for (const b of filtered) b.order = SKIP_ORDER_LABELS.has(b.label) ? null : k++
    const blocks = filtered.map((b) => ({ label: b.label, score: b.score, bbox: b.coordinate, order: b.order }))
    fillMissingOrder(blocks)
    return (blocks as LayoutBlock[]).map((b, i) => ({ b, i })).sort((p, q) => p.b.order - q.b.order || p.i - q.i).map((x) => x.b)
  }
}
