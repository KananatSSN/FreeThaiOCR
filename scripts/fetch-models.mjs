#!/usr/bin/env node
// Downloads the OCR model files pinned in models.json into public/models/<key>-<rev7>/ and
// verifies their SHA-256. Files that already match are skipped.
//   openthai: OpenThai 2.1 OCR Text (Apache-2.0, iApp Technology)
//   akson:    AksonOCR-Lite (Apache-2.0, Teetouch Jaknamon / Remtir), our fp16 web copy
// The revision is part of the URL, so the server can cache them as immutable.
// Before the fp16 copy is published (revision ""), AKSON_LOCAL_DIR or ./.akson-fp16
// (made by scripts/akson-fp16/convert.py) is used instead and lands in akson-local/.
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const rootDir = path.resolve(import.meta.dirname, '..')
const manifest = JSON.parse(await readFile(path.join(rootDir, 'models.json'), 'utf8'))
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
export const folder = (key, { revision }) => `${key}-${revision ? revision.slice(0, 7) : 'local'}`

for (const [key, { repo, revision, files }] of Object.entries(manifest)) {
  const outDir = path.join(rootDir, 'public', 'models', folder(key, { revision }))
  const localDir = revision ? null : path.resolve(rootDir, process.env[`${key.toUpperCase()}_LOCAL_DIR`] ?? `.${key}-fp16`)
  if (localDir && !existsSync(localDir)) {
    throw new Error(`${key}: no revision pinned in models.json and no local copy at ${localDir} (see scripts/akson-fp16/)`)
  }
  await mkdir(outDir, { recursive: true })
  for (const [name, expected] of Object.entries(files)) {
    const dest = path.join(outDir, name)
    if (existsSync(dest) && sha256(await readFile(dest)) === expected) continue
    let buf
    if (localDir) {
      buf = await readFile(path.join(localDir, name))
    } else {
      const url = `https://huggingface.co/${repo}/resolve/${revision}/${name}`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`${name}: HTTP ${res.status} from ${url}`)
      buf = Buffer.from(await res.arrayBuffer())
    }
    const got = sha256(buf)
    if (got !== expected) throw new Error(`${key}/${name}: checksum mismatch (got ${got})`)
    await writeFile(dest, buf)
    console.log(`fetched ${key}/${name} (${(buf.length / 1024).toFixed(0)} KiB)${localDir ? ' from local copy' : ''}`)
  }
  console.log(`${key} models ready in public/models/${folder(key, { revision })}/`)
}
