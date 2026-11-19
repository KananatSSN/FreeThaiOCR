// SPDX-License-Identifier: Apache-2.0
// Derived from aksonocr_lite/pipeline.py in Remtir/AksonOCR-Lite (https://github.com/Remtir/AksonOCR-Lite),
// Copyright (c) 2026 Teetouch Jaknamon, licensed under the Apache License 2.0. Ported to TypeScript and
// modified by the FreeThaiOCR contributors. See NOTICE.
// Page pipeline: page rotation -> text lines -> (document mode: layout, table OCR, table grids) ->
// line-to-block merge -> Markdown. Text mode is the same pipeline without the layout model: the whole
// page is one text block, exactly the reference's path when layout finds nothing.
import type { Mat } from '@techstark/opencv-js'
import { type CV, CvOps } from '../cvops'
import type { DroppedLine, OcrLine, OcrResult } from '../engine'
import { applyM, dist, eye3, inv3, type Pt, pyRound, type Quad, rot90Matrix } from '../geom'
import { words } from '../layout'
import type { InferenceModel } from '../model'
import type { CharSpan } from '../recognize'
import { detectLines } from './det'
import { type LayoutBlock, LayoutDetector } from './layout'
import { type Angle, LineOrientation, PageOrientation, rotateCcw } from './orient'
import { AksonRecognizer } from './rec'
import { gridToHtml, TableStructure } from './table'

const HEADING_LABELS = new Set(['doc_title', 'paragraph_title'])
const TABLE_LABELS = new Set(['table'])
const FIGURE_LABELS = new Set(['image', 'chart', 'seal'])
const FORMULA_LABELS = new Set(['display_formula', 'inline_formula', 'algorithm'])

export interface AksonFiles {
  det: InferenceModel
  rec: InferenceModel
  docOri: InferenceModel
  lineOri: InferenceModel
  charset: { chars: string[] }
  /** Document mode's models, loaded the first time a page needs them. */
  loadLayout?: () => Promise<{ layout: InferenceModel; tatr: InferenceModel }>
}

type BBox = [number, number, number, number]
export interface AksonLine {
  text: string
  confidence: number
  bbox: BBox
  poly: Pt[]
  chars: CharSpan[] | null
}
interface WorkBlock {
  label: string
  score: number
  bbox: BBox
  order: number
  html?: string
  lines?: number[]
}
export interface AksonBlock {
  label: string
  bbox: BBox
  score: number
  order: number
  text: string
  html?: string
  lineIds: number[]
}
export interface AksonPage {
  /** Counter-clockwise rotation applied before OCR. */
  rotation: Angle
  width: number
  height: number
  lines: AksonLine[]
  blocks: AksonBlock[]
  markdown: string
  text: string
}

export interface AksonResult extends OcrResult {
  /** Document mode: the page as Markdown (headings, paragraphs, tables as HTML). */
  markdown?: string
  /** Document mode: layout blocks in reading order, in original image coordinates. */
  blocks?: { label: string; order: number; box: Pt[]; text: string; html?: string }[]
}

const center = (b: BBox): Pt => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]
const inside = (p: Pt, b: BBox, pad = 2) => b[0] - pad <= p[0] && p[0] <= b[2] + pad && b[1] - pad <= p[1] && p[1] <= b[3] + pad
const area = (b: BBox) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1])
const overlap = (a: BBox, b: BBox) => {
  const x0 = Math.max(a[0], b[0])
  const y0 = Math.max(a[1], b[1])
  const x1 = Math.min(a[2], b[2])
  const y1 = Math.min(a[3], b[3])
  return x1 <= x0 || y1 <= y0 ? 0 : (x1 - x0) * (y1 - y0)
}
/** statistics.median */
const med = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const argmaxBy = <T>(xs: T[], key: (x: T) => number[]) => {
  let best = xs[0]
  let bk = key(best)
  for (const x of xs.slice(1)) {
    const k = key(x)
    for (let i = 0; i < k.length; i++) {
      if (k[i] > bk[i]) {
        best = x
        bk = k
        break
      }
      if (k[i] < bk[i]) break
    }
  }
  return best
}
const lineKey = (lines: AksonLine[]) => (i: number) => [pyRound(lines[i].bbox[1] / 8), lines[i].bbox[0]]
const byLineKey = (lines: AksonLine[]) => (p: number, q: number) => {
  const k = lineKey(lines)
  const a = k(p)
  const b = k(q)
  return a[0] - b[0] || a[1] - b[1]
}

/** filter_bad_lines: tiny lines nested in the top/bottom band of a bigger line (a lone Thai mark). */
export function filterBadLines(lines: AksonLine[], overlapMin = 0.5, band = 0.45): AksonLine[] {
  if (!lines.length) return lines
  const boxes = lines.map((l) => l.bbox)
  const medH = med(boxes.map((b) => Math.max(1, b[3] - b[1])))
  const medA = med(boxes.map(area))
  const minH = Math.max(10, medH * 0.32)
  const minA = Math.max(36, medA * 0.08)
  const small = boxes.map((b) => b[3] - b[1] < minH || area(b) < minA)
  const drop = new Set<number>()
  boxes.forEach((inner, i) => {
    if (!small[i]) return
    const ia = area(inner)
    const text = (lines[i].text ?? '').trim()
    for (let j = 0; j < boxes.length; j++) {
      const outer = boxes[j]
      if (i === j || ia >= area(outer)) continue
      const ov = overlap(inner, outer)
      if (ia <= 0 || ov <= 0) continue
      let nested = false
      if (ov / ia >= overlapMin) {
        const bh = Math.max(1, outer[3] - outer[1]) * band
        const top = overlap(inner, [outer[0], outer[1], outer[2], outer[1] + bh])
        const bot = overlap(inner, [outer[0], outer[3] - bh, outer[2], outer[3]])
        nested = top / ov >= 0.5 || bot / ov >= 0.5
      }
      if (!nested) {
        const yo = Math.max(0, Math.min(inner[3], outer[3]) - Math.max(inner[1], outer[1])) / Math.max(1, Math.min(inner[3] - inner[1], outer[3] - outer[1]))
        nested = yo >= 0.55 && ov / ia >= Math.max(0.35, overlapMin - 0.15) && ia <= area(outer) * 0.45 && [...text].length <= 3
      }
      if (nested) {
        drop.add(i)
        break
      }
    }
  })
  return lines.filter((_, i) => !drop.has(i))
}

/** assign_lines: each line to the block holding its centre (else the nearest), so no text is dropped. */
function assignLines(lines: AksonLine[], idxs: number[], regions: WorkBlock[]) {
  for (const r of regions) r.lines ??= []
  for (const i of idxs) {
    const lb = lines[i].bbox
    const c = center(lb)
    const hits = regions.filter((r) => inside(c, r.bbox))
    let best: WorkBlock | undefined
    if (hits.length) {
      const la = Math.max(1, area(lb))
      best = argmaxBy(hits, (r) => [overlap(lb, r.bbox) / la, FIGURE_LABELS.has(r.label) ? 0 : 1, -area(r.bbox)])
    } else if (regions.length) {
      const d = (r: WorkBlock) => {
        const b = r.bbox
        const dx = Math.max(b[0] - c[0], 0, c[0] - b[2])
        const dy = Math.max(b[1] - c[1], 0, c[1] - b[3])
        return Math.hypot(dx, dy)
      }
      best = argmaxBy(regions, (r) => [-d(r)])
    }
    best?.lines!.push(i)
  }
}

/** Slides and screenshots are often labelled `image`: keep their text by relabelling text-rich ones. */
function promoteTextRichFigures(blocks: WorkBlock[], lines: AksonLine[], pageArea: number) {
  for (const b of blocks) {
    if (!FIGURE_LABELS.has(b.label) || b.label === 'chart') continue
    const idx = b.lines ?? []
    const text = idx.map((i) => lines[i].text).join('\n').trim()
    if (idx.length >= 3 || [...text].length >= 50 || (area(b.bbox) >= 0.18 * pageArea && idx.length && [...text].length >= 15)) b.label = 'text'
  }
}

function blockMarkdown(b: WorkBlock, text: string, nLines: number): string {
  if (TABLE_LABELS.has(b.label)) return b.html || text
  if (FIGURE_LABELS.has(b.label)) {
    const marker = '<figure>\n</figure>'
    if (text && (nLines >= 2 || [...text].length >= 40 || b.score < 0.85)) return marker + '\n' + text
    return marker
  }
  if (!text) return ''
  if (HEADING_LABELS.has(b.label)) return '## ' + text
  return text
}

const TABLE_TAG_RE = /(<table\b[^>]*>|<\/table>|<tr\b[^>]*>|<\/tr>|<t[dh]\b[^>]*>.*?<\/t[dh]>)\s*/gis
export function formatHtmlTables(md: string): string {
  if (md.toLowerCase().includes('<table')) md = md.replace(TABLE_TAG_RE, (_m, g: string) => g.trim() + '\n')
  return md
    .split('\n')
    .filter((l) => l.trim())
    .join('\n')
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4
const r1 = (v: number) => Math.round(v * 10) / 10
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

export class AksonOCR {
  readonly ops: CvOps
  private files: AksonFiles
  private rec: AksonRecognizer
  private pageOri: PageOrientation
  private lineOri: LineOrientation
  private docModels: Promise<{ layout: LayoutDetector; tatr: TableStructure }> | null = null

  constructor(cv: CV, files: AksonFiles) {
    this.ops = new CvOps(cv)
    this.files = files
    this.rec = new AksonRecognizer(this.ops, files.rec, files.charset)
    this.pageOri = new PageOrientation(this.ops, files.docOri)
    this.lineOri = new LineOrientation(this.ops, files.lineOri)
  }

  /** Layout and table models: loaded on the first document-mode page; a failed load is retried. */
  private documentModels() {
    if (!this.docModels) {
      const load = this.files.loadLayout
      if (!load) throw new Error('Document mode is not available')
      const p = load().then(({ layout, tatr }) => ({ layout: new LayoutDetector(this.ops, layout), tatr: new TableStructure(this.ops, tatr) }))
      p.catch(() => {
        if (this.docModels === p) this.docModels = null
      })
      this.docModels = p
    }
    return this.docModels
  }

  /** Download and load the document-mode models now (a no-op once loaded). */
  async prepareDocument(): Promise<void> {
    await this.documentModels()
  }

  /** _lines: detect, cut out, turn upside-down lines, read. */
  async lines(img: Mat, unclip: number): Promise<AksonLine[]> {
    const ops = this.ops
    const quads = await detectLines(ops, this.files.det, img, unclip)
    const crops = quads.map((q) => ops.cropLine(img, q, 1))
    try {
      const flipped = crops.length ? await this.lineOri.upsideDown(crops) : []
      flipped.forEach((up, k) => {
        if (!up) return
        const t = ops.rot90(crops[k], 2)
        crops[k].delete()
        crops[k] = t
      })
      const reads = await this.rec.read(crops)
      const out: AksonLine[] = []
      reads.forEach((r, k) => {
        if (!r.text) return
        const q = quads[k]
        const xs = q.map((p) => p[0])
        const ys = q.map((p) => p[1])
        // cropLine turns a cut at least 1.5x taller than wide; positions along the box only
        // apply to a crop read as cut (not turned, not flipped).
        const cw = Math.max(Math.trunc(Math.max(dist(q[0], q[1]), dist(q[2], q[3]))), 1)
        const ch = Math.max(Math.trunc(Math.max(dist(q[0], q[3]), dist(q[1], q[2]))), 1)
        const asCut = !flipped[k] && ch / cw < 1.5
        out.push({
          text: r.text,
          confidence: r4(r.conf),
          poly: q.map(([x, y]) => [x, y] as Pt),
          bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
          chars: asCut ? r.chars : null,
        })
      })
      return out
    } finally {
      for (const c of crops) c.delete()
    }
  }

  /** _region_ocr: re-read table/chart crops with a tighter unclip, replacing the page lines inside them. */
  private async regionOcr(img: Mat, lines: AksonLine[], regions: WorkBlock[]): Promise<AksonLine[]> {
    if (!regions.length) return lines
    const H: number = img.rows
    const W: number = img.cols
    const owner = new Map<number, WorkBlock>()
    lines.forEach((l, i) => {
      const c = center(l.bbox)
      const hits = regions.filter((r) => inside(c, r.bbox))
      if (hits.length) owner.set(i, argmaxBy(hits, (r) => [overlap(l.bbox, r.bbox)]))
    })
    const replaced = new Set<WorkBlock>()
    const extra: AksonLine[] = []
    for (const r of regions) {
      let [x0, y0, x1, y1] = r.bbox.map((v) => Math.max(0, Math.trunc(v)))
      x1 = Math.min(W, x1)
      y1 = Math.min(H, y1)
      if (x1 <= x0 || y1 <= y0) continue
      const roi = img.roi(new this.ops.cv.Rect(x0, y0, x1 - x0, y1 - y0))
      const crop = roi.clone()
      roi.delete()
      const got = await this.lines(crop, 1.2)
      crop.delete()
      if (!got.length) continue
      for (const l of got) {
        l.bbox = [l.bbox[0] + x0, l.bbox[1] + y0, l.bbox[2] + x0, l.bbox[3] + y0]
        l.poly = l.poly.map(([x, y]) => [x + x0, y + y0] as Pt)
      }
      replaced.add(r)
      extra.push(...got)
    }
    return [...lines.filter((_, i) => !replaced.has(owner.get(i)!)), ...extra]
  }

  private async tableHtml(img: Mat, block: WorkBlock, tlines: AksonLine[], tatr: TableStructure): Promise<string> {
    const H: number = img.rows
    const W: number = img.cols
    let [x0, y0, x1, y1] = block.bbox.map((v) => Math.max(0, Math.trunc(v)))
    x1 = Math.min(W, x1)
    y1 = Math.min(H, y1)
    if (x1 <= x0 || y1 <= y0) return ''
    const roi = img.roi(new this.ops.cv.Rect(x0, y0, x1 - x0, y1 - y0))
    const crop = roi.clone()
    roi.delete()
    try {
      const cells = await tatr.cells(crop)
      return gridToHtml(cells, tlines.map((l) => ({ text: l.text, bbox: [l.bbox[0] - x0, l.bbox[1] - y0, l.bbox[2] - x0, l.bbox[3] - y0] as BBox })))
    } finally {
      crop.delete()
    }
  }

  /** Converter.page on a BGR image (not consumed). */
  async page(input: Mat, document: boolean): Promise<AksonPage> {
    const angle = await this.pageOri.angle(input)
    const img = rotateCcw(this.ops, input, angle)
    try {
      const h: number = img.rows
      const w: number = img.cols
      let lines = await this.lines(img, 2.0)
      let blocks: WorkBlock[] = []
      let tatr: TableStructure | null = null
      if (document) {
        const m = await this.documentModels()
        tatr = m.tatr
        blocks = (await m.layout.detect(img)).map((b: LayoutBlock) => ({ ...b, bbox: [...b.bbox] as BBox }))
        blocks = blocks.filter((b) => !TABLE_LABELS.has(b.label) || b.score >= 0.9)
        for (const b of blocks) if (FORMULA_LABELS.has(b.label)) b.label = 'text'
        lines = await this.regionOcr(img, lines, blocks.filter((b) => TABLE_LABELS.has(b.label) || b.label === 'chart'))
      }
      lines = filterBadLines(lines)
      const tables = tatr ? blocks.filter((b) => TABLE_LABELS.has(b.label)) : []
      let rest = blocks.filter((b) => !tables.includes(b))
      const tableLines = new Map<WorkBlock, number[]>(tables.map((b) => [b, []]))
      const free: number[] = []
      lines.forEach((l, i) => {
        const c = center(l.bbox)
        const hits = tables.filter((b) => inside(c, b.bbox))
        if (hits.length) tableLines.get(argmaxBy(hits, (b) => [overlap(l.bbox, b.bbox)]))!.push(i)
        else free.push(i)
      })
      for (const b of tables) {
        b.html = await this.tableHtml(img, b, tableLines.get(b)!.map((i) => lines[i]), tatr!)
        b.lines = tableLines.get(b)!
      }
      if (!rest.length && free.length) {
        rest = [{ label: 'text', score: 1, bbox: [0, 0, w, h], order: 0 }]
        blocks.push(rest[0])
      }
      assignLines(lines, free, rest)
      for (const b of rest) b.lines!.sort(byLineKey(lines))
      promoteTextRichFigures(rest, lines, w * h)
      const outBlocks: AksonBlock[] = []
      const md: string[] = []
      const sorted = blocks.map((b, i) => ({ b, i })).sort((p, q) => p.b.order - q.b.order || p.i - q.i).map((x) => x.b)
      for (const b of sorted) {
        const idx = b.lines ?? []
        const text = [...idx]
          .sort(byLineKey(lines))
          .map((i) => lines[i].text)
          .filter(Boolean)
          .join('\n')
        const part = blockMarkdown(b, text, idx.length)
        if (part) md.push(part)
        outBlocks.push({ label: b.label, bbox: b.bbox.map(r1) as BBox, score: r4(b.score), order: b.order, text, html: b.html || undefined, lineIds: [...idx] })
      }
      const text = outBlocks
        .filter((b) => b.text && !FIGURE_LABELS.has(b.label))
        .map((b) => b.text)
        .join('\n\n')
      return { rotation: angle, width: w, height: h, lines, blocks: outBlocks, markdown: formatHtmlTables(md.join('\n\n')), text }
    } finally {
      img.delete()
    }
  }

  /** The app's result shape, boxes in the original image's coordinates. */
  async read(img: Mat, opts: { document?: boolean } = {}): Promise<AksonResult> {
    const t0 = now()
    const p = await this.page(img, !!opts.document)
    const k = p.rotation === 90 ? 1 : p.rotation === 180 ? 2 : p.rotation === 270 ? -1 : 0
    const tf = k ? rot90Matrix(k, [img.rows, img.cols]) : eye3()
    const back = inv3(tf)
    const toOrig = (q: Pt[]): Pt[] => applyM(back, q).map(([x, y]) => [r1(x), r1(y)] as Pt)
    // Lines in reading order: block by block, each block's lines as its text lists them.
    const order: number[] = []
    const seen = new Set<number>()
    for (const b of p.blocks) {
      for (const i of [...b.lineIds].sort(byLineKey(p.lines))) {
        if (!seen.has(i)) {
          seen.add(i)
          order.push(i)
        }
      }
    }
    p.lines.forEach((_, i) => !seen.has(i) && order.push(i))
    const lines: OcrLine[] = order.map((i, row) => {
      const l = p.lines[i]
      return {
        text: l.text,
        confidence: l.confidence,
        row,
        box: toOrig(l.poly),
        words: words(l.chars, l.poly as Quad, l.text, l.confidence, false).map((wd) => ({ ...wd, box: toOrig(wd.box) })),
      }
    })
    const res: AksonResult = {
      text: p.text,
      lines,
      dropped: [] as DroppedLine[],
      text_angle: 0,
      rotation: (360 - p.rotation) % 360,
      timing: { det_ms: 0, rec_ms: r1(now() - t0), n_lines: p.lines.length },
    }
    if (opts.document) {
      res.markdown = p.markdown
      res.blocks = p.blocks.map((b) => ({
        label: b.label,
        order: b.order,
        box: toOrig([[b.bbox[0], b.bbox[1]], [b.bbox[2], b.bbox[1]], [b.bbox[2], b.bbox[3]], [b.bbox[0], b.bbox[3]]]),
        text: b.text,
        html: b.html,
      }))
    }
    return res
  }
}
