"""Build the 16-bit (fp16) web copy of AksonOCR-Lite that FreeThaiOCR runs in the browser.

Downloads the pinned original files from Remtir/AksonOCR-Lite, checks their SHA-256, converts the
ONNX models to fp16 (inputs and outputs stay float32) and writes a folder ready to upload to
Hugging Face, with its model card, LICENSE, NOTICE and SHA256SUMS.

    uv venv -p 3.12 /tmp/akson-venv && VIRTUAL_ENV=/tmp/akson-venv uv pip install -r scripts/akson-fp16/requirements.txt
    /tmp/akson-venv/bin/python -I scripts/akson-fp16/convert.py <out_dir>

The dewarping models are left out (FreeThaiOCR does not use them).
"""
import hashlib
import shutil
import sys
import urllib.request
from pathlib import Path

import onnx
from onnxconverter_common import float16
from onnxruntime.transformers.onnx_model import OnnxModel

REPO = "Remtir/AksonOCR-Lite"
REVISION = "576fa7b148b628656eb6fb70917d3e8c488bab3d"
SOURCES = {
    "det.onnx": "eb13b44b25bb36f89528b68720af8a61d9cf381176107f465db1757b65d086e1",
    "rec.onnx": "e34fd1a1fe5cb5cdefc8696be652cb93b54f62ae8b1cd9a7e41263211ac29564",
    "rec_charset.json": "f021d4a5f34d9434431feecd86c48b85d4a625d2fc5ff01e6d0f44e137fcd4c0",
    "doc_ori.onnx": "af9a0a4f317ff0709ce752067807f819cb15d883f8ecad89f28df1c6ee2d9c92",
    "textline_ori.onnx": "38aa97cd4be591e0ad304e659f07ba30d946f27a63315433f6659c69c8778345",
    "layout.onnx": "45bf71750b00739a41fc209f132eb104a4d6b5bb29483c9078164d8b87cf28ba",
    "tatr.onnx": "d8882704aa5f96a773dd3f5caea929e9270dbb3885254af022242983ade27e30",
    "LICENSE": "c8b1046eea2bf2e2d4ebf0f643965ce0ba5cba920e77b90ecead07a41cde98c7",
    "NOTICE": "cc76ea7a62e886cfe3adcfaf11c3b0a1fe98a89d86a9f403dbe63b8d683a63d9",
}
# Small CNNs: the plain converter. The two transformer models (layout, table) need ONNX Runtime's
# converter with these ops kept in float32, or the graph does not load (Cast type mismatches).
SIMPLE = ["det.onnx", "rec.onnx", "doc_ori.onnx", "textline_ori.onnx"]
TRANSFORMER = ["layout.onnx", "tatr.onnx"]
KEEP_FP32 = ["Cast", "Resize", "TopK", "NonMaxSuppression", "Range", "Gather", "GatherElements", "ArgMax"]

sha256 = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()


def fetch(src: Path) -> None:
    src.mkdir(parents=True, exist_ok=True)
    for name, want in SOURCES.items():
        dest = src / name
        if not (dest.exists() and sha256(dest) == want):
            url = f"https://huggingface.co/{REPO}/resolve/{REVISION}/{name}"
            print("downloading", name, flush=True)
            with urllib.request.urlopen(url) as r, open(dest, "wb") as f:
                shutil.copyfileobj(r, f)
        got = sha256(dest)
        if got != want:
            raise SystemExit(f"{name}: checksum mismatch ({got})")


def main(out: Path) -> None:
    src = out.parent / (out.name + ".src")
    fetch(src)
    out.mkdir(parents=True, exist_ok=True)
    for name in SIMPLE:
        m = float16.convert_float_to_float16(onnx.load(src / name), keep_io_types=True)
        onnx.save(m, out / name)
        print("fp16", name, flush=True)
    for name in TRANSFORMER:
        m = OnnxModel(onnx.load(src / name))
        m.convert_float_to_float16(keep_io_types=True, op_block_list=KEEP_FP32)
        m.save_model_to_file(str(out / name))
        print("fp16", name, flush=True)
    shutil.copy(src / "rec_charset.json", out / "rec_charset.json")
    shutil.copy(src / "LICENSE", out / "LICENSE")
    notice = (src / "NOTICE").read_text(encoding="utf-8").rstrip("\n")
    notice += (
        "\n\n4. This repository (fp16 web copy): the ONNX files above converted to 16-bit floating point\n"
        "   (inputs and outputs float32) by the FreeThaiOCR contributors with scripts/akson-fp16/convert.py in\n"
        "   https://github.com/KananatSSN/FreeThaiOCR. The dewarping models are not included.\n"
    )
    (out / "NOTICE").write_text(notice, encoding="utf-8")
    card = (Path(__file__).parent / "MODEL_CARD.md").read_text(encoding="utf-8")
    (out / "README.md").write_text(card.replace("{REVISION}", REVISION), encoding="utf-8")
    files = sorted(p.name for p in out.iterdir() if p.name != "SHA256SUMS")
    (out / "SHA256SUMS").write_text("".join(f"{sha256(out / n)}  {n}\n" for n in files))
    print((out / "SHA256SUMS").read_text())


if __name__ == "__main__":
    main(Path(sys.argv[1]).resolve())
