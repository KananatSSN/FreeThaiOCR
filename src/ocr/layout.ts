// SPDX-License-Identifier: Apache-2.0
// Derived from runtime/line_engine.py in iapp/OpenThai2.0-OCR-Text
// (https://huggingface.co/iapp/OpenThai2.0-OCR-Text), Copyright (c) iApp Technology,
// licensed under the Apache License 2.0. Ported to TypeScript and modified by the
// FreeThaiOCR contributors. See NOTICE.
// Layout heuristics of the reference: line splitting, fragments, skew, reading
// order (recursive XY-cut with a prose-column test) and word boxes.
import type { Mat } from '@techstark/opencv-js'
import type { CvOps } from './cvops'
import { add, dist, maxOf, mean, median, minOf, type Pt, type Quad, scale, sub, xs, ys } from './geom'
import type { CharSpan } from './recognize'
import { canonical, fixScripts } from './thaiNorm'

/** Typical text-line height: median over line-shaped boxes (>= 2x wider than tall). */
export function lineHeight(boxes: Quad[]): number {
  const hs = boxes.map((b) => Math.max(dist(b[0], b[3]), 1.0))
  const lines = hs.filter((h, i) => dist(boxes[i][0], boxes[i][1]) >= 2 * h)
  return hs.length ? median(lines.length >= 3 ? lines : hs) : 1.0
}

/** Boxes that are pieces of a neighbouring line (a stacked mark or a tail detected alone). */
export function fragments(boxes: Quad[], rec: Map<number, { text: string }>): Set<number> {
  const out = new Set<number>()
  if (boxes.length < 3) return out
  const hs = boxes.map((b) => dist(b[0], b[3]))
  const hmed = lineHeight(boxes)
  boxes.forEach((b, i) => {
    if (hs[i] >= 0.35 * hmed || (rec.get(i)?.text ?? '').replaceAll(' ', '').length > 3) return
    const x0 = minOf(xs(b))
    const x1 = maxOf(xs(b))
    const y0 = minOf(ys(b))
    const y1 = maxOf(ys(b))
    for (let j = 0; j < boxes.length; j++) {
      const c = boxes[j]
      if (j === i || hs[j] < 0.6 * hmed) continue
      if (minOf(xs(c)) <= x1 && x0 <= maxOf(xs(c)) && Math.min(Math.abs(y0 - maxOf(ys(c))), Math.abs(minOf(ys(c)) - y1)) <= 0.5 * hmed) {
        out.add(i)
        break
      }
    }
  })
  return out
}

/** +1 for a box `ratio` times taller than wide, -1 for that much wider than tall, else 0. */
export function vertical(box: Quad, ratio: number): number {
  const w = dist(box[0], box[1])
  const h = dist(box[0], box[3])
  return h >= ratio * Math.max(w, 1.0) ? 1 : w >= ratio * Math.max(h, 1.0) ? -1 : 0
}

/**
 * split_one: a line box -> its pieces between blank stretches >= ratio x its
 * height, with such a stretch trimmed off either end. Returns [b] (the same
 * object) when nothing changes, so callers can tell by identity.
 */
export function splitOne(ops: CvOps, img: Mat, b: Quad, ratio: number): Quad[] {
  if (!ratio) return [b]
  const c = ops.cropLine(img, b, 0)
  const h: number = c.rows
  const w: number = c.cols
  if (w < 4 * h || h < 4) {
    c.delete()
    return [b]
  }
  const g = ops.gray(c)
  c.delete()
  const f = ops.flatten(g)
  g.delete()
  const px: Uint8Array = f.data
  const ink = new Array<boolean>(w).fill(false)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px[y * w + x] < 128) ink[x] = true
  f.delete()
  const segs: [number, number][] = []
  let start: number | null = null
  let blank = 0
  ink.forEach((on, x) => {
    if (on) {
      if (start === null) start = x
      else if (blank >= ratio * h) {
        segs.push([start, x - blank])
        start = x
      }
      blank = 0
    } else if (start !== null) blank++
  })
  if (start !== null) segs.push([start, w - blank])
  if (!segs.length || (segs.length === 1 && segs[0][0] < ratio * h && w - segs[0][1] < ratio * h)) return [b]
  const top = sub(b[1], b[0])
  const bot = sub(b[2], b[3])
  const pad = 0.15 * h
  return segs.map(([x0, x1]) => {
    const t0 = Math.max(0, (x0 - pad) / w)
    const t1 = Math.min(1, (x1 + pad) / w)
    return [add(b[0], scale(top, t0)), add(b[0], scale(top, t1)), add(b[3], scale(bot, t1)), add(b[3], scale(bot, t0))]
  })
}

/** Median text-line angle in degrees, from boxes at least 3x wider than tall. */
export function pageSkew(boxes: Quad[]): number {
  const angles: number[] = []
  for (const b of boxes) {
    const dx = b[1][0] - b[0][0]
    const dy = b[1][1] - b[0][1]
    const h = dist(b[0], b[3])
    if (Math.hypot(dx, dy) >= 3 * Math.max(h, 1.0)) angles.push((Math.atan2(dy, dx) * 180) / Math.PI)
  }
  return angles.length ? median(angles) : 0
}

type Ext = [number, number, number, number] // x0, x1, y0, y1

/** Empty bands between intervals, at least minGap wide. */
function gaps(iv: [number, number][], minGap: number): [number, number][] {
  const s = [...iv].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const out: [number, number][] = []
  let reach = s[0][1]
  for (const [lo, hi] of s.slice(1)) {
    if (lo - reach >= minGap) out.push([reach, lo])
    reach = Math.max(reach, hi)
  }
  return out
}

const DIGITS = new Set('0123456789๐๑๒๓๔๕๖๗๘๙')
const ENUM = /^\s*\(?([0-9๐-๙]{1,4})\s*[.)]/

function enumOf(text: string): number | null {
  const m = ENUM.exec(text)
  if (!m) return null
  return parseInt(m[1].replace(/[๐-๙]/g, (d) => String(d.charCodeAt(0) - 0x0e50)), 10)
}

function numberedAcross(lcol: number[], rcol: number[], ext: Ext[], hmed: number, texts?: string[]): boolean {
  if (!texts) return false
  let pairs = 0
  for (const i of lcol) {
    const a = enumOf(texts[i])
    if (a === null) continue
    const cy = (ext[i][2] + ext[i][3]) / 2
    if (rcol.some((j) => enumOf(texts[j]) === a + 1 && Math.abs((ext[j][2] + ext[j][3]) / 2 - cy) <= 0.5 * hmed)) pairs++
  }
  return pairs >= 0.5 * Math.min(lcol.length, rcol.length)
}

function prose(col: number[], ext: Ext[], hmed: number, texts?: string[]): boolean {
  if (col.length < 12) return false
  const widths = col.map((i) => ext[i][1] - ext[i][0])
  const span = maxOf(col.map((i) => ext[i][1])) - minOf(col.map((i) => ext[i][0]))
  if (median(widths) < 7 * hmed || mean(widths.map((w) => (w >= 0.75 * span ? 1 : 0))) < 0.5) return false
  if (texts) {
    const chars = col.flatMap((i) => [...texts[i]].filter((c) => !/\s/u.test(c)))
    if (chars.length && chars.filter((c) => DIGITS.has(c)).length > 0.3 * chars.length) return false
  }
  return true
}

/** The column of `side` that touches the gutter (a side can hold several). */
function nextTo(side: number[], ext: Ext[], hmed: number, gutterOnRight: boolean): number[] {
  if (!side.length) return side
  const g = gaps(side.map((i) => [ext[i][0], ext[i][1]]), 0.8 * hmed)
  if (!g.length) return side
  if (gutterOnRight) return side.filter((i) => ext[i][0] >= g[g.length - 1][1])
  return side.filter((i) => ext[i][1] <= g[0][0])
}

/** Recursive XY-cut into reading-order blocks; vertical cuts only between prose columns. */
function blocks(idx: number[], ext: Ext[], hmed: number, texts: string[] | undefined, depth = 0): number[][] {
  if (idx.length < 6 || depth > 12) return [idx]
  const cuts: [number, number[], number[]][] = []
  for (const [g0, g1] of gaps(idx.map((i) => [ext[i][0], ext[i][1]]), 0.8 * hmed)) {
    const left = idx.filter((i) => ext[i][1] <= g0)
    const right = idx.filter((i) => ext[i][0] >= g1)
    const lcol = nextTo(left, ext, hmed, true)
    const rcol = nextTo(right, ext, hmed, false)
    if (prose(lcol, ext, hmed, texts) && prose(rcol, ext, hmed, texts) && !numberedAcross(lcol, rcol, ext, hmed, texts)) {
      cuts.push([g1 - g0, left, right])
    }
  }
  if (cuts.length) {
    let best = cuts[0]
    for (const c of cuts) if (c[0] > best[0]) best = c
    return [...blocks(best[1], ext, hmed, texts, depth + 1), ...blocks(best[2], ext, hmed, texts, depth + 1)]
  }
  const hg = gaps(idx.map((i) => [ext[i][2], ext[i][3]]), 0.8 * hmed)
  if (!hg.length) return [idx]
  let [g0, g1] = hg[0]
  for (const g of hg) if (g[1] - g[0] > g1 - g0) [g0, g1] = g
  const top = idx.filter((i) => ext[i][3] <= g0)
  const bottom = idx.filter((i) => ext[i][2] >= g1)
  return [...blocks(top, ext, hmed, texts, depth + 1), ...blocks(bottom, ext, hmed, texts, depth + 1)]
}

/** Rows top to bottom, each left to right, in deskewed coordinates, block by block. */
export function readingOrder(boxes: Quad[], angle?: number, columns = true, texts?: string[]): number[][] {
  if (!boxes.length) return []
  const a = (-(angle ?? pageSkew(boxes)) * Math.PI) / 180
  const cos = Math.fround(Math.cos(a))
  const sin = Math.fround(Math.sin(a))
  const pts = boxes.map((b) => b.map(([x, y]) => [Math.fround(x * cos - y * sin), Math.fround(x * sin + y * cos)] as Pt))
  const ext: Ext[] = pts.map((p) => [minOf(xs(p)), maxOf(xs(p)), minOf(ys(p)), maxOf(ys(p))])
  const hmed = lineHeight(boxes)
  const idx = boxes.map((_, i) => i)
  const blks = columns ? blocks(idx, ext, hmed, texts) : [idx]
  const cy = ext.map((e) => (e[2] + e[3]) / 2)
  const rx = ext.map((e) => (e[0] + e[1]) / 2)
  const hs = boxes.map((b) => Math.max(dist(b[0], b[3]), 1.0))
  const tol = 0.5 * hmed
  const rows: number[][] = []
  for (const blk of blks) {
    // Rows from full-height lines only; small boxes join the nearest row afterwards.
    let full = blk.filter((i) => hs[i] >= 0.6 * hmed)
    if (!full.length) full = [...blk]
    const fullSet = new Set(full)
    const small = blk.filter((i) => !fullSet.has(i))
    const brows: number[][] = []
    for (const i of [...full].sort((p, q) => cy[p] - cy[q])) {
      if (brows.length && Math.abs(cy[i] - mean(brows[brows.length - 1].map((j) => cy[j]))) <= tol) brows[brows.length - 1].push(i)
      else brows.push([i])
    }
    const centre = brows.map((r) => mean(r.map((j) => cy[j])))
    for (const i of small) {
      const d = centre.map((c) => Math.abs(cy[i] - c))
      if (d.length && minOf(d) <= tol + 0.5 * hs[i]) brows[d.indexOf(minOf(d))].push(i)
      else {
        brows.push([i])
        centre.push(cy[i])
      }
    }
    const order = brows.map((_, r) => r).sort((p, q) => centre[p] - centre[q])
    for (const r of order) rows.push([...brows[r]].sort((p, q) => rx[p] - rx[q]))
  }
  return rows
}

/** Median pitch between consecutive spacing characters inside words, as a share of line width. */
function advance(tokens: CharSpan[][]): number {
  const steps: number[] = []
  for (const tok of tokens) {
    const x = tok.filter((c) => c[0] && !/\p{Mn}/u.test(c[0][0])).map((c) => c[1])
    for (let k = 1; k < x.length; k++) if (x[k] > x[k - 1]) steps.push(x[k] - x[k - 1])
  }
  if (steps.length) return median(steps)
  const n = tokens.reduce((a, t) => a + t.length, 0)
  return tokens.length ? (tokens[tokens.length - 1][tokens[tokens.length - 1].length - 1][2] - tokens[0][0][1]) / Math.max(n, 1) : 0
}

export interface Word {
  text: string
  confidence: number
  box: Pt[]
}

const round4 = (v: number) => Math.round(v * 1e4) / 1e4

/** Words of one line with their boxes, cut from the recognizer's character positions. */
export function words(chars: CharSpan[] | null | undefined, box: Quad, text: string, conf: number): Word[] {
  const whole = [{ text, confidence: round4(conf), box }]
  if (!chars || !chars.length) return whole
  const tokens: CharSpan[][] = []
  const gapsAt: number[] = []
  let cur: CharSpan[] = []
  for (const ch of chars) {
    if (ch[0] === '' || /^\s/u.test(ch[0])) {
      if (cur.length) {
        tokens.push(cur)
        gapsAt.push((ch[1] + ch[2]) / 2)
        cur = []
      } else if (gapsAt.length) {
        gapsAt[gapsAt.length - 1] = (gapsAt[gapsAt.length - 1] + (ch[1] + ch[2]) / 2) / 2
      }
    } else cur.push(ch)
  }
  if (cur.length) tokens.push(cur)
  const adv = advance(tokens)
  const out: Word[] = []
  tokens.forEach((tok, n) => {
    const t = fixScripts(canonical(tok.map((c) => c[0]).join('')))
    if (!t) return
    const first = tok[0][1]
    const last = tok[tok.length - 1][2]
    const x0 = n > 0 ? Math.min(first, Math.max(gapsAt[n - 1] + 0.2 * adv, first - 0.5 * adv)) : Math.max(0, first - adv)
    const x1 =
      n < gapsAt.length && n < tokens.length - 1 ? Math.max(last, Math.min(gapsAt[n] - 0.2 * adv, last + 0.5 * adv)) : Math.min(1, last + 0.5 * adv)
    const top = sub(box[1], box[0])
    const bot = sub(box[2], box[3])
    out.push({
      text: t,
      confidence: round4(mean(tok.map((c) => c[3]))),
      box: [add(box[0], scale(top, x0)), add(box[0], scale(top, x1)), add(box[3], scale(bot, x1)), add(box[3], scale(bot, x0))],
    })
  })
  return out.length ? out : whole
}
