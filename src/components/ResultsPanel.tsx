import { Check, Copy, FileText, Loader2, RotateCcw, RotateCw, ScanText, Trash2, Undo2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCopy } from '@/hooks/useCopy'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { ocrBox } from '@/lib/ocrService'
import { boxText, lineRange, pageText, type RegionBox, selectActive, useActivePage, useApp } from '@/state/store'

const NO_BOXES: RegionBox[] = []
import { cn } from 'cn'
import { ExportMenu } from './ExportMenu'

function CopyButton({ text, label }: { text: string; label?: string }) {
  const { t } = useTranslation()
  const copy = useCopy()
  const [done, setDone] = useState(false)
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={!text}
      onClick={async () => {
        await copy(text)
        setDone(true)
        setTimeout(() => setDone(false), 1200)
      }}
    >
      {done ? <Check /> : <Copy />} {label ?? t('results.copy')}
    </Button>
  )
}

function PageTab() {
  const { t } = useTranslation()
  const current = useApp((s) => s.current)
  const fileId = useApp((s) => s.activeId)
  const page = useActivePage()
  const focusLine = useApp((s) => s.focusLine)
  const ref = useRef<HTMLTextAreaElement>(null)

  // A line clicked in the viewer: select its text here.
  useEffect(() => {
    if (focusLine === null || !page || !ref.current) return
    const range = lineRange(page, focusLine)
    if (range) {
      ref.current.focus({ preventScroll: true })
      ref.current.setSelectionRange(range[0], range[1])
      // Scroll the selection into view: approximate by line number.
      const before = ref.current.value.slice(0, range[0]).split('\n').length - 1
      const lh = parseFloat(getComputedStyle(ref.current).lineHeight) || 24
      ref.current.scrollTop = Math.max(0, before * lh - ref.current.clientHeight / 3)
    }
    useApp.getState().setFocusLine(null)
  }, [focusLine, page])

  if (!page || !fileId) return null
  const text = pageText(page)
  const r = page.result

  if (page.status === 'running' && !r) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> {t('results.running')}
      </div>
    )
  }
  if (!r) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
        <ScanText className="size-8 opacity-40" />
        {page.status === 'error' ? <span className="text-destructive">{t('results.error', { error: page.error })}</span> : t('results.empty')}
      </div>
    )
  }
  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant={r.source === 'pdf' ? 'secondary' : 'outline'}>
          {r.source === 'pdf' ? <FileText /> : <ScanText />}
          {r.source === 'pdf' ? t('results.fromPdf') : t('results.fromOcr')}
        </Badge>
        {r.engine && (
          <Badge variant="outline" title={r.markdown !== undefined ? t('results.markdownHint') : undefined}>
            {r.engine === 'akson' ? 'AksonOCR-Lite' : 'OpenThai 2.1'}
            {r.markdown !== undefined && ` · ${t('results.markdown')}`}
          </Badge>
        )}
        {page.edited !== undefined && <Badge variant="secondary">{t('results.edited')}</Badge>}
        {!!r.rotation && (
          <Badge variant="outline" title={t('results.rotated', { deg: r.rotation })}>
            <RotateCw /> {r.rotation}°
          </Badge>
        )}
        {page.status === 'running' && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        <div className="ml-auto flex gap-1.5">
          {page.edited !== undefined && (
            <Button size="sm" variant="ghost" onClick={() => useApp.getState().patchPage(fileId, current, { edited: undefined })}>
              <Undo2 /> <span className="sr-only sm:not-sr-only">{t('results.revert')}</span>
            </Button>
          )}
          <CopyButton text={text} />
        </div>
      </div>
      <Textarea
        ref={ref}
        value={text}
        onChange={(e) => useApp.getState().patchPage(fileId, current, { edited: e.target.value })}
        className="thai-text min-h-0 flex-1 resize-none text-base leading-relaxed"
        spellCheck={false}
        lang="th"
      />
    </div>
  )
}

function BoxCard({ box, fileId, index }: { box: RegionBox; fileId: string; index: number }) {
  const { t } = useTranslation()
  const selected = useApp((s) => s.selectedBox === box.id)
  const text = boxText(box)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selected])
  return (
    <Card
      ref={ref}
      onClick={() => useApp.getState().selectBox(box.id)}
      className={cn('gap-2 p-3 transition-colors', selected && 'ring-2 ring-orange-500/70')}
    >
      <div className="flex items-center gap-1.5">
        <span className="flex size-6 items-center justify-center rounded-md bg-orange-600 text-xs font-bold text-white">{box.n}</span>
        <span className="text-sm font-medium">{t('results.box', { n: box.n })}</span>
        {box.status === 'running' && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        {box.edited !== undefined && <Badge variant="secondary">{t('results.edited')}</Badge>}
        <div className="ml-auto flex gap-1">
          <Button size="icon-sm" variant="ghost" title={t('results.rerun')} aria-label={t('results.rerun')} onClick={() => void ocrBox(fileId, index, box.id)} disabled={box.status === 'running'}>
            <RotateCcw />
          </Button>
          <Button size="icon-sm" variant="ghost" title={t('results.delete')} aria-label={t('results.delete')} onClick={() => useApp.getState().removeBox(fileId, index, box.id)}>
            <Trash2 />
          </Button>
          <CopyButton text={text} label="" />
        </div>
      </div>
      {box.status === 'error' ? (
        <p className="text-sm text-destructive">{t('results.error', { error: box.error })}</p>
      ) : box.result || box.edited !== undefined ? (
        <Textarea
          value={text}
          onChange={(e) => useApp.getState().patchBox(fileId, index, box.id, { edited: e.target.value })}
          className="thai-text min-h-16 text-base leading-relaxed"
          rows={Math.min(8, Math.max(2, text.split('\n').length))}
          spellCheck={false}
          lang="th"
        />
      ) : (
        <p className="text-sm text-muted-foreground">{t('results.running')}</p>
      )}
    </Card>
  )
}

function BoxesTab() {
  const { t } = useTranslation()
  const current = useApp((s) => s.current)
  const fileId = useApp((s) => s.activeId)
  const boxes = useApp((s) => selectActive(s)?.pages[s.current]?.boxes ?? NO_BOXES)
  if (!boxes.length || !fileId) {
    return <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">{t('results.emptyBoxes')}</div>
  }
  const sorted = [...boxes].sort((a, b) => a.n - b.n)
  const combined = sorted.map(boxText).filter(Boolean).join('\n\n')
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1.5 border-b p-3">
        <CopyButton text={combined} label={t('results.combined')} />
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => useApp.getState().clearBoxes(fileId, current)}>
          <Trash2 /> <span className="sr-only sm:not-sr-only">{t('results.clearBoxes')}</span>
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-2 p-3">
          {sorted.map((b) => (
            <BoxCard key={b.id} box={b} fileId={fileId} index={current} />
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}

export function ResultsPanel() {
  const { t } = useTranslation()
  const nBoxes = useApp((s) => selectActive(s)?.pages[s.current]?.boxes.length ?? 0)
  const mode = useApp((s) => s.mode)
  const [tab, setTab] = useState('page')
  // Switching to box drawing shows the boxes tab, so new results are visible.
  const [prevMode, setPrevMode] = useState(mode)
  if (mode !== prevMode) {
    setPrevMode(mode)
    if (mode === 'box') setTab('boxes')
  }
  return (
    <Tabs value={tab} onValueChange={setTab} className="flex h-full min-h-0 flex-col gap-0">
      <div className="flex items-center gap-2 border-b px-2 py-1.5">
        <TabsList>
          <TabsTrigger value="page">{t('results.page')}</TabsTrigger>
          <TabsTrigger value="boxes">
            {t('results.boxes')}
            {nBoxes > 0 && <Badge className="ml-1 h-4 min-w-4 px-1 text-[10px]">{nBoxes}</Badge>}
          </TabsTrigger>
        </TabsList>
        <div className="ml-auto">
          <ExportMenu />
        </div>
      </div>
      <TabsContent value="page" className="min-h-0 flex-1">
        <PageTab />
      </TabsContent>
      <TabsContent value="boxes" className="min-h-0 flex-1">
        <BoxesTab />
      </TabsContent>
    </Tabs>
  )
}
