#!/usr/bin/env node
// Copies pdf.js runtime data (CMaps, standard fonts, decoder wasm, ICC profiles)
// into public/vendor/pdfjs-<version>/ so the app never loads anything cross-origin.
// The version is in the path, so these can be cached as immutable.
import { cp, readFile } from 'node:fs/promises'
import path from 'node:path'

const rootDir = path.resolve(import.meta.dirname, '..')
const pkgDir = path.join(rootDir, 'node_modules', 'pdfjs-dist')
const { version } = JSON.parse(await readFile(path.join(pkgDir, 'package.json'), 'utf8'))
const dest = path.join(rootDir, 'public', 'vendor', `pdfjs-${version}`)
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  await cp(path.join(pkgDir, dir), path.join(dest, dir), { recursive: true })
}
console.log(`pdf.js ${version} assets ready in public/vendor/pdfjs-${version}/`)
