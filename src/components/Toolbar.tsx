import { CheckCheck, ChevronLeft, ChevronRight, Files, Hand, Layers, ListChecks, Loader2, Maximize, ScanText, Settings2, SquareDashedMousePointer, ZoomIn, ZoomOut } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ocrAll, ocrAllFiles, ocrPage } from '@/lib/ocrService'
import { type Mode, pagesDone, useActiveFile, useActivePage, useApp } from '@/state/store'
import { BatchProgress } from './BatchProgress'
import type { ViewerHandle } from './PageViewer'

function Tip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

const hasWebGpu = typeof navigator !== 'undefined' && 'gpu' in navigator

export function Toolbar({ viewer, onOpenFiles }: { viewer: ViewerHandle | null; onOpenFiles?: () => void }) {
  const { t } = useTranslation()
  const file = useActiveFile()
  const current = useApp((s) => s.current)
  const page = useActivePage()
  const mode = useApp((s) => s.mode)
  const batch = useApp((s) => s.batch)
  const backend = useApp((s) => s.backend)
  const nFiles = useApp((s) => s.files.length)
  // Files that still have pages without text (still-loading files count too).
  const filesLeft = useApp((s) => s.files.filter((f) => f.status === 'loading' || (f.status === 'ready' && pagesDone(f) < f.pages.length)).length)
  if (!file || !page) return null
  const multi = nFiles > 1
  const total = file.meta?.pageCount ?? 1
  const fileId = file.id
  const running = page.status === 'running'
  const done = page.status === 'done' && page.result?.source === 'ocr'

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b bg-background px-2 py-1.5">
      {onOpenFiles && (
        <Button size="sm" variant="outline" onClick={onOpenFiles} aria-label={t('files.title')}>
          <Files /> <span className="tabular-nums">{useApp.getState().files.length}</span>
        </Button>
      )}
      <ToggleGroup type="single" variant="outline" size="sm" value={mode} onValueChange={(v) => v && useApp.getState().setMode(v as Mode)}>
        <ToggleGroupItem value="pan" aria-label={t('toolbar.pan')}>
          <Hand /> <span className="hidden lg:inline">{t('toolbar.pan')}</span>
        </ToggleGroupItem>
        <ToggleGroupItem value="box" aria-label={t('toolbar.box')}>
          <SquareDashedMousePointer /> <span className="hidden sm:inline">{t('toolbar.box')}</span>
        </ToggleGroupItem>
      </ToggleGroup>

      {/* With several files, "OCR all files" is the main action; this one steps back. */}
      <Button size="sm" variant={multi ? 'outline' : 'default'} onClick={() => void ocrPage(fileId, current).catch(() => {})} disabled={running || !!batch}>
        {running ? <Loader2 className="animate-spin" /> : <ScanText />}
        {done ? t('toolbar.ocrAgain') : t('toolbar.ocrPage')}
      </Button>

      {multi &&
        (batch?.scope === 'all' ? (
          <BatchProgress showFile />
        ) : filesLeft ? (
          <Button size="sm" onClick={() => void ocrAllFiles()} disabled={!!batch}>
            <ListChecks /> {t('files.ocrAll')}
            <span className="rounded-full bg-primary-foreground/20 px-1.5 text-xs tabular-nums">{filesLeft}</span>
          </Button>
        ) : (
          <Button size="sm" variant="ghost" disabled className="text-emerald-700 opacity-100 dark:text-emerald-400">
            <CheckCheck /> <span className="hidden sm:inline">{t('files.allDone')}</span>
          </Button>
        ))}

      {total > 1 &&
        (batch?.scope === 'file' ? (
          <BatchProgress />
        ) : (
          <Button size="sm" variant="outline" onClick={() => void ocrAll(fileId)} disabled={!!batch}>
            <Layers /> <span className="hidden sm:inline">{t('toolbar.ocrAll')}</span>
          </Button>
        ))}

      <div className="ml-auto flex items-center gap-1">
        {total > 1 && (
          <>
            <Tip label={t('toolbar.prev')}>
              <Button size="icon-sm" variant="ghost" disabled={current === 0} onClick={() => useApp.getState().setCurrent(current - 1)} aria-label={t('toolbar.prev')}>
                <ChevronLeft />
              </Button>
            </Tip>
            <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">{t('toolbar.page', { n: current + 1, total })}</span>
            <Tip label={t('toolbar.next')}>
              <Button size="icon-sm" variant="ghost" disabled={current >= total - 1} onClick={() => useApp.getState().setCurrent(current + 1)} aria-label={t('toolbar.next')}>
                <ChevronRight />
              </Button>
            </Tip>
            <Separator orientation="vertical" className="mx-1 h-5" />
          </>
        )}
        <Tip label={t('toolbar.zoomOut')}>
          <Button size="icon-sm" variant="ghost" onClick={() => viewer?.zoomBy(1 / 1.25)} aria-label={t('toolbar.zoomOut')}>
            <ZoomOut />
          </Button>
        </Tip>
        <Tip label={t('toolbar.fit')}>
          <Button size="icon-sm" variant="ghost" onClick={() => viewer?.fit()} aria-label={t('toolbar.fit')}>
            <Maximize />
          </Button>
        </Tip>
        <Tip label={t('toolbar.zoomIn')}>
          <Button size="icon-sm" variant="ghost" onClick={() => viewer?.zoomBy(1.25)} aria-label={t('toolbar.zoomIn')}>
            <ZoomIn />
          </Button>
        </Tip>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label="Settings">
              <Settings2 />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuCheckboxItem
              checked={backend === 'webgpu'}
              disabled={!hasWebGpu}
              onCheckedChange={(on) => useApp.getState().setBackend(on ? 'webgpu' : 'wasm')}
            >
              {t('engine.gpu')}
            </DropdownMenuCheckboxItem>
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              {hasWebGpu ? t('engine.gpuHint') : t('engine.gpuUnavailable')}
            </DropdownMenuLabel>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
