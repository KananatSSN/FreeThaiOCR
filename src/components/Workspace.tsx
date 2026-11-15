import { PanelBottomOpen } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { ensureEngine } from '@/lib/ocrService'
import { selectActive, useApp } from '@/state/store'
import { EngineStatus } from './EngineStatus'
import { FileSidebar } from './FileSidebar'
import { PageViewer, type ViewerHandle } from './PageViewer'
import { ResultsPanel } from './ResultsPanel'
import { Toolbar } from './Toolbar'

export function Workspace() {
  const { t } = useTranslation()
  const isMobile = useIsMobile()
  // The file list shows for several files, or one multi-page file (its thumbnails).
  const showFiles = useApp((s) => s.files.length > 1 || (selectActive(s)?.meta?.pageCount ?? 0) > 1)
  const [filesOpen, setFilesOpen] = useState(false)
  const [viewer, setViewer] = useState<ViewerHandle | null>(null)
  const onReady = useCallback((h: ViewerHandle) => setViewer(h), [])
  const [drawer, setDrawer] = useState(false)
  const status = useApp((s) => selectActive(s)?.pages[s.current]?.status)
  const boxesRunning = useApp((s) => !!selectActive(s)?.pages[s.current]?.boxes.some((b) => b.status === 'running'))

  // Start fetching the engine as soon as a document is open: by the time the
  // user presses OCR it is usually ready.
  useEffect(() => {
    void ensureEngine().catch(() => {})
  }, [])

  // On phones, open the results drawer when a result arrives.
  const [prevStatus, setPrevStatus] = useState(status)
  if (status !== prevStatus) {
    setPrevStatus(status)
    if (isMobile && status === 'done') setDrawer(true)
  }

  const viewerArea = (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar viewer={viewer} onOpenFiles={isMobile && showFiles ? () => setFilesOpen(true) : undefined} />
      <div className="relative min-h-0 flex-1">
        <EngineStatus />
        <PageViewer onReady={onReady} />
      </div>
    </div>
  )

  if (isMobile) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {viewerArea}
        <div className="flex items-center gap-2 border-t bg-background p-2">
          <Button className="flex-1" variant="secondary" onClick={() => setDrawer(true)}>
            <PanelBottomOpen /> {t('results.show')}
            {boxesRunning && <span className="size-2 animate-pulse rounded-full bg-orange-500" />}
          </Button>
        </div>
        <Drawer open={filesOpen} onOpenChange={setFilesOpen} direction="left">
          <DrawerContent className="w-[85vw] max-w-sm">
            <DrawerTitle className="sr-only">{t('files.title')}</DrawerTitle>
            <FileSidebar onPick={() => setFilesOpen(false)} />
          </DrawerContent>
        </Drawer>
        <Drawer open={drawer} onOpenChange={setDrawer}>
          <DrawerContent className="h-[80dvh] max-h-[80dvh]">
            <DrawerTitle className="sr-only">{t('results.title')}</DrawerTitle>
            <div className="min-h-0 flex-1">
              <ResultsPanel />
            </div>
          </DrawerContent>
        </Drawer>
      </div>
    )
  }

  return (
    <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
      {showFiles && (
        <>
          <ResizablePanel defaultSize={260} minSize={200} maxSize={420} className="bg-muted/30">
            <FileSidebar />
          </ResizablePanel>
          <ResizableHandle />
        </>
      )}
      <ResizablePanel minSize="30">{viewerArea}</ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize="34" minSize={280}>
        <ResultsPanel />
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
