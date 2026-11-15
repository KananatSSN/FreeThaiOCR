// Synthesises the promo's soundtrack from scratch (no samples, no third-party
// audio), so it is fully original and free to use anywhere.
//
//   node scripts/make-music.mjs      -> public/audio/music.mp3 + sfx.mp3
//
// 120 BPM: one beat = 0.5 s = 15 video frames. The video cuts on beats
// 4, 8, 13, 17, 21, 26, 30 and 34 (see CUT_BEATS and src/Promo.tsx); the CTA
// lands on beat 34 with a big hit. Two tracks so their levels can be set
// separately in Remotion: music (drums, bass, chords) and sfx (whooshes, hit).
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const SR = 44100
const BPM = 120
const BEAT = 60 / BPM
const LENGTH = 20 // seconds, same as the video
const N = SR * LENGTH
export const CUT_BEATS = [4, 8, 13, 17, 21, 26, 30, 34]
const DROP = 4 // beat where the groove starts (first cut)
const HIT = 34 // CTA

// Deterministic noise so every run produces the same file.
let seed = 0x9e3779b9
const rnd = () => {
  seed ^= seed << 13
  seed ^= seed >>> 17
  seed ^= seed << 5
  return ((seed >>> 0) / 4294967296) * 2 - 1
}

const track = () => [new Float32Array(N), new Float32Array(N)]
const music = track()
const sfx = track()
const t2i = (t) => Math.round(t * SR)
const beatT = (b) => b * BEAT
const lpCoef = (fc) => 1 - Math.exp((-2 * Math.PI * fc) / SR)
const mtof = (m) => 440 * 2 ** ((m - 69) / 12)

function add(buf, i, l, r = l) {
  if (i >= 0 && i < N) {
    buf[0][i] += l
    buf[1][i] += r
  }
}

// --- instruments ----------------------------------------------------------------
function kick(buf, t, gain = 1) {
  const start = t2i(t)
  let ph = 0
  for (let n = 0; n < SR * 0.45; n++) {
    const s = n / SR
    const f = 45 + 115 * Math.exp(-s * 28)
    ph += (2 * Math.PI * f) / SR
    const env = Math.exp(-s * 7.5)
    const click = n < 60 ? (1 - n / 60) * 0.5 * rnd() : 0
    const v = (Math.sin(ph) * env + click) * 0.9 * gain
    add(buf, start + n, v)
  }
}

function clap(buf, t, gain = 1) {
  const start = t2i(t)
  let prev = 0
  let bp = 0
  for (let n = 0; n < SR * 0.25; n++) {
    const s = n / SR
    // three quick bursts then a tail, like hands clapping together
    const burst = [0, 0.011, 0.022].some((o) => s >= o && s < o + 0.006) ? 1 : 0
    const env = burst ? 1 : Math.exp(-(s - 0.022) * 22) * (s > 0.022 ? 1 : 0)
    const x = rnd()
    const hp = x - prev
    prev = x
    bp += lpCoef(2500) * (hp - bp)
    add(buf, start + n, bp * env * 0.55 * gain, bp * env * 0.5 * gain)
  }
}

function hat(buf, t, open = false, gain = 1, pan = 0.15) {
  const start = t2i(t)
  const len = open ? 0.14 : 0.04
  let prev = 0
  for (let n = 0; n < SR * len * 1.5; n++) {
    const s = n / SR
    const x = rnd()
    const hp = x - prev
    prev = x
    const v = hp * Math.exp(-s / (len / 3)) * 0.18 * gain
    add(buf, start + n, v * (1 - pan), v * (1 + pan))
  }
}

/** Detuned saw stack through a lowpass, with an amplitude envelope. */
function synth(buf, t, notes, dur, { gain = 0.2, cutoff = 2400, attack = 0.005, release = 0.12, detune = 0.012, voices = 3 } = {}) {
  const start = t2i(t)
  const total = Math.round((dur + release) * SR)
  const oscs = notes.flatMap((m) => Array.from({ length: voices }, (_, v) => ({ f: mtof(m) * (1 + (v - (voices - 1) / 2) * detune), ph: (rnd() + 1) / 2, side: v % 2 ? 1 : -1 })))
  let lpL = 0
  let lpR = 0
  const a = lpCoef(cutoff)
  for (let n = 0; n < total; n++) {
    const s = n / SR
    const env = s < attack ? s / attack : s < dur ? 1 : Math.exp(-(s - dur) / (release / 4))
    let l = 0
    let r = 0
    for (const o of oscs) {
      o.ph += o.f / SR
      o.ph -= Math.floor(o.ph)
      const saw = 2 * o.ph - 1
      if (o.side < 0) l += saw
      else r += saw
      l += saw * 0.4
      r += saw * 0.4
    }
    lpL += a * (l - lpL)
    lpR += a * (r - lpR)
    const k = (gain * env) / oscs.length
    add(buf, start + n, lpL * k, lpR * k)
  }
}

function bass(buf, t, midi, dur, gain = 0.5) {
  const start = t2i(t)
  const f = mtof(midi)
  let ph = 0
  let lp = 0
  for (let n = 0; n < (dur + 0.05) * SR; n++) {
    const s = n / SR
    ph += f / SR
    ph -= Math.floor(ph)
    const saw = 2 * ph - 1
    const sq = ph < 0.5 ? 1 : -1
    const cutoff = 300 + 1600 * Math.exp(-s * 18) // pluck: bright attack, mellow body
    lp += lpCoef(cutoff) * ((saw * 0.6 + sq * 0.4) - lp)
    const env = s < 0.004 ? s / 0.004 : s < dur ? Math.exp(-s * 2.5) : Math.exp(-s * 2.5) * Math.exp(-(s - dur) * 60)
    const sub = Math.sin(2 * Math.PI * (f / 2) * s) * 0.5
    add(buf, start + n, (lp + sub * 0.6) * env * gain)
  }
}

/** Filtered noise sweep. `rise`: get louder and brighter towards the end. */
function noiseSweep(buf, t0, t1, { from = 300, to = 8000, gain = 0.25, panFrom = -0.6, panTo = 0.6, shape = 'rise' } = {}) {
  const a0 = t2i(t0)
  const len = t2i(t1) - a0
  let lp = 0
  let hpPrev = 0
  for (let n = 0; n < len; n++) {
    const p = n / len
    const fc = from * (to / from) ** p
    const x = rnd()
    lp += lpCoef(fc) * (x - lp)
    const hp = lp - hpPrev * 0.98
    hpPrev = lp
    const env = shape === 'rise' ? p ** 2.2 : shape === 'swell' ? Math.sin(Math.PI * p) ** 1.5 : (1 - p) ** 2
    const pan = panFrom + (panTo - panFrom) * p
    const v = hp * env * gain
    add(buf, a0 + n, v * (1 - pan), v * (1 + pan))
  }
}

function impact(buf, t) {
  kick(buf, t, 1.3)
  // long washy crash
  noiseSweep(buf, t, t + 2.4, { from: 9000, to: 1500, gain: 0.32, panFrom: 0, panTo: 0, shape: 'fall' })
  // sub drop
  const start = t2i(t)
  for (let n = 0; n < SR * 1.6; n++) {
    const s = n / SR
    const f = 70 * Math.exp(-s * 0.9)
    add(buf, start + n, Math.sin(2 * Math.PI * f * s) * Math.exp(-s * 2.2) * 0.55)
  }
}

// --- arrangement (A minor: Am - F - C - G, one chord per bar) ---------------------
const CHORDS = [
  { root: 45, notes: [57, 60, 64] }, // Am
  { root: 41, notes: [53, 57, 60] }, // F
  { root: 48, notes: [55, 60, 64] }, // C
  { root: 43, notes: [55, 59, 62] }, // G
]
const chordAt = (beat) => CHORDS[Math.floor((beat - DROP) / 4 + 4) % 4]

// Intro (beats 0-4): pad swelling under a riser, a few hats.
synth(music, 0, CHORDS[0].notes.map((m) => m - 12), beatT(DROP) - 0.05, { gain: 0.42, cutoff: 1400, attack: 0.25, release: 0.3, voices: 4 })
noiseSweep(music, 0, beatT(DROP), { from: 200, to: 9000, gain: 0.45 })
// A muted pulse so the hook isn't empty: soft bass eighths and hats building up.
for (let b = 0; b < DROP; b += 0.5) bass(music, beatT(b), CHORDS[0].root, BEAT / 2 - 0.04, 0.12 + 0.05 * b)
for (let b = 1; b < DROP; b += 0.25) hat(music, beatT(b), false, 0.4 + 0.15 * b)

// Groove (beats 4-34).
for (let b = DROP; b < HIT; b++) {
  const t = beatT(b)
  kick(music, t)
  if (b % 2 === 1) clap(music, t)
  hat(music, t + BEAT / 2, true, 0.9, 0.2) // offbeat open hat
  hat(music, t + BEAT / 4, false, 0.5, -0.2)
  hat(music, t + (3 * BEAT) / 4, false, 0.5, -0.2)
  const ch = chordAt(b)
  // bass: eighth notes, root / octave
  bass(music, t, ch.root, BEAT / 2 - 0.02)
  bass(music, t + BEAT / 2, ch.root + 12, BEAT / 2 - 0.02, 0.38)
  // chord stab on the offbeat
  synth(music, t + BEAT / 2, ch.notes, 0.12, { gain: 0.2, cutoff: 3200, release: 0.15 })
}
// A short fill into the CTA: snare-like claps on the last beat.
for (const o of [0, 0.25, 0.5, 0.75]) clap(music, beatT(HIT - 1) + o * BEAT, 0.6 + o * 0.5)

// CTA (beat 34 to the end): the hit, then a held Am chord fading out.
impact(music, beatT(HIT))
synth(music, beatT(HIT), CHORDS[0].notes, LENGTH - beatT(HIT) - 0.6, { gain: 0.22, cutoff: 2600, attack: 0.01, release: 0.6, voices: 4 })
bass(music, beatT(HIT), CHORDS[0].root, LENGTH - beatT(HIT) - 0.4, 0.45)

// SFX: a whoosh peaking on every cut (the CTA gets the impact in the music).
CUT_BEATS.forEach((b, k) => {
  const cut = beatT(b)
  const dir = k % 2 ? -1 : 1
  // Symmetric around the cut so the loudest moment is the cut itself.
  noiseSweep(sfx, cut - 0.26, cut + 0.26, { from: 600, to: 7000, gain: 0.5, panFrom: -0.7 * dir, panTo: 0.7 * dir, shape: 'swell' })
})

// --- sidechain pump, master, export ----------------------------------------------
// Duck the music after each kick in the groove for that pumping feel.
for (let b = DROP; b < HIT; b++) {
  const i0 = t2i(beatT(b))
  for (let n = 0; n < SR * BEAT; n++) {
    const s = n / SR
    const duck = 1 - 0.35 * Math.exp(-s * 9)
    if (i0 + n < N) {
      music[0][i0 + n] *= duck
      music[1][i0 + n] *= duck
    }
  }
}

function master(buf, peakDb) {
  const fade = t2i(0.4)
  let peak = 0
  for (const ch of buf) {
    for (let i = 0; i < N; i++) {
      ch[i] = Math.tanh(ch[i] * 1.2) // gentle saturation / limiting
      if (i > N - fade) ch[i] *= (N - i) / fade
      peak = Math.max(peak, Math.abs(ch[i]))
    }
  }
  const k = 10 ** (peakDb / 20) / (peak || 1)
  for (const ch of buf) for (let i = 0; i < N; i++) ch[i] *= k
}

function writeWav(file, buf) {
  const data = Buffer.alloc(N * 4)
  for (let i = 0; i < N; i++) {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, buf[0][i])) * 32767), i * 4)
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, buf[1][i])) * 32767), i * 4 + 2)
  }
  const h = Buffer.alloc(44)
  h.write('RIFF', 0)
  h.writeUInt32LE(36 + data.length, 4)
  h.write('WAVEfmt ', 8)
  h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20)
  h.writeUInt16LE(2, 22)
  h.writeUInt32LE(SR, 24)
  h.writeUInt32LE(SR * 4, 28)
  h.writeUInt16LE(4, 32)
  h.writeUInt16LE(16, 34)
  h.write('data', 36)
  h.writeUInt32LE(data.length, 40)
  writeFileSync(file, Buffer.concat([h, data]))
}

master(music, -1)
master(sfx, -3)
const outDir = path.resolve(import.meta.dirname, '..', 'public', 'audio')
mkdirSync(outDir, { recursive: true })
for (const [name, buf] of [['music', music], ['sfx', sfx]]) {
  const wav = path.join(outDir, `${name}.wav`)
  writeWav(wav, buf)
  // MP3 via Remotion's bundled ffmpeg (keeps the repo small).
  execFileSync('npx', ['remotion', 'ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-codec:a', 'libmp3lame', '-b:a', '192k', path.join(outDir, `${name}.mp3`)], { stdio: 'inherit' })
  rmSync(wav)
}
console.log('wrote public/audio/music.mp3 and public/audio/sfx.mp3')
