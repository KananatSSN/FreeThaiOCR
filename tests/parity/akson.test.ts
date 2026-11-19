// The AksonOCR-Lite port against the reference Python package (goldens: make_akson_goldens.py).
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { detectLines } from '../../src/ocr/akson/det'
import { rotateCcw } from '../../src/ocr/akson/orient'
import { cer, iou, loadAkson, loadPng, root, session } from './helpers'

const fixtures = path.join(root, 'tests', 'fixtures')
const goldens = path.join(root, 'tests', 'parity', 'goldens', 'akson')
const names = readdirSync(fixtures).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4))

type P = [number, number]
interface Golden {
  rotation: number
  text: string
  markdown: string
  lines: { text: string; poly: P[] }[]
  blocks: { label: string; order: number; html: string | null }[]
}

describe('AksonOCR-Lite port matches the reference', () => {
  for (const name of names) {
    it(name, async () => {
      const { engine } = await loadAkson()
      const want = JSON.parse(readFileSync(path.join(goldens, `${name}.json`), 'utf8')) as { det: P[][]; text: Golden; doc: Golden }
      const img = loadPng(engine as never, path.join(fixtures, `${name}.png`))
      try {
        // Detector on the upright page.
        const upright = rotateCcw(engine.ops, img, want.doc.rotation as 0 | 90 | 180 | 270)
        const det = await detectLines(engine.ops, await session('det.onnx', 'akson'), upright, 2.0)
        upright.delete()
        expect(det.length, 'detector quads').toBe(want.det.length)
        det.forEach((q, i) => expect(iou(q as P[], want.det[i]), `quad ${i}`).toBeGreaterThan(0.9))

        for (const mode of ['text', 'doc'] as const) {
          const w = want[mode]
          const got = await engine.page(img, mode === 'doc')
          expect(got.rotation, `${mode} rotation`).toBe(w.rotation)
          expect(got.lines.length, `${mode} lines`).toBe(w.lines.length)
          // A line with the same text may overlap down to 0.8: short words shift a pixel or two between
          // machines (ONNX Runtime's ARM vs x86 kernels), e.g. a table header cell on CI's x86.
          const boxDiffs = got.lines
            .map((l, i) => ({ i, l, v: iou(l.poly as P[], w.lines[i].poly) }))
            .filter(({ i, l, v }) => !(v > 0.9 || (v > 0.8 && l.text === w.lines[i].text)))
            .map(({ i, l, v }) => `${mode} line ${i} ${l.text} / ${w.lines[i].text}: overlap ${v.toFixed(3)}`)
          expect(boxDiffs).toEqual([])
          expect(cer(w.text, got.text), `${mode} text:\n${got.text}`).toBeLessThanOrEqual(0.002)
          expect(cer(w.markdown, got.markdown), `${mode} markdown:\n${got.markdown}`).toBeLessThanOrEqual(0.005)
          expect(got.blocks.map((b) => b.label), `${mode} block labels`).toEqual(w.blocks.map((b) => b.label))
          expect(got.blocks.map((b) => b.order), `${mode} block order`).toEqual(w.blocks.map((b) => b.order))
          got.blocks.forEach((b, i) => {
            if (w.blocks[i].html) expect(cer(w.blocks[i].html!, b.html ?? ''), `${mode} table ${i}`).toBeLessThanOrEqual(0.005)
          })
        }
      } finally {
        img.delete()
      }
    }, 120_000)
  }
})
