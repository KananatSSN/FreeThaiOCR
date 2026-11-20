# FreeThaiOCR

**OCR ภาษาไทยและอังกฤษ ที่ทำงานในเบราว์เซอร์ทั้งหมด** — free, private Thai & English OCR that runs entirely in the browser. Files never leave the user's device; the server only hands out static files.

- Upload images, PDFs or **a whole folder** (or take a photo on a phone); files are listed in a sidebar grouped by folder, with progress per file
- **Read automatically**: every page of every file is OCR'd in the background as soon as it's added (the page on screen first), with progress and Stop/Resume in the toolbar; every detected line is shown on the image
- Multi-page PDFs with page thumbnails. Every page is OCR'd, including born-digital ones: the text always comes from the model, never from the PDF's own text layer
- Edit the results, copy them, or export **TXT**, **JSON** (lines, boxes, confidence) or a **searchable PDF** (invisible text layer over the original pages; born-digital pages, which are already searchable, get none, so nothing is found twice). Exports always cover the whole file: pages not read yet are OCR'd first. With several files, **export all** as a ZIP (one output per file, folder structure kept)
- Thai/English UI, light/dark theme, works offline after the first visit (PWA)

OCR engine: [OpenThai 2.1 OCR Text](https://huggingface.co/iapp/OpenThai2.1-OCR-Text-20261118) (v2.1.4) by iApp Technology (Apache-2.0), a 4 MB PP-OCRv6-tiny text-line detector + Thai line recognizer, plus a second recognizer for loopless Thai fonts (Kanit, Prompt, Sukhumvit Set) that is downloaded only when a page needs it. FreeThaiOCR is a browser UI for this model; the accuracy is iApp's work.

Second engine (the results panel's **AksonOCR** tab, next to **OpenThai**): [AksonOCR-Lite](https://huggingface.co/Remtir/AksonOCR-Lite) by Teetouch Jaknamon / Remtir (Apache-2.0), which reads Thai as whole grapheme clusters. It downloads about 22 MB once, after the visitor presses the tab's Load button, and then reads only the page on screen while that tab is open. Exports use the open tab's engine. Its **document mode** (a switch in the tab) adds layout analysis (PP-DocLayoutV3) and table structure (Microsoft Table Transformer), and returns each page as Markdown with headings and HTML tables (+112 MB once; offered with the GPU switched on or on a computer with 8 GB of memory). The app runs a 16-bit copy of its models (see below).

## How it works

```
Browser main thread                      Web Worker (lazy-loaded on first OCR)
───────────────────                      ─────────────────────────────────────
React + shadcn/ui                        src/ocr/  TypeScript port of the model's
pdf.js: render pages                       reference runtime (line_engine.py):
Konva: page viewer, line overlays          detect → split → orient/deskew →
pdf-lib: searchable PDF export             recognize (CTC) → reading order → filter
          │   ImageBitmap (comlink)      OpenCV.js (image ops), clipper (unclip),
          └──────────────────────────▶   onnxruntime-web (WASM threads / WebGPU)
```

- **Port fidelity.** `src/ocr/` is a line-by-line port of the reference Python runtime, including its line splitting, orientation detection, deskew, column-aware reading order, Thai normalisation and junk filtering. `tests/parity/` runs the TS engine on 17 fixture pages and compares with goldens produced by the Python reference (lines, boxes, text within 0.2 % CER). OpenCV.js and Python's OpenCV warp and resize to very slightly different pixels, so a line read right at the 0.8 confidence cut-off can be kept by one and dropped by the other; the test allows exactly that (both within 0.02 of the cut-off), which happens once, on the invoice page.
- **Akson port.** `src/ocr/akson/` ports AksonOCR-Lite's pipeline (detector, orientation classifiers, cluster-token recognizer, PP-DocLayoutV3 post-processing, Table Transformer grid, Markdown merge). Its parity goldens come from the `aksonocr-lite` Python package and match exactly in text and document mode on all 17 fixtures.
- **Model files** are pinned to Hugging Face revisions in `models.json` (one entry per engine) and checksum-verified by `scripts/fetch-models.mjs` (runs automatically before `dev`, `build` and `test`). They are served from our own origin under `/models/<engine>-<rev>/`.
- **AksonOCR-Lite in 16-bit.** `scripts/akson-fp16/convert.py` converts Akson's ONNX models to fp16 (inputs and outputs stay float32), halving the download. On 14 test pages the original pipeline's Markdown changed by 0.01 % of characters with these weights; 8-bit quantization was tried and rejected (it broke the detector, layout and merged table cells). The converted files are published on Hugging Face with their own model card, credits and checksums.
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

CI regenerates both sets of goldens on its own runner before `npm test` (`scripts/ci-goldens.sh`): ONNX Runtime rounds differently per platform (macOS arm64, Linux arm64, Linux x86), which flips a few unstable readings on the table fixtures, so goldens only match exactly on the kind of machine that made them. The committed goldens come from macOS arm64 and are what local `npm test` uses there.

Only needed when the model revision or the fixtures change. Needs Python (tested with 3.12) and the model repo
(including `runtime/`) at the revision in `models.json`. Pin OpenCV and ONNX Runtime to the versions the JS side
uses (`@techstark/opencv-js` and `onnxruntime-node` in `package-lock.json`): detector boxes right at the score
threshold come out differently with other OpenCV releases.

```bash
uv venv -p 3.12 /tmp/ref-venv && VIRTUAL_ENV=/tmp/ref-venv uv pip install \
  onnxruntime==1.31.1 opencv-python-headless==5.0.0.93 pyclipper numpy pillow
hf download iapp/OpenThai2.1-OCR-Text-20261118 --revision <rev> --local-dir /tmp/ref-model
/tmp/ref-venv/bin/python -I tests/parity/make_goldens.py /tmp/ref-model
```

AksonOCR-Lite goldens come from its own package, pinned the same way, run on the fp16 files:

```bash
VIRTUAL_ENV=/tmp/ref-venv uv pip install "aksonocr-lite @ git+https://github.com/Remtir/AksonOCR-Lite@8f1f3d87d41e2b585354950767b9a9be678e0352" \
  onnxruntime==1.31.1 opencv-python-headless==5.0.0.93
AKSONOCR_WEIGHTS=public/models/akson-<rev7> /tmp/ref-venv/bin/python -I tests/parity/make_akson_goldens.py
```

Fixture pages are rendered by headless Chrome from `tests/fixtures/html/` (our own text, so they can be committed; `receipt`, `list`, `banded` and `marks` exercise the 2.1 runtime: the rec2 re-read, single-digit and single-letter cells, decimal commas, the list guard, columns crossed by a full-width line, and floating tone marks; `report`, `timetable` and `invoice` exercise Akson's tables, including merged cells); `make_goldens.py` derives the rotated/skewed/cropped variants and `tests/fixtures/make_pdf.mjs` builds `sample.pdf`.

## Deployment (Docker + Cloudflare Tunnel)

The server never runs OCR; it is a static nginx container. Cloudflare Tunnel publishes it without opening ports.

1. **Create a tunnel**: Cloudflare dashboard → Zero Trust → Networks → Tunnels → *Create a tunnel* (Cloudflared). Copy the token.
2. **Configure**: `cp .env.example .env`, set `TUNNEL_TOKEN` (and optionally the donation links, see below).
3. **Public hostname**: in the tunnel's *Public Hostname* tab, add your domain with service `http://web:8080`.
4. **Run**: `docker compose up -d --build`. Check locally at <http://localhost:8080> (bound to 127.0.0.1 only).

### Keeping server cost near zero

- Hashed bundles, `/models/<rev>/` and `/vendor/pdfjs-<ver>/` are sent with `Cache-Control: immutable` (1 year). Add a **Cloudflare Cache Rule** so the edge stores them: *Caching → Cache Rules → Create*: when *URI Path* starts with `/assets/` or `/models/` or `/vendor/` → *Eligible for cache*, Edge TTL: *Use cache-control header*. After the first request per Cloudflare location, the origin is not contacted for the large files at all.
- The service worker caches the OCR runtime on first use; repeat visitors download nothing (and can work offline).
- First-time OCR download is about 8 MB brotli (ONNX Runtime 2.3 MB, OpenCV.js 2.5 MB, models 3.6 MB). The loopless-font recognizer `rec2.onnx` (~2 MB more) is fetched only the first time a page needs it, and the WebGPU runtime (~4 MB more) only if a user turns GPU on. AksonOCR-Lite adds about 22 MB for visitors who choose it, and its document mode about 112 MB more; the Docker image carries ~164 MB of fp16 model files for it.
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
| `VITE_HIRE_EMAIL`, `VITE_HIRE_PHONE`, `VITE_HIRE_GITHUB`, `VITE_HIRE_WEBSITE` | The maintainer's contact details for the "open to work" card in the support menu. Each is optional; the item is hidden if all are unset |

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

- OCR model and reference runtime: **OpenThai2.1-OCR-Text-20261118** (v2.1.4) © iApp Technology, Apache-2.0, derived from PaddleOCR PP-OCRv6 © PaddlePaddle Authors, Apache-2.0
- Optional engine: **AksonOCR-Lite** © Teetouch Jaknamon / Remtir, Apache-2.0 (runtime ported in `src/ocr/akson/`, models served as a 16-bit copy), built on PaddlePaddle PP-OCRv6 / PP-DocLayoutV3 / PP-LCNet (Apache-2.0) and Microsoft Table Transformer (MIT)
- PDF text-layer font: **Sarabun** © The Sarabun Project Authors, SIL Open Font License 1.1 (`public/fonts/Sarabun-OFL.txt`)
- UI fonts: Geist and Noto Sans Thai (SIL OFL 1.1) via Fontsource
- Runtime libraries: ONNX Runtime Web (MIT), OpenCV.js (Apache-2.0), pdf.js (Apache-2.0), pdf-lib (MIT), Konva (MIT), Clipper (Boost)
