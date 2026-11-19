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

        // Allowed differences, from arithmetic that differs between machines (OpenCV.js vs Python's
        // OpenCV; ONNX Runtime's ARM vs x86 kernels), each visible on the new table fixtures:
        //  - at most one line per page that one side keeps and the other drops for low confidence
        //    (an unstable reading: CI's x86 read the report's "1,250,000" cell at 0.94, the
        //    ARM reference at 0.78);
        //  - a line with the same text may have a box overlap down to 0.8 (short cells shift a pixel).
        const same = (a: Line, b: Line) => iou(a.box, b.box) > 0.8
        const onlyGot = got.lines.filter((l) => !(want.lines as Line[]).some((w) => same(l, w)))
        const onlyWant = (want.lines as Line[]).filter((w) => !got.lines.some((l) => same(l, w)))
        const unstable = [
          ...onlyGot.map((l) => ({ l, other: (want.dropped as Line[]).find((d) => same(d, l)) })),
          ...onlyWant.map((l) => ({ l, other: got.dropped.find((d) => same(d, l)) as Line | undefined })),
        ]
        const diffs = unstable.map(({ l, other }) => `${l.text} (${l.confidence}) vs ${other ? `dropped ${other.text} (${other.confidence}, ${other.reason})` : 'nothing'}`)
        expect(unstable.every(({ other }) => other?.reason === 'low_confidence') && unstable.length <= 1, `lines kept by one side only:\n${diffs.join('\n')}`).toBe(true)
        const gotLines = got.lines.filter((l) => !onlyGot.includes(l))
        const wantLines = (want.lines as Line[]).filter((l) => !onlyWant.includes(l))
        expect(gotLines.length).toBe(wantLines.length)
        if (!unstable.length) expect(cer(want.text, got.text), `text:\n${got.text}`).toBeLessThanOrEqual(0.002)
        else expect(cer(wantLines.map((l) => l.text).join('\n'), gotLines.map((l) => l.text).join('\n'))).toBeLessThanOrEqual(0.002)
        const boxDiffs = gotLines
          .map((l, i) => ({ i, l, w: wantLines[i], v: iou(l.box, wantLines[i].box) }))
          .filter(({ l, w, v }) => !(v > 0.9 || (v > 0.8 && l.text === w.text)))
        expect(boxDiffs.map(({ i, l, v }) => `line ${i} ${l.text}: overlap ${v.toFixed(3)}`)).toEqual([])
      } finally {
        img.delete()
      }
    })
  }
})
