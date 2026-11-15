// SPDX-License-Identifier: Apache-2.0
// Derived from runtime/thai_norm.py and runtime/line_engine.py in iapp/OpenThai2.0-OCR-Text
// (https://huggingface.co/iapp/OpenThai2.0-OCR-Text), Copyright (c) iApp Technology,
// licensed under the Apache License 2.0. Ported to TypeScript and modified by the
// FreeThaiOCR contributors. See NOTICE.
// Port of runtime/thai_norm.py and the text helpers of runtime/line_engine.py
// (OpenThai2.0-OCR-Text, Apache-2.0). Keep in step with the Python reference:
// tests/parity checks this module against its output.

// Legacy Thai glyph variants (shifted/lowered marks, tail-less ฐ ญ) -> standard code points.
const PUA: Record<number, number> = {
  0xf700: 0x0e10, 0xf701: 0x0e34, 0xf702: 0x0e35, 0xf703: 0x0e36, 0xf704: 0x0e37,
  0xf705: 0x0e48, 0xf706: 0x0e49, 0xf707: 0x0e4a, 0xf708: 0x0e4b, 0xf709: 0x0e4c,
  0xf70a: 0x0e48, 0xf70b: 0x0e49, 0xf70c: 0x0e4a, 0xf70d: 0x0e4b, 0xf70e: 0x0e4c,
  0xf70f: 0x0e0d, 0xf710: 0x0e31, 0xf711: 0x0e4d, 0xf712: 0x0e47, 0xf713: 0x0e48,
  0xf714: 0x0e49, 0xf715: 0x0e4a, 0xf716: 0x0e4b, 0xf717: 0x0e4c, 0xf718: 0x0e38,
  0xf719: 0x0e39, 0xf71a: 0x0e3a,
}
const DROP = new Set([0x200b, 0x200c, 0x200d, 0x2060, 0x00ad, 0xfeff])

const VOWEL_MARKS = new Set('ัิีึืฺุู็')
const TONE_MARKS = new Set('่้๊๋์๎')
const MARK_CLASS = 'ัิ-ฺ็-๎'
const MARK_RUN = new RegExp(`[${MARK_CLASS}]{2,}`, 'g')
const SARA_AM = /([่-๋]?)ํ([่-๋]?)า/g
const SPACES = /[ \t\f\v]+/g

function translate(text: string): string {
  let out = ''
  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    if (DROP.has(cp)) continue
    if (cp === 0x00a0) out += ' '
    else if (cp in PUA) out += String.fromCodePoint(PUA[cp])
    else out += ch
  }
  return out
}

const markKey = (c: string) => (VOWEL_MARKS.has(c) ? 0 : TONE_MARKS.has(c) ? 1 : 2)

function orderMarks(run: string): string {
  const out: string[] = []
  // Array.prototype.sort is stable, like Python's sorted().
  for (const ch of [...run].sort((a, b) => markKey(a) - markKey(b))) {
    if (!out.length || out[out.length - 1] !== ch) out.push(ch) // a doubled mark renders as one
  }
  return out.join('')
}

/** Python str.strip() for the characters that can survive canonical(). */
const pyStrip = (s: string) => s.replace(/^\s+|\s+$/gu, '')

export function canonical(text: string): string {
  let t = translate(text ?? '').normalize('NFC')
  t = t.replace(MARK_RUN, orderMarks)
  t = t.replace(SARA_AM, (_m, a: string, b: string) => a + b + 'ำ')
  t = t.replaceAll('เเ', 'แ').replaceAll('ำำ', 'ำ')
  t = t.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
  return pyStrip(
    t
      .split('\n')
      .map((line) => pyStrip(line.replace(SPACES, ' ')))
      .join('\n'),
  )
}

// Script fix-ups for look-alikes: a lone Latin W glued to Thai letters (bold พ),
// and a Latin O or Arabic 0 inside a number written in Thai digits.
const LONE_W = /(?<![A-Za-z])[Ww](?=\.?[ก-ฮเ-ไ])/g
const ZERO_IN_THAI = /(?<=[๐-๙])[Oo0]|[Oo0](?=[๐-๙])/g

export function fixScripts(text: string): string {
  return text.replace(LONE_W, 'พ').replace(ZERO_IN_THAI, '๐')
}

export const isThai = (ch: string) => ch >= '฀' && ch <= '๿'
const MARKS = new Set('ัิีึืฺุู็่้๊๋์ํ๎')
const LEADING = new Set('เแโใไ')
const isCons = (ch: string | undefined) => ch !== undefined && ch >= 'ก' && ch <= 'ฮ'

/** Share of Thai characters that break Thai spelling (orphan marks, dangling leading vowels). */
export function invalidShare(text: string): number {
  const cs = [...text]
  let thai = 0
  let bad = 0
  cs.forEach((ch, i) => {
    if (!isThai(ch)) return
    thai++
    const prev = i ? cs[i - 1] : ' '
    if (MARKS.has(ch) && !(isCons(prev) || (MARKS.has(prev) && i >= 2 && isCons(cs[i - 2])))) bad++
    else if (LEADING.has(ch) && !(i + 1 < cs.length && isCons(cs[i + 1]))) bad++
  })
  return thai ? bad / thai : 0
}
