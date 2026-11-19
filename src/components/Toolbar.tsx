import { ChevronLeft, ChevronRight, Files, Maximize, ZoomIn, ZoomOut } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useActiveFile, useActivePage, useApp } from '@/state/store'
import { AutoProgress } from './AutoProgress'
import { SettingsMenu } from './SettingsMenu'
import type { ViewerHandle } from './PageViewer'

function Tip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function Toolbar({ viewer, onOpenFiles }: { viewer: ViewerHandle | null; onOpenFiles?: () => void }) {
  const { t } = useTranslation()
  const file = useActiveFile()
  const current = useApp((s) => s.current)
  const page = useActivePage()
  if (!file || !page) return null
  const total = file.meta?.pageCount ?? 1

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b bg-background px-2 py-1.5">
      {onOpenFiles && (
        <Button size="sm" variant="outline" onClick={onOpenFiles} aria-label={t('files.title')}>
          <Files /> <span className="tabular-nums">{useApp.getState().files.length}</span>
        </Button>
      )}
      {/* Every page is read automatically: just show how far along that is. */}
      <AutoProgress />

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
        <SettingsMenu />
      </div>
    </div>
  )
}
