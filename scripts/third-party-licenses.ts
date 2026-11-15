// Builds licenses.txt: the license and notice texts of everything FreeThaiOCR
// ships to the browser. Minified bundles drop license comments, and MIT,
// Apache-2.0, BSD, Boost and OFL all require the notices to accompany the code.
//
// Scope: every production dependency and its production dependencies
// (transitively), plus build tools whose output is embedded (Tailwind's base
// CSS), the OpenThai model NOTICE and the bundled fonts.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

interface Pkg {
  name: string
  version: string
  license: string
  /** Author names without e-mail addresses, for license templates. */
  author?: string
  homepage?: string
  dir: string
}

const LICENSE_FILE = /^(licen[sc]e|copying|notice)(\.(md|txt|markdown))?$|^licen[sc]e[-_.]/i
/** Build tools whose output ends up in the shipped files. */
const EMBEDDED_TOOLS = ['tailwindcss']

function findPackageDir(name: string, from: string): string | null {
  // Walk up node_modules folders the way Node resolves packages.
  for (let dir = from; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', name)
    if (existsSync(path.join(candidate, 'package.json'))) return candidate
    if (path.dirname(dir) === dir) return null
  }
}

function readPkg(dir: string): Pkg & { deps: string[] } {
  const j = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'))
  const license = typeof j.license === 'string' ? j.license : j.license?.type ?? (Array.isArray(j.licenses) ? j.licenses.map((l: { type: string }) => l.type).join(' OR ') : 'UNKNOWN')
  const repo = typeof j.repository === 'string' ? j.repository : j.repository?.url
  const authors = (Array.isArray(j.author) ? j.author : [j.author]).filter(Boolean)
  const author = authors.map((a: string | { name: string }) => (typeof a === 'string' ? a : a.name).replace(/\s*<[^>]*>/, '').replace(/\s*\([^)]*https?:[^)]*\)/, '').trim()).join(', ') || undefined
  return {
    name: j.name,
    version: j.version,
    license,
    author,
    homepage: j.homepage ?? repo?.replace(/^git\+/, '').replace(/\.git$/, ''),
    dir,
    // Optional dependencies are platform-specific native add-ons (e.g. canvas for
    // pdf.js under Node) that never reach the browser; skipping them also keeps
    // this file identical across build machines.
    deps: Object.keys(j.dependencies ?? {}),
  }
}

export function collectPackages(root: string): Pkg[] {
  const rootPkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  const seen = new Map<string, Pkg>()
  const queue: [string, string][] = [...Object.keys(rootPkg.dependencies ?? {}), ...EMBEDDED_TOOLS].map((n) => [n, root])
  while (queue.length) {
    const [name, from] = queue.shift()!
    const dir = findPackageDir(name, from)
    if (!dir) continue // optional dependency not installed on this platform
    const p = readPkg(dir)
    const key = `${p.name}@${p.version}`
    if (seen.has(key)) continue
    seen.set(key, p)
    for (const d of p.deps) queue.push([d, dir])
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
}

function licenseTexts(dir: string): string {
  const files = readdirSync(dir).filter((f) => LICENSE_FILE.test(f)).sort()
  return files.map((f) => readFileSync(path.join(dir, f), 'utf8').trim()).join('\n\n')
}

const rule = (c = '=') => c.repeat(78)

/** Copyright holders where package.json's author is a maintainer, not the holder. */
const HOLDER: Record<string, string> = {
  'onnxruntime-web': 'Microsoft Corporation',
  'onnxruntime-common': 'Microsoft Corporation',
  '@pdf-lib/fontkit': 'Devon Govett and contributors; fork by Andrew Dillon',
}

/** Standard texts for packages that declare a license but ship no license file. */
const TEMPLATES: Record<string, (holder: string) => string> = {
  MIT: (h) => `MIT License

Copyright (c) ${h}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`,
  ISC: (h) => `ISC License

Copyright (c) ${h}

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`,
  'BSL-1.0': (h) => `Boost Software License - Version 1.0 - August 17th, 2003

Copyright (c) ${h}

Permission is hereby granted, free of charge, to any person or organization
obtaining a copy of the software and accompanying documentation covered by
this license (the "Software") to use, reproduce, display, distribute,
execute, and transmit the Software, and to prepare derivative works of the
Software, and to permit third-parties to whom the Software is furnished to
do so, all subject to the following:

The copyright notices in the Software and this entire statement, including
the above license grant, this restriction and the following disclaimer,
must be included in all copies of the Software, in whole or in part, and
all derivative works of the Software, unless such copies or derivative
works are solely in the form of machine-executable object code generated by
a source language processor.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE, TITLE AND NON-INFRINGEMENT. IN NO EVENT
SHALL THE COPYRIGHT HOLDERS OR ANYONE DISTRIBUTING THE SOFTWARE BE LIABLE
FOR ANY DAMAGES OR OTHER LIABILITY, WHETHER IN CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.`,
}
const SPDX_ALIAS: Record<string, string> = { BSL: 'BSL-1.0', 'Boost Software License': 'BSL-1.0' }

function fallbackText(p: Pkg & { author?: string }): string {
  const spdx = SPDX_ALIAS[p.license] ?? p.license
  const holder = HOLDER[p.name] ?? p.author ?? `the ${p.name} authors`
  const tpl = TEMPLATES[spdx]
  const note = '(The package ships no license file; this is the standard text of its declared license.)'
  return tpl ? `${note}\n\n${tpl(holder)}` : `(No license file in the package; licensed under ${p.license}.)`
}

export function buildLicensesText(root: string, modelDir: string): string {
  const pkgs = collectPackages(root)
  const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8').trim() : '')
  const parts: string[] = [
    'FreeThaiOCR: open-source licenses',
    rule(),
    'FreeThaiOCR is licensed under the Apache License 2.0.',
    'Source code: see the project repository (link in the app\'s About dialog).',
    '',
    read(path.join(root, 'NOTICE')),
    '',
    rule(),
    'OCR model: OpenThai2.0-OCR-Text (iApp Technology), Apache License 2.0',
    'https://huggingface.co/iapp/OpenThai2.0-OCR-Text',
    rule('-'),
    read(path.join(modelDir, 'NOTICE')),
    '',
    rule(),
    'Font: Sarabun (used in exported searchable PDFs), SIL Open Font License 1.1',
    rule('-'),
    read(path.join(root, 'public', 'fonts', 'Sarabun-OFL.txt')),
    '',
    rule(),
    `Third-party packages (${pkgs.length})`,
    rule(),
    pkgs.map((p) => `${p.name}@${p.version}  ${p.license}`).join('\n'),
  ]
  for (const p of pkgs) {
    parts.push('', rule(), `${p.name}@${p.version}`, `License: ${p.license}`, ...(p.homepage ? [`Source: ${p.homepage}`] : []), rule('-'), licenseTexts(p.dir) || fallbackText(p))
  }
  return parts.join('\n') + '\n'
}
