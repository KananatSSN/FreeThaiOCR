import { AlertTriangle, Check, ChevronRight, ChevronsDownUp, ChevronsUpDown, Circle, CircleDashed, Ellipsis, Folder, FolderOpen, Layers, Loader2, Trash2, X } from 'lucide-react'
import { Collapsible } from 'radix-ui'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { dirname, naturalCompare } from '@/lib/fileTypes'
import { clearFiles, ocrAllFiles, removeFile } from '@/lib/ocrService'
import { type FileEntry, fileName, pagesDone, useApp } from '@/state/store'
import { cn } from 'cn'
import { AddFilesMenu } from './AddFilesMenu'
import { BatchProgress } from './BatchProgress'
import { PageThumbnails } from './PageThumbnails'

function StatusIcon({ f, busy }: { f: FileEntry; busy: boolean }) {
  const cls = 'size-4 shrink-0'
  if (f.status === 'loading' || busy) return <Loader2 className={cn(cls, 'animate-spin text-muted-foreground')} />
  if (f.status === 'error') return <AlertTriangle className={cn(cls, 'text-destructive')} />
  const done = pagesDone(f)
  if (done && done === f.pages.length) return <Check className={cn(cls, 'text-emerald-600')} aria-label="done" />
  if (done) return <CircleDashed className={cn(cls, 'text-sky-600')} aria-label="partial" />
  return <Circle className={cn(cls, 'text-muted-foreground/60')} aria-label="not started" />
}

function FileRow({ f, active, onPick }: { f: FileEntry; active: boolean; onPick?: () => void }) {
  const { t } = useTranslation()
  const busy = useApp((s) => s.batch?.currentPath === f.path) || f.pages.some((p) => p.status === 'running')
  return (
    <li>
      <div
        className={cn(
          'group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
          active ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/70',
        )}
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:underline"
          onClick={() => {
            useApp.getState().setActive(f.id)
            onPick?.()
          }}
          aria-current={active}
          title={f.error ? `${f.path}\n${f.error}` : f.path}
        >
          <StatusIcon f={f} busy={busy} />
          <span className="min-w-0 flex-1 truncate">{fileName(f)}</span>
          {f.status === 'ready' && (
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {pagesDone(f)}/{f.pages.length}
            </span>
          )}
          {f.status === 'error' && <span className="shrink-0 text-xs text-destructive">{t('files.error')}</span>}
        </button>
        <Button
          size="icon-xs"
          variant="ghost"
          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 max-md:opacity-100"
          aria-label={t('files.remove', { name: fileName(f) })}
          title={t('files.remove', { name: fileName(f) })}
          onClick={() => removeFile(f.id)}
        >
          <X />
        </Button>
      </div>
      {active && <PageThumbnails file={f} />}
    </li>
  )
}

const fileDone = (f: FileEntry) => f.status === 'ready' && f.pages.length > 0 && pagesDone(f) === f.pages.length

/** One folder as an accordion section; the header keeps its progress visible when collapsed. */
function FolderGroup({ dir, files, open, onOpenChange, activeId, onPick }: { dir: string; files: FileEntry[]; open: boolean; onOpenChange: (open: boolean) => void; activeId: string | null; onPick?: () => void }) {
  const busy = useApp((s) => files.some((f) => s.batch?.currentPath === f.path || f.pages.some((p) => p.status === 'running')))
  const done = files.filter(fileDone).length
  const FolderIcon = open ? FolderOpen : Folder
  return (
    <Collapsible.Root asChild open={open} onOpenChange={onOpenChange}>
      <section aria-label={dir}>
        <Collapsible.Trigger asChild>
          <button
            type="button"
            className="group/folder flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs font-medium text-muted-foreground outline-none hover:bg-muted/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronRight className="size-3.5 shrink-0 transition-transform duration-200 group-data-[state=open]/folder:rotate-90" />
            <FolderIcon className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate" title={`${dir}/`}>
              {dir}/
            </span>
            {busy && !open && <Loader2 className="size-3.5 shrink-0 animate-spin" />}
            <span className={cn('shrink-0 tabular-nums', done === files.length && 'text-emerald-600')}>
              {done}/{files.length}
            </span>
          </button>
        </Collapsible.Trigger>
        <Collapsible.Content className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
          <ul className="flex flex-col gap-0.5 pt-0.5 pl-3">
            {files.map((f) => (
              <FileRow key={f.id} f={f} active={f.id === activeId} onPick={onPick} />
            ))}
          </ul>
        </Collapsible.Content>
      </section>
    </Collapsible.Root>
  )
}

/** The uploaded files, grouped by folder, with batch OCR. `onPick` closes the mobile drawer. */
export function FileSidebar({ onPick }: { onPick?: () => void }) {
  const { t } = useTranslation()
  const files = useApp((s) => s.files)
  const activeId = useApp((s) => s.activeId)
  const batch = useApp((s) => s.batch)
  const groups = useMemo(() => {
    const sorted = [...files].sort((a, b) => naturalCompare(a.path, b.path))
    const map = new Map<string, FileEntry[]>()
    for (const f of sorted) {
      const dir = dirname(f.path)
      map.set(dir, [...(map.get(dir) ?? []), f])
    }
    return [...map.entries()]
  }, [files])
  // Folders are open unless the user folds them.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const setFolder = (dir: string, open: boolean) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (open) next.delete(dir)
      else next.add(dir)
      return next
    })
  // If the open file lands in a folded folder (e.g. after removing the open
  // file), unfold it so the selection is never hidden.
  const activeDir = dirname(files.find((f) => f.id === activeId)?.path ?? '')
  const [prevActive, setPrevActive] = useState(activeId)
  if (activeId !== prevActive) {
    setPrevActive(activeId)
    if (activeDir && collapsed.has(activeDir)) setFolder(activeDir, true)
  }
  const folders = groups.map(([dir]) => dir).filter(Boolean)
  const remaining = files.some((f) => f.status !== 'error' && (f.status === 'loading' || pagesDone(f) < f.pages.length))

  return (
    <div className="@container flex h-full min-h-0 min-w-0 flex-col">
      <div className="flex items-center gap-1 border-b px-2 py-1.5">
        <span className="px-1 text-sm font-medium">{t('files.title')}</span>
        <span className="text-xs text-muted-foreground tabular-nums">({files.length})</span>
        <div className="ml-auto flex items-center">
          <AddFilesMenu />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-sm" variant="ghost" aria-label={t('files.more')} title={t('files.more')}>
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {folders.length > 1 && (
                <>
                  <DropdownMenuItem onSelect={() => setCollapsed(new Set())}>
                    <ChevronsUpDown /> {t('files.expandAll')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setCollapsed(new Set(folders))}>
                    <ChevronsDownUp /> {t('files.collapseAll')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem variant="destructive" onSelect={() => clearFiles()}>
                <Trash2 /> {t('files.clear')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-2 p-2">
          {groups.map(([dir, list]) =>
            dir ? (
              <FolderGroup key={dir} dir={dir} files={list} open={!collapsed.has(dir)} onOpenChange={(o) => setFolder(dir, o)} activeId={activeId} onPick={onPick} />
            ) : (
              // Loose files (not from a folder) need no fold.
              <ul key="." className="flex flex-col gap-0.5" aria-label={t('files.title')}>
                {list.map((f) => (
                  <FileRow key={f.id} f={f} active={f.id === activeId} onPick={onPick} />
                ))}
              </ul>
            ),
          )}
        </div>
      </ScrollArea>
      {files.length > 1 && (
        <div className="border-t p-2">
          {batch && batch.scope !== 'file' ? (
            <BatchProgress showFile className="w-full" />
          ) : (
            <Button className="w-full" variant="outline" size="sm" onClick={() => void ocrAllFiles()} disabled={!remaining || !!batch}>
              <Layers /> {t('files.ocrAll')}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
