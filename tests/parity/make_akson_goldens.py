"""Golden outputs for the AksonOCR-Lite port, from the reference Python package.

Usage (from the repo root; see README "Regenerating parity goldens" for the pinned environment):
    AKSONOCR_WEIGHTS=public/models/akson-<rev7> python -I tests/parity/make_akson_goldens.py

For every tests/fixtures/*.png it writes tests/parity/goldens/akson/<name>.json with:
  det:  the detector's quads on the upright page (module-level parity)
  text: text mode, i.e. Converter.page with the layout model returning no blocks
  doc:  document mode, Converter.page as shipped (layout, table OCR, table grids, Markdown)
"""
import json
import os
from pathlib import Path

import cv2

os.environ.setdefault("AKSONOCR_THREADS", "1")
import aksonocr_lite  # noqa: E402
from aksonocr_lite.orient import rotate  # noqa: E402

root = Path(__file__).resolve().parents[2]
fx = root / "tests" / "fixtures"
out = root / "tests" / "parity" / "goldens" / "akson"
out.mkdir(parents=True, exist_ok=True)

doc = aksonocr_lite.load(device="cpu", timings=False)
text = aksonocr_lite.load(device="cpu", timings=False)
text.layout = lambda img: []  # text mode: no layout blocks


def page(p):
    return {
        "rotation": p.rotation, "text": p.text, "markdown": p.markdown,
        "lines": [{"text": l.text, "confidence": l.confidence, "poly": l.poly} for l in p.lines],
        "blocks": [{"label": b.label, "bbox": b.bbox, "order": b.order, "text": b.text, "html": b.html, "line_ids": b.line_ids}
                   for b in p.blocks],
    }


for png in sorted(fx.glob("*.png")):
    img = cv2.imread(str(png))
    upright = rotate(img, doc.page_ori(img))
    r = {
        "det": [[[float(x), float(y)] for x, y in q] for q in doc.det(upright)],
        "text": page(text.page(img)),
        "doc": page(doc.page(img)),
    }
    (out / f"{png.stem}.json").write_text(json.dumps(r, ensure_ascii=False, indent=1))
    d = r["doc"]
    print(f"{png.stem:16s} rot={d['rotation']:3d} lines={len(d['lines']):3d} blocks={[b['label'] for b in d['blocks']]}")
