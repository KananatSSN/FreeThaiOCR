import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { cer, iou, loadEngine, loadPng, root } from './helpers'

const fixtures = path.join(root, 'tests', 'fixtures')
const goldens = path.join(root, 'tests', 'parity', 'goldens')
const names = readdirSync(fixtures).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4))

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
        expect(got.lines.length).toBe(want.lines.length)
        expect(cer(want.text, got.text), `text:\n${got.text}`).toBeLessThanOrEqual(0.002)
        got.lines.forEach((l, i) => expect(iou(l.box, want.lines[i].box), `line ${i} box`).toBeGreaterThan(0.9))
      } finally {
        img.delete()
      }
    })
  }
})
