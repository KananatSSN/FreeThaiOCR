import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { cer, iou, loadEngine, loadPng, root } from './helpers'

const fixtures = path.join(root, 'tests', 'fixtures')
const goldens = path.join(root, 'tests', 'parity', 'goldens')
const names = readdirSync(fixtures).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4))

type P = [number, number]
interface Line {
  text: string
  confidence: number
  box: P[]
  reason?: string
}

describe('engine matches the Python reference', () => {
  for (const name of names) {
    it(name, async () => {
      const { engine } = await loadEngine()
      const want = JSON.parse(readFileSync(path.join(goldens, `${name}.json`), 'utf8'))
      const img = loadPng(engine, path.join(fixtures, `${name}.png`))
      try {
        const det = await engine.detect(img)
        expect(det.length, 'raw detector box count').toBe(want.det_boxes.length)
        const got = await engine.read(img)
        expect(got.rotation).toBe(want.rotation)
        expect(Math.abs(got.text_angle - want.text_angle)).toBeLessThan(0.2)

        // OpenCV.js and Python's OpenCV warp and resize to slightly different pixels (same release,
        // different code paths), so a line read right at the confidence cut-off can be kept by one
        // and dropped by the other. Allowed only when both read it within 0.02 of the cut-off.
        const drop = engine.cfg.rec.drop_below
        const borderline = (l: Line) => Math.abs(l.confidence - drop) <= 0.02
        const same = (a: Line, b: Line) => iou(a.box, b.box) > 0.9
        const onlyGot = got.lines.filter((l) => !(want.lines as Line[]).some((w) => same(l, w)))
        const onlyWant = (want.lines as Line[]).filter((w) => !got.lines.some((l) => same(l, w)))
        for (const l of onlyGot) {
          const other = (want.dropped as Line[]).find((d) => same(d, l))
          expect(borderline(l) && other?.reason === 'low_confidence' && borderline(other), `kept only here: ${l.text} (${l.confidence})`).toBe(true)
        }
        for (const l of onlyWant) {
          const other = got.dropped.find((d) => same(d, l))
          expect(borderline(l) && other?.reason === 'low_confidence' && borderline(other), `kept only by the reference: ${l.text} (${l.confidence})`).toBe(true)
        }
        const gotLines = got.lines.filter((l) => !onlyGot.includes(l))
        const wantLines = (want.lines as Line[]).filter((l) => !onlyWant.includes(l))
        expect(gotLines.length).toBe(wantLines.length)
        if (!onlyGot.length && !onlyWant.length) expect(cer(want.text, got.text), `text:\n${got.text}`).toBeLessThanOrEqual(0.002)
        else expect(cer(wantLines.map((l) => l.text).join('\n'), gotLines.map((l) => l.text).join('\n'))).toBeLessThanOrEqual(0.002)
        gotLines.forEach((l, i) => expect(iou(l.box, wantLines[i].box), `line ${i} box`).toBeGreaterThan(0.9))
      } finally {
        img.delete()
      }
    })
  }
})
