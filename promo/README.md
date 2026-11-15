# FreeThaiOCR promo video

A 20-second vertical (1080×1920, 30 fps) introduction video, made with [Remotion](https://www.remotion.dev).
Thai headlines, real app screenshots, fast cuts. Separate from the app: its own `package.json`, not part of the app build or Docker image.

```bash
cd promo
npm install
npm run dev          # Remotion Studio: preview, edit texts, render from the UI
```

Compositions: `FreeThaiOCR-Promo` (the full video) and, under **Scenes**, each scene on its own
(Hook, Upload, Detect, Results, Box, Batch, Export, Privacy, CTA). Headline texts are editable in
Studio; `*word*` makes a word orange, `|` is an animation break without a space (for Thai).

## Music and sound effects

The soundtrack is original: `scripts/make-music.mjs` synthesises it from scratch (no samples or
third-party audio), so it's free to use anywhere, including monetised posts.

- `public/audio/music.mp3`: 120 BPM groove in A minor. A filtered intro and riser under the hook,
  the drop on the first cut, kick/clap/hats, bass, chord stabs, then a big hit and a held chord
  under the CTA.
- `public/audio/sfx.mp3`: a whoosh centred on every cut.

The video cuts on the beat: at 120 BPM one beat is 15 frames, and each transition is centred on
beats 4, 8, 13, 17, 21, 26, 30 and 34 (frames 60 … 510). If you change scene lengths in
`src/Promo.tsx`, update `CUT_BEATS` in the script and regenerate:

```bash
node scripts/make-music.mjs     # deterministic: same input, same files
```

Levels: the `musicVolume` and `sfxVolume` props of `FreeThaiOCR-Promo` (Studio). To use a
different track, put it in `public/` and point `musicSrc` at it; set `sfxSrc` to `""` to drop
the whooshes.

## Screenshots

`public/screens/` holds real screenshots of the app. To refresh them after UI changes, run the app
(`npm run dev` in the repo root), then:

```bash
node scripts/capture.mjs            # uses http://localhost:5173 and your installed Chrome
```

## Render

Use the Render button in Studio, or:

```bash
npx remotion render FreeThaiOCR-Promo out/freethaiocr-promo.mp4
```

Before publishing: change the CTA link (`url` prop of the CTA scene in `src/Promo.tsx`) to your site's
domain once it is live. Remotion is free for individuals and teams of up to 3; see its license.
