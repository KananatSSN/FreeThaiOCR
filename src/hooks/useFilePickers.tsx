import { useRef } from 'react'
import { useAddFiles } from './useAddFiles'

/** Hidden pickers for files (multi-select) and whole folders. */
export function useFilePickers() {
  const { add, busy } = useAddFiles()
  const files = useRef<HTMLInputElement>(null)
  const folder = useRef<HTMLInputElement>(null)
  const inputs = (
    <>
      <input ref={files} type="file" hidden multiple accept="application/pdf,image/*" data-testid="pick-files" onChange={(e) => void add(e.target.files).then(() => (e.target.value = ''))} />
      {/* webkitdirectory: every file in the chosen folder, with relative paths */}
      <input ref={folder} type="file" hidden multiple {...{ webkitdirectory: '' }} data-testid="pick-folder" onChange={(e) => void add(e.target.files).then(() => (e.target.value = ''))} />
    </>
  )
  return { inputs, busy, pickFiles: () => files.current?.click(), pickFolder: () => folder.current?.click() }
}
