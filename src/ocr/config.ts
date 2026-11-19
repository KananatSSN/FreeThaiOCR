// SPDX-License-Identifier: Apache-2.0
// Derived from runtime/line_engine.py in iapp/OpenThai2.1-OCR-Text-20261118
// (https://huggingface.co/iapp/OpenThai2.1-OCR-Text-20261118), Copyright (c) iApp Technology,
// licensed under the Apache License 2.0. Ported to TypeScript and modified by the
// FreeThaiOCR contributors. See NOTICE.
// Engine settings: the reference DEFAULTS, then det.yml's PostProcess values,
// then the model's config.json, the same precedence as LineOCR.__init__.

export interface OcrConfig {
  det: {
    limit: number
    thresh: number
    box_thresh: number
    unclip: number
    min_size: number
    max_candidates: number
    v_pad: number
    /** Grow short horizontal boxes across the line to k * (1 + unclip) x their core height; 0 = off. */
    short_pad: number
    /** Detect again at a larger size when the page's lines are under this many detector px; 0 = off. */
    rescan_below: number
    rescan_target: number
    rescan_max: number
    split_gap: number
  }
  rec: {
    height: number
    max_w: number
    batch: number
    drop_below: number
    min_chars: number
    /** A line of digits only may be this short instead; null = min_chars. */
    min_chars_digits: number | null
    /** ...if its box is at least this share of the page's line height (0 = no condition). */
    min_chars_digits_height: number
    /** The same exception for one Latin letter. */
    min_chars_latin: boolean
    junk_below: number
    junk_invalid: number
    color: 'flatten' | 'gray' | 'gray_inv' | 'stretch' | 'bgr'
  }
  ori: { enabled: boolean; sample: number; flip_below: number; flip_margin: number; deskew_above: number }
  /** Floating tone marks and vowels put back into their line (LineOCR._attach_marks). */
  marks: { enabled: boolean; max_gap: number; max_ext: number; max_height: number; margin: number; page_share: number; page_min: number; keep_base: boolean }
  /** The list guard of the column logic (_list_pair); 0 = off. */
  cols: { list_rep: number; list_facing: number; list_max_w: number; list_enum: number }
  /** Second recognizer for loopless Thai fonts; file "" = off. */
  rec2: { file: string; min_mixed: number }
  join: { thai_no_space: boolean; decimal_comma: boolean; paragraphs: boolean; paragraph_gap: number }
}

export const DEFAULTS: OcrConfig = {
  det: {
    limit: 1280, thresh: 0.3, box_thresh: 0.6, unclip: 1.5, min_size: 3, max_candidates: 3000, v_pad: 0,
    short_pad: 0, rescan_below: 0, rescan_target: 20, rescan_max: 3200, split_gap: 1.2,
  },
  rec: {
    height: 48, max_w: 3200, batch: 16, drop_below: 0, min_chars: 1, min_chars_digits: null, min_chars_digits_height: 0,
    min_chars_latin: false, junk_below: 0, junk_invalid: 1, color: 'flatten',
  },
  ori: { enabled: true, sample: 8, flip_below: 0.8, flip_margin: 0.15, deskew_above: 2.5 },
  marks: { enabled: true, max_gap: 0.35, max_ext: 0.9, max_height: 0.9, margin: 0, page_share: 0.25, page_min: 3, keep_base: true },
  cols: { list_rep: 0.6, list_facing: 0, list_max_w: 10, list_enum: 0 },
  rec2: { file: '', min_mixed: 1 },
  join: { thai_no_space: false, decimal_comma: false, paragraphs: false, paragraph_gap: 1 },
}

/** Flat `key: value` pairs of a PaddleX inference.yml PostProcess block. */
export function parseYamlPostprocess(text: string): Record<string, number | string> {
  const out: Record<string, number | string> = {}
  let inPost = false
  for (const raw of text.split('\n')) {
    if (raw.startsWith('PostProcess:')) {
      inPost = true
      continue
    }
    if (inPost && raw && !raw.startsWith(' ')) break
    if (!inPost) continue
    const line = raw.trim()
    const i = line.indexOf(':')
    if (i < 0 || line.startsWith('- ')) continue
    const k = line.slice(0, i).trim()
    const v = line.slice(i + 1).trim()
    const n = Number(v)
    out[k] = v !== '' && Number.isFinite(n) ? n : v
  }
  return out
}

type Overrides = { [S in keyof OcrConfig]?: Partial<OcrConfig[S]> }

export function buildConfig(detYml?: string, configJson?: Overrides, overrides?: Overrides): OcrConfig {
  const cfg: OcrConfig = structuredClone(DEFAULTS)
  if (detYml) {
    const pp = parseYamlPostprocess(detYml)
    // Python only takes values the YAML wrote as floats ("0.4", not "3000").
    const isFloat = (k: string) => typeof pp[k] === 'number' && /[.eE]/.test(String(detYml.match(new RegExp(`^\\s*${k}:\\s*(\\S+)`, 'm'))?.[1]))
    if (isFloat('thresh')) cfg.det.thresh = pp.thresh as number
    if (isFloat('box_thresh')) cfg.det.box_thresh = pp.box_thresh as number
    if (isFloat('unclip_ratio')) cfg.det.unclip = pp.unclip_ratio as number
  }
  for (const section of [configJson, overrides]) {
    if (!section) continue
    for (const [k, v] of Object.entries(section)) {
      const key = k as keyof OcrConfig
      if (key in cfg && v) Object.assign(cfg[key], v)
    }
  }
  return cfg
}
