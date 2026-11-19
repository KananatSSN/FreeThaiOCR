#!/usr/bin/env bash
# Regenerate the parity goldens on THIS machine from the Python references, so the TS engines are
# compared with them on identical arithmetic. ONNX Runtime rounds differently on each platform
# (macOS arm64, Linux arm64, Linux x86), which flips a few unstable readings on the fixtures, so
# goldens made elsewhere cannot match exactly. CI runs this before `npm test`; locally, the
# committed goldens (made on macOS arm64) are used. Needs python3 (3.10+) and the models
# fetched (`npm run assets`).
set -euo pipefail
cd "$(dirname "$0")/.."

OT_REPO=$(node -p "require('./models.json').openthai.repo")
OT_REV=$(node -p "require('./models.json').openthai.revision")
AK_DIR=public/models/akson-$(node -p "require('./models.json').akson.revision.slice(0, 7)")
OT_DIR=public/models/openthai-${OT_REV:0:7}
REF=${RUNNER_TEMP:-/tmp}/freethaiocr-ref

python3 -m venv "$REF/venv"
"$REF/venv/bin/pip" install -q \
  onnxruntime==1.31.1 opencv-python-headless==5.0.0.93 pyclipper numpy pillow \
  "aksonocr-lite @ git+https://github.com/Remtir/AksonOCR-Lite@8f1f3d87d41e2b585354950767b9a9be678e0352"

# OpenThai's reference runtime, checksum-pinned like the model files.
mkdir -p "$REF/openthai/runtime"
cp "$OT_DIR"/* "$REF/openthai/"
for f in runtime/__init__.py runtime/line_engine.py runtime/thai_norm.py; do
  curl -fsSL "https://huggingface.co/$OT_REPO/resolve/$OT_REV/$f" -o "$REF/openthai/$f"
done
(cd "$REF/openthai" && sha256sum -c --quiet - <<'SUMS'
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  runtime/__init__.py
6bbd83c590e66445a6844f69ed3029be98e3be0fd1fcc01e2147ace28748d54a  runtime/line_engine.py
53a03ac139fb0de3e7aec0f5b8ab69b0b519fb5e636f7c1de09cb357b023344a  runtime/thai_norm.py
SUMS
)

"$REF/venv/bin/python" -I tests/parity/make_goldens.py "$REF/openthai" | tail -n 3
AKSONOCR_WEIGHTS="$PWD/$AK_DIR" "$REF/venv/bin/python" -I tests/parity/make_akson_goldens.py | tail -n 3
git --no-pager diff --stat -- tests/parity/goldens tests/fixtures || true
