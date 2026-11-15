"""Build tests/fixtures/batch-encrypted/protected.pdf: a scanned page encrypted
with an owner password only (opens and renders without a password, but carries
copy/print restrictions). Used to check that searchable-PDF export refuses it.

Run: uv run --with pypdf python -I tests/fixtures/make_encrypted.py
"""
from pathlib import Path

from pypdf import PdfReader, PdfWriter

here = Path(__file__).resolve().parent
src = PdfReader(here / "batch" / "reports" / "scan-2.pdf")
w = PdfWriter()
for page in src.pages:
    w.add_page(page)
# Empty user password: anyone can open it; the owner password guards permissions.
w.encrypt(user_password="", owner_password="owner-secret", permissions_flag=0b0100, algorithm="RC4-128")
out = here / "encrypted" / "protected.pdf"
out.parent.mkdir(exist_ok=True)
with open(out, "wb") as f:
    w.write(f)
print("wrote", out.relative_to(here.parent.parent))
