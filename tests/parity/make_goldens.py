"""Produce golden outputs from the model's Python reference runtime.

Usage (from the repo root, in a venv with onnxruntime opencv-python-headless pyclipper numpy pillow):
    python -I tests/parity/make_goldens.py <model_dir_with_runtime/>

1. Derives extra fixtures (rotated, skewed, upside down, line crop) from the
   Chrome-rendered PNGs in tests/fixtures/.
2. Runs LineOCR on every fixture and writes tests/parity/goldens/<name>.json
   with the final result plus raw detector boxes (for module-level parity).
3. Writes tests/parity/goldens/thai_norm.json: canonical()/fix_scripts()/
   invalid_share() over a string corpus.
"""
import json
import sys
from pathlib import Path

import cv2
import numpy as np

root = Path(__file__).resolve().parents[2]
model_dir = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(model_dir))
from runtime.line_engine import LineOCR, fix_scripts, invalid_share  # noqa: E402
from runtime.thai_norm import canonical  # noqa: E402

fx = root / "tests" / "fixtures"
out = root / "tests" / "parity" / "goldens"
out.mkdir(parents=True, exist_ok=True)


def derive() -> None:
    base = cv2.imread(str(fx / "th_doc.png"))
    cv2.imwrite(str(fx / "th_doc_rot90.png"), cv2.rotate(base, cv2.ROTATE_90_CLOCKWISE))
    cv2.imwrite(str(fx / "th_doc_rot180.png"), cv2.rotate(base, cv2.ROTATE_180))
    h, w = base.shape[:2]
    m = cv2.getRotationMatrix2D((w / 2, h / 2), 6.0, 1.0)
    cv2.imwrite(str(fx / "th_doc_skew6.png"),
                cv2.warpAffine(base, m, (w, h), flags=cv2.INTER_CUBIC, borderValue=(255, 255, 255)))
    cv2.imwrite(str(fx / "line_crop.png"), base[66:136, 70:770])     # the title, as a user box would cut it
    cv2.imwrite(str(fx / "para_crop.png"), base[290:375, 70:1150])   # paragraph 2, two lines


derive()
ocr = LineOCR(str(model_dir), threads=1)
print("backend:", ocr.backend, "cfg:", json.dumps(ocr.cfg))


def boxes(bs):
    return [[[round(float(x), 2), round(float(y), 2)] for x, y in b] for b in bs]


for png in sorted(fx.glob("*.png")):
    img = cv2.imread(str(png))
    r = ocr.read(img)
    r.pop("timing", None)
    r["det_boxes"] = boxes(ocr.detect(img))
    (out / f"{png.stem}.json").write_text(json.dumps(r, ensure_ascii=False, indent=1))
    print(f"{png.stem:16s} lines={len(r['lines']):3d} rot={r['rotation']:3d} angle={r['text_angle']:6.2f} | {r['text'][:60]!r}")

# String corpus for the normaliser: real text, every mark order permutation on a
# few clusters, mixed scripts, and the kinds of OCR slips fix_scripts targets.
corpus = [line["text"] for p in out.glob("*.json") if p.stem != "thai_norm"
          for line in json.loads(p.read_text())["lines"]]
marks = ["ั", "ิ", "ี", "ึ", "ื", "ุ", "ู", "็", "่", "้", "๊", "๋", "์", "ํ"]
for c in "กปฟ":
    for a in marks:
        for b in marks:
            corpus += [c + a + b, c + a + b + "า", c + "ํ" + a + b, "เ" + c + a + b]
corpus += ["นํ้า", "นำ้", "น้ำ", "เเม่", "แม่", "ก ้า", "Hello โลก", "0O ๑l", "ABC123ไทย", "ฤๅษี", "ฦๅ", "เงินlบาท", "ราคา1OO บาท", "กรุงเทพฯ", "ๆๆ", "  ", ""]
rows = [{"in": s, "canonical": canonical(s), "fixed": fix_scripts(canonical(s)), "invalid": invalid_share(s)} for s in corpus]
(out / "thai_norm.json").write_text(json.dumps(rows, ensure_ascii=False, indent=0))
print("thai_norm rows:", len(rows))
