// SPDX-License-Identifier: Apache-2.0
// Derived from runtime/line_engine.py in iapp/OpenThai2.0-OCR-Text
// (https://huggingface.co/iapp/OpenThai2.0-OCR-Text), Copyright (c) iApp Technology,
// licensed under the Apache License 2.0. Ported to TypeScript and modified by the
// FreeThaiOCR contributors. See NOTICE.
// LineOCR: TypeScript port of runtime/line_engine.py from
// iapp/OpenThai2.0-OCR-Text (Apache-2.0). Detector -> line splitting ->
// orientation/deskew -> recognition -> reading order -> filtering.
import type { Mat } from '@techstark/opencv-js'
import { buildConfig, type OcrConfig } from './config'
import { CvOps, type CV } from './cvops'
import { detect } from './detect'
import { applyM, dist, eye3, inv3, type Mat3, matMul, mean, median, type Pt, type Quad, rot90Matrix } from './geom'
import { fragments, pageSkew, readingOrder, splitOne, vertical, type Word, words } from './layout'
import type { InferenceModel } from './model'
import { type CharSpan, Recognizer, type RecResult } from './recognize'
import { canonical, fixScripts, invalidShare, isThai } from './thaiNorm'

export interface OcrLine {
  text: string
  confidence: number
  row: number
  box: Pt[]
  words?: Word[]
}
export interface DroppedLine extends Omit<OcrLine, 'words'> {
  reason: 'empty' | 'low_confidence' | 'too_short' | 'invalid_thai'
}
export interface OcrResult {
  text: string
  lines: OcrLine[]
  dropped: DroppedLine[]
  text_angle: number
  /** Clockwise degrees the page was turned to read it upright (0, 90, 180, 270). */
  rotation: number
  timing: { det_ms: number; rec_ms: number; n_lines: number }
}

export interface ModelFiles {
  det: InferenceModel
  rec: InferenceModel
  recDict: string
  configJson?: Record<string, unknown>
  detYml?: string
}

interface Page {
  rows: number[][]
  angle: number
  rec: Map<number, { text: string; conf: number }>
  chars: Map<number, CharSpan[] | null>
  boxes: Quad[]
}

const r1 = (v: number) => Math.round(v * 10) / 10
const r2 = (v: number) => Math.round(v * 100) / 100
const r4 = (v: number) => Math.round(v * 1e4) / 1e4
const roundBox = (b: Pt[]): Pt[] => b.map(([x, y]) => [r1(x), r1(y)])
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

export class LineOCR {
  readonly cfg: OcrConfig
  readonly ops: CvOps
  private rec: Recognizer
  private files: ModelFiles

  constructor(cv: CV, files: ModelFiles, overrides?: Parameters<typeof buildConfig>[2]) {
    this.files = files
    this.ops = new CvOps(cv)
    this.cfg = buildConfig(files.detYml, files.configJson as Parameters<typeof buildConfig>[1], overrides)
    this.rec = new Recognizer(this.ops, files.rec, this.cfg.rec, Recognizer.charsFromDict(files.recDict))
  }

  detect(img: Mat): Promise<Quad[]> {
    return detect(this.ops, this.files.det, img, this.cfg.det)
  }

  /** Read a BGR page image (not consumed). */
  async read(input: Mat): Promise<OcrResult> {
    const ops = this.ops
    let img: Mat = input.clone()
    try {
      const shape: [number, number] = [img.rows, img.cols]
      const t0 = now()
      let boxes = await this.detect(img)
      const [h, w] = shape
      if (!boxes.length && h <= 200 && w >= 1.5 * h) {
        // Nothing found in a small, line-shaped image: read it whole as one line.
        boxes = [[[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]]]
      }
      const oc = this.cfg.ori
      let rotation = 0
      let skew = 0
      let tf: Mat3 = eye3() // original image -> working image
      const swap = (next: Mat) => {
        img.delete()
        img = next
      }
      if (oc.enabled) {
        const k = await this.sideways(img, boxes)
        if (k) {
          tf = matMul(rot90Matrix(k, [img.rows, img.cols]), tf)
          swap(ops.rot90(img, k))
          boxes = await this.detect(img)
          rotation = k === -1 ? 90 : 270
        }
        skew = pageSkew(boxes)
        if (Math.abs(skew) >= oc.deskew_above) {
          const d = ops.deskew(img, skew)
          swap(d.img)
          tf = matMul(d.m, tf)
          boxes = await this.detect(img)
        }
      }
      const t1 = now()
      let page = await this.page(img, boxes)
      if (oc.enabled && !rotation && (await this.upsideDown(img, page.boxes, page))) {
        tf = matMul(rot90Matrix(2, [img.rows, img.cols]), tf)
        swap(ops.rot90(img, 2))
        boxes = await this.detect(img)
        rotation = 180
        page = await this.page(img, boxes)
      }
      boxes = page.boxes
      const back = inv3(tf)
      const t2 = now()

      const { drop_below: drop, min_chars: minChars, junk_below: junkBelow, junk_invalid: junkInvalid } = this.cfg.rec
      const lines: OcrLine[] = []
      const dropped: DroppedLine[] = []
      const rowTexts: string[] = []
      const frag = fragments(boxes, page.rec)
      page.rows.forEach((r, ri) => {
        const parts: string[] = []
        for (const i of r) {
          const { conf } = page.rec.get(i)!
          const text = fixScripts(canonical(page.rec.get(i)!.text))
          if (frag.has(i)) continue
          let reason: DroppedLine['reason'] | null = null
          if (!text) reason = 'empty'
          else if (conf < drop) reason = 'low_confidence'
          else if (text.replaceAll(' ', '').length < minChars) reason = 'too_short'
          else if (conf < junkBelow && invalidShare(text) > junkInvalid) reason = 'invalid_thai'
          const entry = { text, confidence: r4(conf), row: ri, box: roundBox(applyM(back, boxes[i])) }
          if (reason) {
            dropped.push({ ...entry, reason })
            continue
          }
          parts.push(text)
          lines.push({
            ...entry,
            words: words(page.chars.get(i), boxes[i], text, conf).map((wd) => ({ ...wd, box: roundBox(applyM(back, wd.box)) })),
          })
        }
        if (parts.length) rowTexts.push(parts.join(' '))
      })
      const straightened = Math.abs(skew) >= oc.deskew_above ? skew : 0
      return {
        text: this.join(rowTexts),
        lines,
        dropped,
        text_angle: r2(page.angle + straightened),
        rotation,
        timing: { det_ms: r1(t1 - t0), rec_ms: r1(t2 - t1), n_lines: page.rec.size },
      }
    } finally {
      img.delete()
    }
  }

  /**
   * Recognition, then reading order. Each detected line is cut at wide blank
   * stretches; the pieces replace the line only if every piece survives the
   * line filter and together they read >= 90 % of the whole line's characters.
   */
  private async page(img: Mat, boxes: Quad[]): Promise<Page> {
    const groups = boxes.map((b) => splitOne(this.ops, img, b, this.cfg.det.split_gap))
    const changed = boxes.map((b, i) => groups[i].length > 1 || groups[i][0] !== b)
    const pieces = groups.flat()
    const whole = boxes.filter((_, i) => changed[i])
    const res = await this.readBoxes(img, [...pieces, ...whole])
    const final: Quad[] = []
    const out: RecResult[] = []
    let k = 0
    let e = pieces.length
    const nChars = (s: string) => s.replaceAll(' ', '').length
    boxes.forEach((b, bi) => {
      const g = groups[bi]
      const r = res.slice(k, k + g.length)
      k += g.length
      if (changed[bi]) {
        const alt = res[e++]
        const nPieces = r.reduce((a, x) => a + nChars(x.text), 0)
        if (Math.min(...r.map((x) => x.conf)) < this.cfg.rec.drop_below || nPieces < 0.9 * nChars(alt.text)) {
          final.push(b)
          out.push(alt)
          return
        }
      }
      final.push(...g)
      out.push(...r)
    })
    const angle = pageSkew(final)
    const rows = readingOrder(final, angle, true, out.map((x) => x.text))
    return {
      rows,
      angle,
      rec: new Map(out.map((x, i) => [i, { text: x.text, conf: x.conf }])),
      chars: new Map(out.map((x, i) => [i, x.chars])),
      boxes: final,
    }
  }

  /** Recognise every box; a tall box is also read turned both ways, best reading kept. */
  private async readBoxes(img: Mat, boxes: Quad[]): Promise<RecResult[]> {
    const ops = this.ops
    const raw = boxes.map((b) => ops.cropLine(img, b, 0))
    const tall = raw.map((c, n) => (c.rows >= 1.5 * c.cols ? n : -1)).filter((n) => n >= 0)
    const turned = ([1, -1] as const).flatMap((k) => tall.map((n) => ops.rot90(raw[n], k)))
    try {
      const res = await this.rec.recognizeDetail([...raw, ...turned])
      const out = res.slice(0, raw.length)
      tall.forEach((n, j) => {
        for (const alt of [res[raw.length + j], res[raw.length + tall.length + j]]) {
          if (alt.conf > out[n].conf) out[n] = { text: alt.text, conf: alt.conf, chars: null }
        }
      })
      return out
    } finally {
      for (const m of [...raw, ...turned]) m.delete()
    }
  }

  /** rot90 k that turns a sideways page upright, 0 if most lines are not vertical. */
  private async sideways(img: Mat, boxes: Quad[]): Promise<0 | 1 | -1> {
    const votes = boxes.map((b) => vertical(b, 2.0))
    const vert = boxes.filter((_, i) => votes[i] === 1)
    if (vert.length < 3 || vert.length <= votes.filter((v) => v === -1).length) return 0
    vert.sort((a, b) => dist(b[0], b[3]) - dist(a[0], a[3]))
    const raw = vert.slice(0, this.cfg.ori.sample).map((b) => this.ops.cropLine(img, b, 0))
    const turned = ([1, -1] as const).flatMap((k) => raw.map((c) => this.ops.rot90(c, k)))
    try {
      const res = await this.rec.recognize(turned)
      const ccw = res.slice(0, raw.length).reduce((a, x) => a + x.conf, 0)
      const cw = res.slice(raw.length).reduce((a, x) => a + x.conf, 0)
      return ccw > cw ? 1 : -1
    } finally {
      for (const m of [...raw, ...turned]) m.delete()
    }
  }

  /** Only for a page that reads badly: do its longest lines read better turned 180 degrees? */
  private async upsideDown(img: Mat, boxes: Quad[], page: Page): Promise<boolean> {
    const oc = this.cfg.ori
    const confs = [...page.rec.values()].filter((x) => [...x.text].length >= 2).map((x) => x.conf)
    if (confs.length < 3 || median(confs) >= oc.flip_below) return false
    const idx = [...page.rec.keys()]
      .filter((i) => vertical(boxes[i], 2.0) === -1)
      .sort((a, b) => dist(boxes[b][0], boxes[b][1]) - dist(boxes[a][0], boxes[a][1]))
      .slice(0, oc.sample)
    if (idx.length < 3) return false
    const up = mean(idx.map((i) => page.rec.get(i)!.conf))
    const flipped = idx.map((i) => {
      const c = this.ops.cropLine(img, boxes[i], 0)
      const f = this.ops.rot90(c, 2)
      c.delete()
      return f
    })
    try {
      const res = await this.rec.recognize(flipped)
      return mean(res.map((x) => x.conf)) > up + oc.flip_margin
    } finally {
      for (const m of flipped) m.delete()
    }
  }

  private join(rows: string[]): string {
    if (!this.cfg.join.thai_no_space) return rows.join('\n')
    // A Thai line wrap has no space at the break, so Thai-Thai joins get nothing.
    let out = rows[0] ?? ''
    for (const r of rows.slice(1)) out += (out && isThai(out[out.length - 1]) && isThai(r[0]) ? '' : '\n') + r
    return out
  }
}
