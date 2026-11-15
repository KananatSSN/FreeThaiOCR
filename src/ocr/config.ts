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
    split_gap: number
  }
  rec: {
    height: number
    max_w: number
    batch: number
    drop_below: number
    min_chars: number
    junk_below: number
    junk_invalid: number
    color: 'flatten' | 'gray' | 'gray_inv' | 'stretch' | 'bgr'
  }
  ori: { enabled: boolean; sample: number; flip_below: number; flip_margin: number; deskew_above: number }
  join: { thai_no_space: boolean }
}

export const DEFAULTS: OcrConfig = {
  det: { limit: 1280, thresh: 0.3, box_thresh: 0.6, unclip: 1.5, min_size: 3, max_candidates: 3000, v_pad: 0, split_gap: 1.2 },
  rec: { height: 48, max_w: 3200, batch: 16, drop_below: 0, min_chars: 1, junk_below: 0, junk_invalid: 1, color: 'flatten' },
  ori: { enabled: true, sample: 8, flip_below: 0.8, flip_margin: 0.15, deskew_above: 2.5 },
  join: { thai_no_space: false },
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
