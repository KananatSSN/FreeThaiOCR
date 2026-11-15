# FreeThaiOCR

**OCR ภาษาไทยและอังกฤษ ที่ทำงานในเบราว์เซอร์ทั้งหมด** — free, private Thai & English OCR that runs entirely in the browser. Files never leave the user's device; the server only hands out static files.

- Upload images, PDFs or **a whole folder** (or take a photo on a phone); files are listed in a sidebar grouped by folder, with progress per file and **OCR all files**
- **OCR page** reads the whole page and shows every detected line on the image
- **Draw box** reads just a region; draw as many numbered boxes as you like, move or resize them and they re-read
- Multi-page PDFs: page thumbnails, **OCR all pages** with progress and cancel; pages that already have a text layer use it directly (instant, exact)
- Edit the results, copy them, or export **TXT**, **JSON** (lines, boxes, confidence) or a **searchable PDF** (invisible text layer over the original pages). Exports always cover the whole file: pages not read yet are OCR'd first. With several files, **export all** as a ZIP (one output per file, folder structure kept)
- Thai/English UI, light/dark theme, works offline after the first visit (PWA)

OCR engine: [OpenThai 2.0 OCR Text](https://huggingface.co/iapp/OpenThai2.0-OCR-Text) by iApp Technology (Apache-2.0), a 4 MB PP-OCRv6-tiny text-line detector + Thai line recognizer.

## How it works

```
Browser main thread                      Web Worker (lazy-loaded on first OCR)
───────────────────                      ─────────────────────────────────────
React + shadcn/ui                        src/ocr/  TypeScript port of the model's
pdf.js: render pages, read text layer      reference runtime (line_engine.py):
Konva: page viewer, boxes, overlays        detect → split → orient/deskew →
pdf-lib: searchable PDF export             recognize (CTC) → reading order → filter
          │   ImageBitmap (comlink)      OpenCV.js (image ops), clipper (unclip),
          └──────────────────────────▶   onnxruntime-web (WASM threads / WebGPU)
```

- **Port fidelity.** `src/ocr/` is a line-by-line port of the reference Python runtime, including its line splitting, orientation detection, deskew, column-aware reading order, Thai normalisation and junk filtering. `tests/parity/` runs the TS engine on fixture pages and compares with goldens produced by the Python reference: 9 of 10 fixtures match byte for byte, the skewed page differs by one already-misread character (float rounding in the deskew angle).
- **Model files** are pinned to a Hugging Face revision in `models.json` and checksum-verified by `scripts/fetch-models.mjs` (runs automatically before `dev`, `build` and `test`). They are served from our own origin under `/models/<rev>/`.
- **Cross-origin isolation** (COOP/COEP) enables multi-threaded WASM. Everything is same-origin, no CDNs.

## Development

```bash
npm install
npm run dev          # http://localhost:5173 (fetches models + pdf.js assets first)
npm test             # engine + normaliser parity vs the Python reference
npm run test:e2e     # browser tests (uses your installed Chrome)
npm run lint && npm run typecheck
npm run build        # static site in dist/
```

Browser tests against the production container (nginx headers, CSP, service worker, offline):

```bash
docker compose up -d --build web
PW_BASE_URL=http://localhost:8080 npm run test:e2e
```

### Regenerating parity goldens

Only needed when the model revision or the fixtures change. Needs Python (tested with 3.12) and
`onnxruntime opencv-python-headless pyclipper numpy pillow`, and the model repo (including `runtime/`) downloaded:

```bash
hf download iapp/OpenThai2.0-OCR-Text --revision <rev> --local-dir /tmp/ref-model
python -I tests/parity/make_goldens.py /tmp/ref-model
```

Fixture pages are rendered by headless Chrome from `tests/fixtures/html/` (our own text, so they can be committed); `make_goldens.py` derives the rotated/skewed/cropped variants and `tests/fixtures/make_pdf.mjs` builds `sample.pdf`.

## Deployment (Docker + Cloudflare Tunnel)

The server never runs OCR; it is a static nginx container. Cloudflare Tunnel publishes it without opening ports.

1. **Create a tunnel**: Cloudflare dashboard → Zero Trust → Networks → Tunnels → *Create a tunnel* (Cloudflared). Copy the token.
2. **Configure**: `cp .env.example .env`, set `TUNNEL_TOKEN` (and optionally the donation links, see below).
3. **Public hostname**: in the tunnel's *Public Hostname* tab, add your domain with service `http://web:8080`.
4. **Run**: `docker compose up -d --build`. Check locally at <http://localhost:8080> (bound to 127.0.0.1 only).

### Keeping server cost near zero

- Hashed bundles, `/models/<rev>/` and `/vendor/pdfjs-<ver>/` are sent with `Cache-Control: immutable` (1 year). Add a **Cloudflare Cache Rule** so the edge stores them: *Caching → Cache Rules → Create*: when *URI Path* starts with `/assets/` or `/models/` or `/vendor/` → *Eligible for cache*, Edge TTL: *Use cache-control header*. After the first request per Cloudflare location, the origin is not contacted for the large files at all.
- The service worker caches the OCR runtime on first use; repeat visitors download nothing (and can work offline).
- First-time OCR download is about 8 MB brotli (ONNX Runtime 2.3 MB, OpenCV.js 2.5 MB, models 3.6 MB). The WebGPU runtime (~4 MB more) is fetched only if a user turns GPU on.
- nginx serves pre-gzipped files; Cloudflare re-compresses to brotli at the edge.

### Environment variables (build time)

| Variable | Purpose |
|---|---|
| `TUNNEL_TOKEN` | Cloudflare Tunnel token (runtime, used by `cloudflared`) |
| `VITE_PROMPTPAY_ID` | PromptPay ID (phone / national ID / e-wallet) for the donation QR. Hidden if unset |
| `VITE_DONATE_URL` | Ko-fi or Buy Me a Coffee URL. Hidden if unset |
| `VITE_REPO_URL` | Source repository link in the About dialog and support menu |
| `VITE_OPERATOR_NAME` | Operator named in the privacy policy and terms (default: "the FreeThaiOCR maintainer") |
| `VITE_CONTACT_EMAIL` | Contact e-mail in the privacy policy and terms (default: the repo's GitHub issues page). Recommended: privacy requests shouldn't have to be public |

The donation QR card is read from `private/promptpay_qr.(jpg|png|webp)` at build time (the folder is gitignored, so forks never ship your account).

`VITE_*` values are baked into the static build: rebuild the image after changing them.

### Security

- Strict CSP with no third-party origins: files and OCR results cannot be sent anywhere, even by a buggy library. The page has no `unsafe-eval`; only the OCR worker script gets it, because OpenCV.js's embind bindings build functions at runtime.
- Unprivileged nginx on a read-only filesystem, published on 127.0.0.1 only (the tunnel reaches it over the Docker network).
- No access log, so visitor IPs are never stored; error logs are capped at 3 x 1 MB.
- Pinned versions: `cloudflared` image, CI actions (commit SHAs), model files (revision + SHA-256).
- ZIP entry names are sanitised; encrypted PDFs are refused for searchable export rather than stripped of their restrictions.
- Turn on HSTS in Cloudflare (SSL/TLS, Edge Certificates); the origin speaks plain HTTP to the tunnel, so the header belongs at the edge.

### Privacy and legal

- `/privacy` and `/terms` (Thai and English, from `src/legal/content.ts`) describe exactly what the deployment does: no uploads, no access logs, no analytics, Cloudflare as processor. **Keep them true** if you add analytics, logging or a backend, and set `VITE_CONTACT_EMAIL`.
- `/licenses.txt` is generated at build time with the license and notice texts of every shipped package, the OpenThai model NOTICE and the font licenses (minified bundles drop license comments, so this is how the notices travel with the code).
- Not legal advice: for formal PDPA compliance, have the policy reviewed by a Thai lawyer.

## Limitations

- Printed Thai and English only. Handwriting, scene text (signs, photos) and decorative fonts read poorly — a property of the model.
- Lines the model reads with low confidence (under 0.8) are dropped, as in the reference runtime; very short lines in unusual fonts can disappear.
- Two prose columns are only read column by column when each has 12+ lines (reference behaviour); shorter side-by-side columns are read row by row.
- In the searchable PDF, invisible text is fitted to each detected word box; selection highlights are approximate, search and copy are exact.

## Licence and credits

FreeThaiOCR is licensed under the [Apache License 2.0](LICENSE). See [NOTICE](NOTICE).

- OCR model and reference runtime: **OpenThai2.0-OCR-Text** © iApp Technology, Apache-2.0, derived from PaddleOCR PP-OCRv6 © PaddlePaddle Authors, Apache-2.0
- PDF text-layer font: **Sarabun** © The Sarabun Project Authors, SIL Open Font License 1.1 (`public/fonts/Sarabun-OFL.txt`)
- UI fonts: Geist and Noto Sans Thai (SIL OFL 1.1) via Fontsource
- Runtime libraries: ONNX Runtime Web (MIT), OpenCV.js (Apache-2.0), pdf.js (Apache-2.0), pdf-lib (MIT), Konva (MIT), Clipper (Boost)
