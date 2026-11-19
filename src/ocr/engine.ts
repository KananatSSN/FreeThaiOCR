// SPDX-License-Identifier: Apache-2.0
// Derived from runtime/line_engine.py in iapp/OpenThai2.1-OCR-Text-20261118
// (https://huggingface.co/iapp/OpenThai2.1-OCR-Text-20261118), Copyright (c) iApp Technology,
// licensed under the Apache License 2.0. Ported to TypeScript and modified by the
// FreeThaiOCR contributors. See NOTICE.
// LineOCR: TypeScript port of runtime/line_engine.py from
// iapp/OpenThai2.1-OCR-Text-20261118 (Apache-2.0). Detector -> line splitting ->
// orientation/deskew -> recognition (and the rec2 re-read) -> reading order ->
// floating-mark re-read -> filtering.
import type { Mat } from '@techstark/opencv-js'
import { buildConfig, type OcrConfig } from './config'
import { CvOps, type CV } from './cvops'
import { detect } from './detect'
import { applyM, dist, eye3, inv3, type Mat3, matMul, mean, median, type Pt, type Quad, rot90Matrix } from './geom'
import { fragments, lineHeight, pageSkew, readingOrder, splitOne, vertical, type Word, words } from './layout'
import type { InferenceModel } from './model'
import { type CharSpan, Recognizer, type RecResult } from './recognize'
import { baseLetters, canonical, decimalComma, digitsOf, fixScripts, invalidShare, isThai, mixedLatin } from './thaiNorm'

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
  /**
   * The second recognizer (loopless Thai fonts), used only to re-read lines with
   * Latin letters inside Thai words. A loader is called the first time one shows up.
   */
  rec2?: InferenceModel | (() => Promise<InferenceModel>)
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
const LATIN = new Set('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz')
const DIGIT_CLASS = new Set('0123456789๐๑๒๓๔๕๖๗๘๙')

export class LineOCR {
  readonly cfg: OcrConfig
  readonly ops: CvOps
  private rec: Recognizer
  private rec2: Promise<Recognizer> | null = null
  private files: ModelFiles
  private chars: string[]

  constructor(cv: CV, files: ModelFiles, overrides?: Parameters<typeof buildConfig>[2]) {
    this.files = files
    this.ops = new CvOps(cv)
    this.cfg = buildConfig(files.detYml, files.configJson as Parameters<typeof buildConfig>[1], overrides)
    this.chars = Recognizer.charsFromDict(files.recDict)
    this.rec = new Recognizer(this.ops, files.rec, this.cfg.rec, this.chars)
  }

  /** The loopless-font recognizer, loaded on first use; null when the config or the files leave it out. */
  private secondRecognizer(): Promise<Recognizer> | null {
    const src = this.files.rec2
    if (!this.cfg.rec2.file || !src) return null
    if (!this.rec2) {
      const p = (typeof src === 'function' ? src() : Promise.resolve(src)).then((m) => new Recognizer(this.ops, m, this.cfg.rec, this.chars))
      // A failed download must not stick: the next page tries again.
      p.catch(() => {
        if (this.rec2 === p) this.rec2 = null
      })
      this.rec2 = p
    }
    return this.rec2
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
      const frag = fragments(page.boxes, page.rec)
      if (this.cfg.marks.enabled) for (const j of await this.attachMarks(img, page, frag)) frag.add(j)
      boxes = page.boxes
      const back = inv3(tf)
      const t2 = now()

      const lines: OcrLine[] = []
      const dropped: DroppedLine[] = []
      const rowTexts: string[] = []
      const rowGeom: ([number, number] | null)[] = []
      const hmed = boxes.length ? lineHeight(boxes) : 1.0
      page.rows.forEach((r, ri) => {
        const parts: string[] = []
        for (const i of r) {
          const { conf } = page.rec.get(i)!
          let text = fixScripts(canonical(page.rec.get(i)!.text))
          if (this.cfg.join.decimal_comma) text = decimalComma(text)
          if (frag.has(i)) continue
          const reason = this.dropReason(text, conf, dist(boxes[i][0], boxes[i][3]) / hmed)
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
        if (parts.length) {
          rowTexts.push(parts.join(' '))
          const yv = r.filter((j) => !frag.has(j)).flatMap((j) => boxes[j].map((p) => p[1]))
          rowGeom.push(yv.length ? [Math.min(...yv), Math.max(...yv)] : null)
        }
      })
      const straightened = Math.abs(skew) >= oc.deskew_above ? skew : 0
      return {
        text: this.join(rowTexts, rowGeom, hmed),
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
    const rows = readingOrder(final, angle, true, out.map((x) => x.text), this.cfg.cols)
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
      // Latin letters inside a Thai word: a loopless face read as look-alikes. Read the
      // line again with rec2 and keep that reading if it has fewer of them.
      const sus = out.map((r, n) => (r.chars !== null && mixedLatin(r.text) >= this.cfg.rec2.min_mixed ? n : -1)).filter((n) => n >= 0)
      const pending = sus.length ? this.secondRecognizer() : null
      // Not downloadable right now (offline before it was ever needed): keep the first reading.
      const rec2 = pending && (await pending.catch(() => null))
      if (rec2) {
        const alts = await rec2.recognizeDetail(sus.map((n) => raw[n]))
        sus.forEach((n, j) => {
          if (mixedLatin(alts[j].text) < mixedLatin(out[n].text)) out[n] = alts[j]
        })
      }
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

  /** Why the line filter drops a (canonical, script-fixed) reading; hratio is its box height over the page's line height. */
  private dropReason(text: string, conf: number, hratio?: number): DroppedLine['reason'] | null {
    const rc = this.cfg.rec
    if (!text) return 'empty'
    if (conf < rc.drop_below) return 'low_confidence'
    const bare = text.replaceAll(' ', '')
    let short = rc.min_chars
    const inClass = (ch: string) => DIGIT_CLASS.has(ch) || (rc.min_chars_latin && LATIN.has(ch))
    if (
      rc.min_chars_digits !== null &&
      rc.min_chars_digits !== undefined &&
      bare &&
      [...bare].every(inClass) &&
      (rc.min_chars_digits_height <= 0 || (hratio !== undefined && hratio >= rc.min_chars_digits_height))
    ) {
      short = rc.min_chars_digits // a lone quantity in a table cell ("2") is not junk
    }
    if ([...bare].length < short) return 'too_short'
    if (conf < rc.junk_below && invalidShare(text) > rc.junk_invalid) return 'invalid_thai'
    return null
  }

  /**
   * Floating Thai marks (old letterpress books, some display fonts): the detector
   * boxes a line without its tone marks and upper vowels and finds them as boxes of
   * their own, which the line filter drops. Such a box within max_gap line heights
   * above or below a kept line it overlaps is absorbed into that line, whose box
   * grows to take it in, and the line is read again. When page_share of the lines
   * (and page_min) had marks attached, the typeface floats its marks and every other
   * line grows by the median reach too. A re-read is kept only if it passes the line
   * filter and changes no digit and, unless the page floats its marks, nothing but
   * marks (keep_base). Mutates `page`; returns the absorbed boxes of re-read lines.
   */
  private async attachMarks(img: Mat, page: Page, frag: Set<number>): Promise<Set<number>> {
    const mc = this.cfg.marks
    const { boxes, rec } = page
    const n = boxes.length
    let hmed = n ? lineHeight(boxes) : 1.0
    const junk = boxes.map(
      (b, i) => frag.has(i) || this.dropReason(fixScripts(canonical(rec.get(i)!.text)), rec.get(i)!.conf, dist(b[0], b[3]) / hmed) !== null,
    )
    if (!junk.some(Boolean) || junk.every(Boolean)) return new Set()
    hmed = lineHeight(boxes.filter((_, i) => !junk[i]))
    // Kept full-height line -> its frame: origin, unit vectors along and across, width, height.
    const frame = new Map<number, { o: Pt; u: Pt; v: Pt; wa: number; ha: number }>()
    for (let a = 0; a < n; a++) {
      if (junk[a]) continue
      const b = boxes[a]
      const wa = dist(b[1], b[0])
      const ha = dist(b[3], b[0])
      if (wa >= 1 && ha >= 0.5 * hmed) {
        frame.set(a, { o: b[0], u: [(b[1][0] - b[0][0]) / wa, (b[1][1] - b[0][1]) / wa], v: [(b[3][0] - b[0][0]) / ha, (b[3][1] - b[0][1]) / ha], wa, ha })
      }
    }
    if (!frame.size) return new Set()
    const proj = (a: number, j: number): [number, number, number, number] => {
      const { o, u, v } = frame.get(a)!
      const s = boxes[j].map((p) => (p[0] - o[0]) * u[0] + (p[1] - o[1]) * u[1])
      const t = boxes[j].map((p) => (p[0] - o[0]) * v[0] + (p[1] - o[1]) * v[1])
      return [Math.min(...s), Math.max(...s), Math.min(...t), Math.max(...t)]
    }
    const reach = new Map<number, [number, number]>([...frame.keys()].map((a) => [a, [0, 0]])) // [above, below], px
    const owner = new Map<number, number>() // mark box -> its line
    for (let j = 0; j < n; j++) {
      if (!junk[j]) continue
      let best: { gap: number; side: number; a: number; ext: number } | null = null
      for (const [a, { wa, ha }] of frame) {
        const [s0, s1, t0, t1] = proj(a, j)
        if (t1 - t0 > mc.max_height * ha || Math.min(s1, wa) - Math.max(s0, 0) < 0.5 * (s1 - s0)) continue
        let gap: number, side: number, ext: number
        if (t1 <= 0.5 * ha) [gap, side, ext] = [Math.max(0, -t1), 0, -t0]
        else if (t0 >= 0.5 * ha) [gap, side, ext] = [Math.max(0, t0 - ha), 1, t1 - ha]
        else continue // across the line's middle: part of the line, not a mark
        if (gap > mc.max_gap * ha || ext > mc.max_ext * ha) continue
        if (best === null || gap < best.gap || (gap === best.gap && side < best.side)) best = { gap, side, a, ext }
      }
      if (best) {
        owner.set(j, best.a)
        const r = reach.get(best.a)!
        r[best.side] = Math.max(r[best.side], best.ext)
      }
    }
    if (!owner.size) return new Set()
    let floating = false // the page's typeface floats its marks
    for (const side of [0, 1]) {
      const lifted = [...frame.keys()].filter((a) => reach.get(a)![side] > 0)
      if (lifted.length < Math.max(mc.page_min, mc.page_share * frame.size)) continue
      floating = true
      const typ = median(lifted.map((a) => reach.get(a)![side] / frame.get(a)!.ha))
      for (const [a, { wa, ha }] of frame) {
        if (reach.get(a)![side] > 0) continue
        let room = typ * ha
        for (const b of frame.keys()) {
          // Stop short of the neighbouring line's core.
          if (b === a) continue
          const [s0, s1, t0, t1] = proj(a, b)
          if (Math.min(s1, wa) - Math.max(s0, 0) <= 0) continue
          if (side === 0 && t1 <= 0.5 * ha) room = Math.min(room, Math.max(0, -t1 * 0.9))
          else if (side === 1 && t0 >= 0.5 * ha) room = Math.min(room, Math.max(0, (t0 - ha) * 0.9))
        }
        reach.get(a)![side] = room
      }
    }
    const grown: number[] = []
    const newBoxes: Quad[] = []
    const H: number = img.rows
    const W: number = img.cols
    for (const [a, { v, ha }] of frame) {
      const [up, down] = reach.get(a)!
      if (up <= 0 && down <= 0) continue
      const b: Quad = boxes[a].map((p) => [p[0], p[1]] as Pt)
      if (up > 0) for (const k of [0, 1]) b[k] = [b[k][0] - v[0] * (up + mc.margin * ha), b[k][1] - v[1] * (up + mc.margin * ha)]
      if (down > 0) for (const k of [2, 3]) b[k] = [b[k][0] + v[0] * (down + mc.margin * ha), b[k][1] + v[1] * (down + mc.margin * ha)]
      grown.push(a)
      newBoxes.push(b.map(([x, y]) => [Math.fround(Math.min(Math.max(x, 0), W - 1)), Math.fround(Math.min(Math.max(y, 0), H - 1))] as Pt))
    }
    const done = new Set<number>()
    const res = newBoxes.length ? await this.readBoxes(img, newBoxes) : []
    grown.forEach((a, k) => {
      const r = res[k]
      const next = fixScripts(canonical(r.text))
      if (this.dropReason(next, r.conf) !== null) return
      // A speck taken for a mark must not change the line (a tax ID's "0" became "ฉ"). On a
      // page whose type floats its marks the letters may change too, but never a digit.
      const old = fixScripts(canonical(rec.get(a)!.text))
      if (mc.keep_base && (floating ? digitsOf(next) !== digitsOf(old) : baseLetters(next) !== baseLetters(old))) return
      boxes[a] = newBoxes[k]
      rec.set(a, { text: r.text, conf: r.conf })
      page.chars.set(a, r.chars)
      done.add(a)
    })
    // Marks count as absorbed only where their line was read again.
    return new Set([...owner].filter(([, a]) => done.has(a)).map(([j]) => j))
  }

  private join(rows: string[], geom?: ([number, number] | null)[], hline = 1.0): string {
    const jc = this.cfg.join
    if (jc.paragraphs && geom && geom.length === rows.length && !jc.thai_no_space) {
      // A blank line between rows further apart than paragraph_gap line heights, or where reading moves back up.
      const out: string[] = []
      let prev: [number, number] | null = null
      rows.forEach((r, k) => {
        const g = geom[k]
        if (out.length && prev && g && (g[0] - prev[1] > jc.paragraph_gap * hline || g[1] < prev[0])) out.push('')
        out.push(r)
        prev = g ?? prev
      })
      return out.join('\n')
    }
    if (!this.cfg.join.thai_no_space) return rows.join('\n')
    // A Thai line wrap has no space at the break, so Thai-Thai joins get nothing.
    let out = rows[0] ?? ''
    for (const r of rows.slice(1)) out += (out && isThai(out[out.length - 1]) && isThai(r[0]) ? '' : '\n') + r
    return out
  }
}
