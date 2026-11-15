// Image operations on OpenCV.js Mats, mirroring the cv2 calls of the reference.
// Every function returns a NEW Mat the caller must delete(); inputs are untouched.
import type { Mat } from '@techstark/opencv-js'
import { dist, median, type Pt, pyRound, searchsorted } from './geom'

// The OpenCV.js module object; typed loosely because its .d.ts models it as a namespace.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CV = any

export class CvOps {
  readonly cv: CV
  constructor(cv: CV) {
    this.cv = cv
  }

  /** Run fn with a scratch list of Mats that is always freed afterwards. */
  scoped<T>(fn: (keep: <M extends { delete(): void }>(m: M) => M) => T): T {
    const owned: { delete(): void }[] = []
    try {
      return fn((m) => {
        owned.push(m)
        return m
      })
    } finally {
      for (const m of owned) m.delete()
    }
  }

  /** RGBA pixels (canvas ImageData) -> BGR Mat, the layout cv2.imread gives. */
  fromRGBA(data: Uint8ClampedArray | Uint8Array, width: number, height: number): Mat {
    const cv = this.cv
    const rgba = new cv.Mat(height, width, cv.CV_8UC4)
    rgba.data.set(data)
    const bgr = new cv.Mat()
    cv.cvtColor(rgba, bgr, cv.COLOR_RGBA2BGR)
    rgba.delete()
    return bgr
  }

  /** np.rot90(img, k): k=1 counter-clockwise, k=-1 clockwise, k=2 half turn. */
  rot90(img: Mat, k: 1 | -1 | 2): Mat {
    const cv = this.cv
    const out = new cv.Mat()
    const code = k === 1 ? cv.ROTATE_90_COUNTERCLOCKWISE : k === -1 ? cv.ROTATE_90_CLOCKWISE : cv.ROTATE_180
    cv.rotate(img, out, code)
    return out
  }

  /** crop_line: perspective-rectify one quad; a tall cut is turned by rot90(turn). */
  cropLine(img: Mat, box: Pt[], turn: 0 | 1 | -1 = 1): Mat {
    const cv = this.cv
    const w = Math.max(Math.trunc(Math.max(dist(box[0], box[1]), dist(box[2], box[3]))), 1)
    const h = Math.max(Math.trunc(Math.max(dist(box[0], box[3]), dist(box[1], box[2]))), 1)
    const src = cv.matFromArray(4, 1, cv.CV_32FC2, box.flat())
    const dst = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, w, 0, w, h, 0, h])
    const m = cv.getPerspectiveTransform(src, dst)
    const out = new cv.Mat()
    cv.warpPerspective(img, out, m, new cv.Size(w, h), cv.INTER_CUBIC, cv.BORDER_REPLICATE)
    src.delete()
    dst.delete()
    m.delete()
    if (turn && h / w >= 1.5) {
      const r = this.rot90(out, turn)
      out.delete()
      return r
    }
    return out
  }

  gray(img: Mat): Mat {
    const cv = this.cv
    const out = new cv.Mat()
    if (img.channels() === 3) cv.cvtColor(img, out, cv.COLOR_BGR2GRAY)
    else img.copyTo(out)
    return out
  }

  grayToBgr(g: Mat): Mat {
    const cv = this.cv
    const out = new cv.Mat()
    cv.cvtColor(g, out, cv.COLOR_GRAY2BGR)
    return out
  }

  resize(img: Mat, w: number, h: number, interp?: number): Mat {
    const cv = this.cv
    const out = new cv.Mat()
    cv.resize(img, out, new cv.Size(w, h), 0, 0, interp ?? cv.INTER_LINEAR)
    return out
  }

  /**
   * _flatten: dark text on white from any line crop. Each column's background is
   * the median of the crop's top and bottom margin rows, smoothed along the
   * line; text is whatever differs from it, light or dark. Input: 1-channel Mat.
   */
  flatten(g: Mat): Mat {
    const cv = this.cv
    const h: number = g.rows
    const w: number = g.cols
    const px: Uint8Array = g.data
    const k = Math.max(2, Math.floor(h / 6))
    const rows: number[] = []
    for (let y = 0; y < Math.min(k, h); y++) rows.push(y)
    for (let y = Math.max(0, h - k); y < h; y++) rows.push(y)
    const bgRow = new cv.Mat(3, w, cv.CV_8UC1)
    const col: number[] = new Array(rows.length)
    for (let x = 0; x < w; x++) {
      for (let r = 0; r < rows.length; r++) col[r] = px[rows[r] * w + x]
      const v = Math.trunc(median(col))
      bgRow.data[x] = v
      bgRow.data[w + x] = v
      bgRow.data[2 * w + x] = v
    }
    const win = Math.max(3, Math.min(h | 1, 255))
    const blurred = new cv.Mat()
    cv.medianBlur(bgRow, blurred, win)
    const bg = blurred.data.subarray(w, 2 * w) as Uint8Array
    const d = new Float32Array(h * w)
    const hist = new Float64Array(256)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = Math.abs(px[y * w + x] - bg[x])
        d[y * w + x] = v
        hist[v]++
      }
    }
    for (let i = 1; i < 256; i++) hist[i] += hist[i - 1]
    const hi = Math.max(searchsorted(hist, 0.98 * hist[255]), 24)
    const f = Math.fround(255 / hi)
    const out = new cv.Mat(h, w, cv.CV_8UC1)
    const o: Uint8Array = out.data
    for (let i = 0; i < d.length; i++) {
      const t = Math.min(Math.max(Math.fround(d[i] * f), 0), 255)
      o[i] = Math.trunc(Math.fround(255 - t))
    }
    bgRow.delete()
    blurred.delete()
    return out
  }

  /** _deskew: rotate so lines leaning by `angle` degrees run level, canvas grown to fit. */
  deskew(img: Mat, angle: number): { img: Mat; m: number[][] } {
    const cv = this.cv
    const H: number = img.rows
    const W: number = img.cols
    const rm = cv.getRotationMatrix2D(new cv.Point(W / 2, H / 2), angle, 1.0)
    const m = [Array.from(rm.data64F.slice(0, 3)) as number[], Array.from(rm.data64F.slice(3, 6)) as number[]]
    rm.delete()
    const c = Math.abs(m[0][0])
    const s = Math.abs(m[0][1])
    const nW = pyRound(H * s + W * c)
    const nH = pyRound(H * c + W * s)
    m[0][2] += nW / 2 - W / 2
    m[1][2] += nH / 2 - H / 2
    // Fill with the median border colour (rows 0 and H-1, then columns 0 and W-1).
    const ch: number = img.channels()
    const px: Uint8Array = img.data
    const fill: number[] = []
    for (let k = 0; k < ch; k++) {
      const vals: number[] = []
      for (const y of [0, H - 1]) for (let x = 0; x < W; x++) vals.push(px[(y * W + x) * ch + k])
      for (const x of [0, W - 1]) for (let y = 0; y < H; y++) vals.push(px[(y * W + x) * ch + k])
      fill.push(Math.trunc(median(vals)))
    }
    const mm = cv.matFromArray(2, 3, cv.CV_64FC1, m.flat())
    const out = new cv.Mat()
    cv.warpAffine(img, out, mm, new cv.Size(nW, nH), cv.INTER_CUBIC, cv.BORDER_CONSTANT,
      new cv.Scalar(fill[0], fill[1] ?? 0, fill[2] ?? 0, 0))
    mm.delete()
    return { img: out, m: [...m, [0, 0, 1]] }
  }
}
