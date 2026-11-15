// SPDX-License-Identifier: Apache-2.0
// Derived from runtime/line_engine.py in iapp/OpenThai2.0-OCR-Text
// (https://huggingface.co/iapp/OpenThai2.0-OCR-Text), Copyright (c) iApp Technology,
// licensed under the Apache License 2.0. Ported to TypeScript and modified by the
// FreeThaiOCR contributors. See NOTICE.
// Small numeric helpers with the exact semantics the Python reference relies on.

export type Pt = [number, number]
/** Four corners: top-left, top-right, bottom-right, bottom-left. */
export type Quad = Pt[]
/** Row-major 3x3 homogeneous transform. */
export type Mat3 = number[][]

export const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1])
export const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]]
export const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]]
export const scale = (a: Pt, s: number): Pt => [a[0] * s, a[1] * s]

/** numpy.median: the mean of the two middle values for an even count. */
export function median(xs: number[]): number {
  if (!xs.length) return NaN
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

/** Python's round(): halves go to the even neighbour. */
export function pyRound(x: number): number {
  const r = Math.round(x)
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r
}

/** numpy.searchsorted(a, v, side='left') on an ascending array. */
export function searchsorted(a: ArrayLike<number>, v: number): number {
  let lo = 0
  let hi = a.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (a[mid] < v) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** 4 points -> top-left, top-right, bottom-right, bottom-left (order_points). */
export function orderPoints(pts: Pt[]): Quad {
  const byX = [...pts].sort((a, b) => a[0] - b[0])
  const left = byX.slice(0, 2).sort((a, b) => a[1] - b[1])
  const right = byX.slice(2).sort((a, b) => a[1] - b[1])
  return [left[0], right[0], right[1], left[1]].map((p) => [p[0], p[1]] as Pt)
}

export function applyM(m: Mat3, box: Pt[]): Pt[] {
  return box.map(([x, y]) => [m[0][0] * x + m[0][1] * y + m[0][2], m[1][0] * x + m[1][1] * y + m[1][2]] as Pt)
}

export function matMul(a: Mat3, b: Mat3): Mat3 {
  return a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j]))
}

export const eye3 = (): Mat3 => [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
]

export function inv3(m: Mat3): Mat3 {
  const [[a, b, c], [d, e, f], [g, h, i]] = m
  const A = e * i - f * h
  const B = -(d * i - f * g)
  const C = d * h - e * g
  const det = a * A + b * B + c * C
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ]
}

/** 3x3 map from an image of `shape` [H, W] to np.rot90(image, k) coordinates. */
export function rot90Matrix(k: 1 | -1 | 2, [H, W]: [number, number]): Mat3 {
  if (k === 1) return [[0, 1, 0], [-1, 0, W - 1], [0, 0, 1]] // counter-clockwise
  if (k === -1) return [[0, -1, H - 1], [1, 0, 0], [0, 0, 1]] // clockwise
  return [[-1, 0, W - 1], [0, -1, H - 1], [0, 0, 1]]
}

export const xs = (b: Pt[]) => b.map((p) => p[0])
export const ys = (b: Pt[]) => b.map((p) => p[1])
export const minOf = (a: number[]) => a.reduce((m, v) => (v < m ? v : m), Infinity)
export const maxOf = (a: number[]) => a.reduce((m, v) => (v > m ? v : m), -Infinity)
