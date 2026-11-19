---
license: apache-2.0
language:
- th
- en
library_name: onnx
pipeline_tag: image-to-text
base_model: Remtir/AksonOCR-Lite
tags:
- ocr
- thai
- onnx
- fp16
- onnxruntime-web
---

# AksonOCR-Lite, 16-bit web copy

A 16-bit (fp16) copy of the ONNX models of **[AksonOCR-Lite](https://huggingface.co/Remtir/AksonOCR-Lite)**
by Teetouch Jaknamon (Remtir), made so the pipeline can run inside a web browser with
[ONNX Runtime Web](https://onnxruntime.ai). It is used by
[FreeThaiOCR](https://github.com/KananatSSN/FreeThaiOCR), a free OCR web app that reads files
entirely on the visitor's device.

**All the credit for the models goes to their authors.** This repository only changes the number
format of the weights. Please cite and link the original:
[Remtir/AksonOCR-Lite](https://huggingface.co/Remtir/AksonOCR-Lite) and
[github.com/Remtir/AksonOCR-Lite](https://github.com/Remtir/AksonOCR-Lite).

## What was changed

- Source: `Remtir/AksonOCR-Lite` at revision `{REVISION}`.
- Every weight was converted from 32-bit to 16-bit floating point. Model inputs and outputs stay
  32-bit, so the files are drop-in replacements for the originals.
  - `det.onnx`, `rec.onnx`, `doc_ori.onnx` and `textline_ori.onnx` were converted with
    `onnxconverter_common.float16`.
  - `layout.onnx` and `tatr.onnx` were converted with ONNX Runtime's transformer converter, keeping
    `Cast`, `Resize`, `TopK`, `NonMaxSuppression`, `Range`, `Gather`, `GatherElements` and
    `ArgMax` in 32-bit.
- The dewarping models are not included.
- `rec_charset.json` is unchanged.
- The exact script and package versions: `scripts/akson-fp16/` in the FreeThaiOCR repository.

| File | Original | fp16 | What it is |
|---|---:|---:|---|
| `det.onnx` | 62.0 MB | 31.1 MB | PP-OCRv6_medium_det text detection |
| `rec.onnx` | 4.5 MB | 2.3 MB | AksonOCR Thai grapheme-cluster recognizer |
| `doc_ori.onnx` | 6.8 MB | 3.4 MB | PP-LCNet page orientation |
| `textline_ori.onnx` | 6.8 MB | 3.4 MB | PP-LCNet text-line orientation |
| `layout.onnx` | 130.5 MB | 65.5 MB | PP-DocLayoutV3 layout and reading order |
| `tatr.onnx` | 115.8 MB | 58.3 MB | Table Transformer v1.1-all structure |

## Accuracy check

The original AksonOCR-Lite Python pipeline was run on 14 test pages with the original weights and
with these fp16 weights:
- The pages: Thai and English documents, two-column pages, receipts, three tables with merged
  cells, and rotated and tilted pages.
- Measured on ONNX Runtime 1.31/1.32 CPU.
- The Markdown output differed by **0.01 %** of characters on average (at most 0.09 % on one page).
- Every difference was a doubled space or two lines swapped in the plain-text field.
- Layout blocks, rotations and all three tables were identical.

8-bit dynamic quantization was also tried and rejected: it broke the detector and the layout model
and lost merged table cells.

## Licence

- **Apache License 2.0**, the same as the original repository (see `LICENSE`).
- `tatr.onnx` derives from Microsoft's Table Transformer, released under the MIT License.
- `NOTICE` carries the original attributions plus a line for this conversion.
