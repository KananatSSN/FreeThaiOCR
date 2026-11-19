// SPDX-License-Identifier: Apache-2.0
// Derived from aksonocr_lite/table.py in Remtir/AksonOCR-Lite (https://github.com/Remtir/AksonOCR-Lite),
// Copyright (c) 2026 Teetouch Jaknamon, licensed under the Apache License 2.0; match_lines_to_cells follows
// PaddleX's table_recognition_post_processing (Copyright (c) 2024 PaddlePaddle Authors, Apache-2.0).
// Ported to TypeScript and modified by the FreeThaiOCR contributors. See NOTICE.
// Table structure: Microsoft Table Transformer v1.1-all (MIT) finds the grid; the text in each cell
// comes from the page's own OCR lines.
import type { Mat } from '@techstark/opencv-js'
import type { CvOps } from '../cvops'
import { pyRound } from '../geom'
import type { InferenceModel } from '../model'

const MEAN = [0.485, 0.456, 0.406]
const STD = [0.229, 0.224, 0.225]
const LABELS = ['table', 'table column', 'table row', 'table column header', 'table projected row header', 'table spanning cell']

type BBox = [number, number, number, number]
export interface TatrObject {
  label: string
  score: number
  bbox: BBox
}
export interface Cell {
  bbox: BBox
  row: number
  col: number
  rowspan: number
  colspan: number
  isHeader: boolean
}

export class TableStructure {
  private ops: CvOps
  private model: InferenceModel
  private threshold: number
  private pad: number
  private longest: number
  constructor(ops: CvOps, model: InferenceModel, threshold = 0.5, pad = 20, longest = 1000) {
    this.ops = ops
    this.model = model
    this.threshold = threshold
    this.pad = pad
    this.longest = longest
  }

  async detectObjects(crop: Mat): Promise<TatrObject[]> {
    const cv = this.ops.cv
    const h: number = crop.rows
    const w: number = crop.cols
    const k = this.longest / Math.max(h, w)
    const rgb = new cv.Mat()
    cv.cvtColor(crop, rgb, cv.COLOR_BGR2RGB)
    const r = this.ops.resize(rgb, Math.max(1, pyRound(w * k)), Math.max(1, pyRound(h * k)), cv.INTER_LINEAR)
    rgb.delete()
    const rh: number = r.rows
    const rw: number = r.cols
    const px: Uint8Array = r.data
    const plane = rh * rw
    const data = new Float32Array(3 * plane)
    for (let c = 0; c < 3; c++) {
      const mu = Math.fround(MEAN[c])
      const sd = Math.fround(STD[c])
      for (let i = 0; i < plane; i++) data[c * plane + i] = Math.fround(Math.fround(Math.fround(px[i * 3 + c] / 255) - mu) / sd)
    }
    r.delete()
    const [logitsT, boxesT] = await this.model.runAll({ pixel_values: { data, dims: [1, 3, rh, rw] } })
    const [, Q, C] = logitsT.dims
    const logits = logitsT.data
    const boxes = boxesT.data
    const out: TatrObject[] = []
    for (let q = 0; q < Q; q++) {
      let mx = -Infinity
      for (let c = 0; c < C; c++) mx = Math.max(mx, logits[q * C + c])
      let sum = 0
      const e: number[] = []
      for (let c = 0; c < C; c++) {
        e.push(Math.fround(Math.exp(logits[q * C + c] - mx)))
        sum += e[c]
      }
      // The last class is "no object".
      let lab = 0
      for (let c = 1; c < C - 1; c++) if (e[c] > e[lab]) lab = c
      const sc = e[lab] / sum
      if (sc <= this.threshold) continue
      const [cx, cy, bw, bh] = boxes.subarray(q * 4, q * 4 + 4)
      out.push({ label: LABELS[lab], score: sc, bbox: [(cx - bw / 2) * w, (cy - bh / 2) * h, (cx + bw / 2) * w, (cy + bh / 2) * h] })
    }
    return out
  }

  /** Table crop -> grid cells in crop pixels. */
  async cells(crop: Mat): Promise<Cell[]> {
    const cv = this.ops.cv
    const p = this.pad
    const h: number = crop.rows
    const w: number = crop.cols
    const canvas = new cv.Mat()
    cv.copyMakeBorder(crop, canvas, p, p, p, p, cv.BORDER_CONSTANT, new cv.Scalar(255, 255, 255, 255))
    try {
      const [cells] = gridCells(await this.detectObjects(canvas))
      for (const c of cells) {
        const [x0, y0, x1, y1] = c.bbox
        c.bbox = [Math.max(0, x0 - p), Math.max(0, y0 - p), Math.min(w, x1 - p), Math.min(h, y1 - p)]
      }
      return cells
    } finally {
      canvas.delete()
    }
  }
}

const overlap1d = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0)) / Math.max(Math.min(a1 - a0, b1 - b0), 1e-6)

/** Highest score first; drop any that overlaps a kept one by more than half along `axis`. */
function dedupe(objs: TatrObject[], axis: 0 | 1): TatrObject[] {
  const keep: TatrObject[] = []
  const byScore = objs.map((o, i) => ({ o, i })).sort((p, q) => q.o.score - p.o.score || p.i - q.i).map((x) => x.o)
  for (const o of byScore) {
    const b = o.bbox
    if (keep.every((q) => overlap1d(b[axis], b[axis + 2], q.bbox[axis], q.bbox[axis + 2]) < 0.5)) keep.push(o)
  }
  return keep.map((o, i) => ({ o, i })).sort((p, q) => p.o.bbox[axis] - q.o.bbox[axis] || p.i - q.i).map((x) => x.o)
}

/** grid_cells: rows x columns, snapped edges, header rows, spanning cells. */
export function gridCells(objs: TatrObject[]): [Cell[], number] {
  const rows = dedupe(objs.filter((o) => o.label === 'table row'), 1)
  const cols = dedupe(objs.filter((o) => o.label === 'table column'), 0)
  if (!rows.length || !cols.length) return [[], 0]
  const ry = rows.map((r) => [r.bbox[1], r.bbox[3]])
  const cx = cols.map((c) => [c.bbox[0], c.bbox[2]])
  for (const edges of [ry, cx]) {
    for (let i = 0; i < edges.length - 1; i++) {
      const m = (edges[i][1] + edges[i + 1][0]) / 2
      edges[i][1] = m
      edges[i + 1][0] = m
    }
  }
  const heads = objs.filter((o) => o.label === 'table column header').map((o) => o.bbox)
  const header = ry.map(([a, b]) => heads.some((hb) => overlap1d(a, b, hb[1], hb[3]) > 0.5))
  const spans: [number, number, number, number][] = []
  for (const o of objs) {
    if (o.label !== 'table spanning cell' && o.label !== 'table projected row header') continue
    const b = o.bbox
    const rs = ry.map(([a, c], i) => (Math.max(0, Math.min(c, b[3]) - Math.max(a, b[1])) > 0.5 * (c - a) ? i : -1)).filter((i) => i >= 0)
    let cs = cx.map(([a, c], j) => (Math.max(0, Math.min(c, b[2]) - Math.max(a, b[0])) > 0.5 * (c - a) ? j : -1)).filter((j) => j >= 0)
    if (o.label === 'table projected row header') cs = cx.map((_, j) => j)
    if (rs.length && cs.length && rs.length * cs.length > 1) spans.push([Math.min(...rs), Math.max(...rs), Math.min(...cs), Math.max(...cs)])
  }
  const taken = new Set<string>()
  const cells: [number, number, number, number][] = []
  const size = (t: number[]) => (t[1] - t[0] + 1) * (t[3] - t[2] + 1)
  for (const [r0, r1, c0, c1] of spans.map((s, i) => ({ s, i })).sort((p, q) => size(q.s) - size(p.s) || p.i - q.i).map((x) => x.s)) {
    const slots: string[] = []
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) slots.push(`${r},${c}`)
    if (slots.some((s) => taken.has(s))) continue
    slots.forEach((s) => taken.add(s))
    cells.push([r0, r1, c0, c1])
  }
  for (let r = 0; r < ry.length; r++) for (let c = 0; c < cx.length; c++) if (!taken.has(`${r},${c}`)) cells.push([r, r, c, c])
  const out = cells.map(([r0, r1, c0, c1]) => ({
    bbox: [cx[c0][0], ry[r0][0], cx[c1][1], ry[r1][1]] as BBox,
    row: r0,
    col: c0,
    rowspan: r1 - r0 + 1,
    colspan: c1 - c0 + 1,
    isHeader: header[r0],
  }))
  const all = [...rows, ...cols]
  return [out, all.reduce((a, o) => a + o.score, 0) / all.length]
}

const distance = (a: BBox, b: BBox) => {
  const d = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]) + Math.abs(b[2] - a[2]) + Math.abs(b[3] - a[3])
  return d + Math.min(Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]), Math.abs(b[2] - a[2]) + Math.abs(b[3] - a[3]))
}
const iou = (a: BBox, b: BBox) => {
  const l = Math.max(a[0], b[0])
  const r = Math.min(a[2], b[2])
  const t = Math.max(a[1], b[1])
  const btm = Math.min(a[3], b[3])
  if (l >= r || t >= btm) return 0
  const inter = (r - l) * (btm - t)
  const union = Math.max(0, (a[2] - a[0]) * (a[3] - a[1])) + Math.max(0, (b[2] - b[0]) * (b[3] - b[1])) - inter
  return union > 0 ? inter / union : 0
}

/** Each OCR line goes to the cell with the highest IoU, ties broken by corner distance. */
export function matchLinesToCells(cellBoxes: BBox[], lineBoxes: BBox[]): Map<number, number[]> {
  const matched = new Map<number, number[]>()
  lineBoxes.forEach((lb, i) => {
    let best = 0
    let key: [number, number] = [1 - iou(cellBoxes[0], lb), distance(cellBoxes[0], lb)]
    for (let j = 1; j < cellBoxes.length; j++) {
      const k: [number, number] = [1 - iou(cellBoxes[j], lb), distance(cellBoxes[j], lb)]
      if (k[0] < key[0] || (k[0] === key[0] && k[1] < key[1])) {
        best = j
        key = k
      }
    }
    matched.set(best, [...(matched.get(best) ?? []), i])
  })
  return matched
}

const escapeHtml = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

/** cells (crop coordinates) + lines in crop coordinates -> <table> HTML. */
export function gridToHtml(cells: Cell[], lines: { text: string; bbox: BBox }[]): string {
  if (!cells.length) return ''
  const matched = lines.length ? matchLinesToCells(cells.map((c) => c.bbox), lines.map((l) => l.bbox)) : new Map<number, number[]>()
  const nRows = Math.max(...cells.map((c) => c.row + c.rowspan))
  const nCols = Math.max(...cells.map((c) => c.col + c.colspan))
  const occupied = Array.from({ length: nRows }, () => new Array<boolean>(nCols).fill(false))
  const origin = new Map<string, number>()
  cells.forEach((c, i) => {
    if (!origin.has(`${c.row},${c.col}`)) origin.set(`${c.row},${c.col}`, i)
  })
  const parts = ['<table>']
  for (let r = 0; r < nRows; r++) {
    parts.push('<tr>')
    let c = 0
    while (c < nCols) {
      if (occupied[r][c]) {
        c++
        continue
      }
      const idx = origin.get(`${r},${c}`)
      if (idx === undefined) {
        parts.push('<td></td>')
        c++
        continue
      }
      const cell = cells[idx]
      for (let rr = r; rr < Math.min(nRows, r + cell.rowspan); rr++) for (let cc = c; cc < Math.min(nCols, c + cell.colspan); cc++) occupied[rr][cc] = true
      const text = (matched.get(idx) ?? [])
        .map((k) => (lines[k].text ?? '').trim())
        .filter(Boolean)
        .join(' ')
      const tag = cell.isHeader ? 'th' : 'td'
      const attrs = (cell.rowspan > 1 ? ` rowspan="${cell.rowspan}"` : '') + (cell.colspan > 1 ? ` colspan="${cell.colspan}"` : '')
      parts.push(`<${tag}${attrs}>${escapeHtml(text)}</${tag}>`)
      c += cell.colspan
    }
    parts.push('</tr>')
  }
  parts.push('</table>')
  return parts.join('')
}
