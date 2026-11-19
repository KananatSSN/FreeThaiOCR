// Apply a saved dark theme before first paint (no flash); light is the default. Loaded as a
// blocking script so the strict CSP needs no 'unsafe-inline'.
try {
  var t = localStorage.getItem('freethaiocr.theme')
  if (t === 'dark') document.documentElement.classList.add('dark')
} catch {}
