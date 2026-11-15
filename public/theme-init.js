// Apply the saved or system theme before first paint (no flash). Loaded as a
// blocking script so the strict CSP needs no 'unsafe-inline'.
try {
  var t = localStorage.getItem('thaiocr.theme')
  if (t === 'dark' || (!t && matchMedia('(prefers-color-scheme: dark)').matches)) document.documentElement.classList.add('dark')
} catch {}
