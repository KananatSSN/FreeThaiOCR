#!/usr/bin/env node
// Downloads the OpenThai 2.0 OCR model files (Apache-2.0, iApp Technology) at the
// Hugging Face revision pinned in models.json into public/models/<rev7>/ and
// verifies their SHA-256. Files that already match are skipped.
// The revision is part of the URL, so the server can cache them as immutable.
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const rootDir = path.resolve(import.meta.dirname, '..')
const { repo, revision, files } = JSON.parse(await readFile(path.join(rootDir, 'models.json'), 'utf8'))
const outDir = path.join(rootDir, 'public', 'models', revision.slice(0, 7))
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

await mkdir(outDir, { recursive: true })
for (const [name, expected] of Object.entries(files)) {
  const dest = path.join(outDir, name)
  if (existsSync(dest) && sha256(await readFile(dest)) === expected) continue
  const url = `https://huggingface.co/${repo}/resolve/${revision}/${name}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status} from ${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const got = sha256(buf)
  if (got !== expected) throw new Error(`${name}: checksum mismatch (got ${got})`)
  await writeFile(dest, buf)
  console.log(`fetched ${name} (${(buf.length / 1024).toFixed(0)} KiB)`)
}
console.log(`models ready in public/models/${revision.slice(0, 7)}/`)
