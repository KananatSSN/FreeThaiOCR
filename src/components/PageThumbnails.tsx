import { Check, FileText, Loader2 } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { type FileEntry, useApp } from '@/state/store'
import { cn } from 'cn'

/** Page thumbnails of one (the active) file, as a compact grid nested in the file list. */
export function PageThumbnails({ file }: { file: FileEntry }) {
  const current = useApp((s) => s.current)
  const activeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [current])
  if (!file.meta || file.meta.pageCount < 2) return null
  return (
    // Columns follow the sidebar's width (container queries), not the window's.
    <div className="grid grid-cols-2 gap-2 px-2 pt-1 pb-2 @[17rem]:grid-cols-3 @[24rem]:grid-cols-4">
      {file.pages.map((p, i) => {
        const size = file.meta!.sizes[i]
        return (
          <button
            key={i}
            ref={i === current ? activeRef : undefined}
            type="button"
            onClick={() => useApp.getState().setCurrent(i)}
            className={cn(
              'relative overflow-hidden rounded-md border bg-white text-left shadow-xs outline-none transition focus-visible:ring-2 focus-visible:ring-ring',
              i === current ? 'ring-2 ring-primary' : 'hover:ring-2 hover:ring-primary/40',
            )}
            style={{ aspectRatio: `${size.width} / ${size.height}` }}
            aria-label={`${i + 1}`}
            aria-current={i === current}
          >
            {p.thumb ? <img src={p.thumb} alt="" className="h-full w-full object-cover" draggable={false} /> : <Skeleton className="h-full w-full rounded-none" />}
            <span className="absolute bottom-0.5 left-0.5 rounded bg-black/60 px-1 text-[10px] font-medium text-white tabular-nums">{i + 1}</span>
            <span className="absolute top-0.5 right-0.5">
              {p.status === 'running' && <Loader2 className="size-3.5 animate-spin rounded-full bg-background p-0.5" />}
              {p.status === 'done' && p.result?.source === 'ocr' && <Check className="size-3.5 rounded-full bg-emerald-600 p-0.5 text-white" />}
              {p.status === 'done' && p.result?.source === 'pdf' && <FileText className="size-3.5 rounded-full bg-sky-600 p-0.5 text-white" />}
            </span>
          </button>
        )
      })}
    </div>
  )
}
