// Confidence levels for the viewer's word boxes. Both engines score a word as the
// mean of its characters' probabilities (src/ocr/layout.ts `words`), so one scale
// fits both tabs. (Line scores differ: Akson's is a product, so lines aren't coloured.)

export type ConfLevel = 'high' | 'mid' | 'low'

export const HIGH_AT = 0.95
export const MID_AT = 0.8

export const confLevel = (c: number): ConfLevel => (c >= HIGH_AT ? 'high' : c >= MID_AT ? 'mid' : 'low')

/** Box colours (canvas): stroke, fill, and a dash for low so it doesn't rely on colour alone. */
export const CONF_STYLE: Record<ConfLevel, { stroke: string; fill: string; dash?: number[] }> = {
  high: { stroke: 'rgba(22,163,74,0.8)', fill: 'rgba(22,163,74,0.08)' },
  mid: { stroke: 'rgba(217,119,6,0.9)', fill: 'rgba(217,119,6,0.12)' },
  low: { stroke: 'rgba(220,38,38,0.95)', fill: 'rgba(220,38,38,0.16)', dash: [4, 3] },
}

export const pct = (c: number) => `${Math.round(c * 100)}%`
