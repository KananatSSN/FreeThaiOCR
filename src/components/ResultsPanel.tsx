import { AlertCircle, Check, Copy, Download, Loader2, RotateCcw, RotateCw, ScanText, Undo2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCopy } from '@/hooks/useCopy'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { documentModeCapable } from '@/lib/device'
import { rereadPage, retryEngine } from '@/lib/ocrService'
import type { EngineModel } from '@/ocr/worker'
import { lineRange, pageText, readOf, useActivePage, useApp } from '@/state/store'
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

const ENGINE_LABEL: Record<EngineModel, string> = { openthai: 'OpenThai 2.1', akson: 'AksonOCR-Lite' }

/** One engine's reading of the page on screen, editable. */
function ReadView({ engine }: { engine: EngineModel }) {
  const { t } = useTranslation()
  const current = useApp((s) => s.current)
  const fileId = useApp((s) => s.activeId)
  const page = useActivePage()
  const paused = useApp((s) => s.autoPaused)
  const focusLine = useApp((s) => s.focusLine)
  const ref = useRef<HTMLTextAreaElement>(null)
  const read = page ? readOf(page, engine) : undefined

  // A line clicked in the viewer: select its text here.
  useEffect(() => {
    if (focusLine === null || !read || !ref.current) return
    const range = lineRange(read, focusLine)
    if (range) {
      ref.current.focus({ preventScroll: true })
      ref.current.setSelectionRange(range[0], range[1])
      // Scroll the selection into view: approximate by line number.
      const before = ref.current.value.slice(0, range[0]).split('\n').length - 1
      const lh = parseFloat(getComputedStyle(ref.current).lineHeight) || 24
      ref.current.scrollTop = Math.max(0, before * lh - ref.current.clientHeight / 3)
    }
    useApp.getState().setFocusLine(null)
  }, [focusLine, read])

  if (!page || !read || !fileId) return null
  const text = pageText(read)
  const r = read.result

  if (!r) {
    if (read.status === 'error') {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm">
          <span className="text-destructive">{t('results.error', { error: read.error })}</span>
          <Button size="sm" variant="outline" onClick={() => rereadPage(fileId, current, engine)}>
            <RotateCcw /> {t('results.retry')}
          </Button>
        </div>
      )
    }
    const waiting = read.status === 'idle' && engine === 'openthai' && paused
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
        {waiting ? <ScanText className="size-8 opacity-40" /> : <Loader2 className="size-5 animate-spin" />}
        {waiting ? t('results.paused') : read.status === 'running' ? t('results.running') : t('results.queued')}
      </div>
    )
  }
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" title={r.markdown !== undefined ? t('results.markdownHint') : undefined}>
          <ScanText />
          {ENGINE_LABEL[r.engine ?? engine] + (r.markdown !== undefined ? ` · ${t('results.markdown')}` : '')}
        </Badge>
        {read.edited !== undefined && <Badge variant="secondary">{t('results.edited')}</Badge>}
        {!!r.rotation && (
          <Badge variant="outline" title={t('results.rotated', { deg: r.rotation })}>
            <RotateCw /> {r.rotation}°
          </Badge>
        )}
        {read.status === 'running' && <Loader2 className="size-4 animate-spin text-muted-foreground" role="status" aria-label={t('results.running')} />}
        {read.status === 'error' && <span className="text-xs text-destructive">{t('results.error', { error: read.error })}</span>}
        <div className="ml-auto flex gap-1.5">
          {read.edited !== undefined && (
            <Button size="sm" variant="ghost" onClick={() => useApp.getState().patchRead(fileId, current, engine, { edited: undefined })}>
              <Undo2 /> <span className="sr-only sm:not-sr-only">{t('results.revert')}</span>
            </Button>
          )}
          <CopyButton text={text} />
        </div>
      </div>
      <Textarea
        ref={ref}
        value={text}
        aria-label={t('results.textOf', { engine: ENGINE_LABEL[engine] })}
        onChange={(e) => useApp.getState().patchRead(fileId, current, engine, { edited: e.target.value })}
        className="thai-text min-h-0 flex-1 resize-none text-base leading-relaxed"
        spellCheck={false}
        lang="th"
      />
    </div>
  )
}

/** Before AksonOCR-Lite's first use: what it is, and a button to download it. */
function AksonIntro() {
  const { t } = useTranslation()
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm">
      <ScanText className="size-8 text-muted-foreground opacity-60" />
      <p className="font-medium">AksonOCR-Lite</p>
      <p className="max-w-sm text-muted-foreground">{t('akson.intro')}</p>
      <Button onClick={() => useApp.getState().enableAkson()}>
        <Download /> {t('akson.load')}
      </Button>
      <p className="max-w-sm text-xs text-muted-foreground">{t('akson.privacy')}</p>
    </div>
  )
}

/** AksonOCR-Lite's bar: loading progress or error, and the document-mode switch. */
function AksonBar() {
  const { t } = useTranslation()
  const { state, stage, progress, error } = useApp((s) => s.engines.akson)
  const backend = useApp((s) => s.backend)
  const documentMode = useApp((s) => s.documentMode)
  const [confirming, setConfirming] = useState(false)
  const capable = documentModeCapable(backend)

  // The scheduler then re-reads the page on screen in the new mode (once any read in
  // progress finishes), unless its text was edited.
  const apply = (on: boolean) => useApp.getState().setDocumentMode(on)
  const toggle = (on: boolean) => {
    if (on && !useApp.getState().documentConsented) setConfirming(true)
    else apply(on)
  }

  return (
    <>
      {capable && (
        <div className="flex items-center gap-2 border-b px-3 py-2 text-sm">
          <Switch id="akson-document" checked={documentMode} onCheckedChange={toggle} />
          <Label htmlFor="akson-document" className="font-normal">
            {t('akson.document')}
          </Label>
          <span className="hidden truncate text-xs text-muted-foreground @md:inline">{t('akson.documentHint')}</span>
        </div>
      )}
      {state === 'loading' && (
        <div className="flex flex-col gap-1.5 border-b px-3 py-2 text-xs" role="status">
          <span className="flex items-center gap-2 font-medium">
            <Loader2 className="size-3.5 animate-spin" />
            {stage === 'document' ? t('engine.document') : t('akson.loading')}
            {typeof progress === 'number' && <span className="tabular-nums text-muted-foreground">{Math.round(progress * 100)}%</span>}
          </span>
          <span className="text-muted-foreground">{stage === 'document' ? t('engine.documentFirstTime') : t('engine.aksonFirstTime')}</span>
          {typeof progress === 'number' && <Progress value={progress * 100} className="h-1.5" />}
        </div>
      )}
      {state === 'error' && (
        <div className="flex items-center gap-2 border-b px-3 py-2 text-xs">
          <AlertCircle className="size-4 shrink-0 text-destructive" />
          <span className="flex-1">{t('engine.error', { error })}</span>
          <Button size="xs" variant="outline" onClick={() => void retryEngine('akson')}>
            <RotateCcw /> {t('engine.retry')}
          </Button>
        </div>
      )}
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('settings.confirmDocumentTitle')}</DialogTitle>
            <DialogDescription>{t('settings.confirmDocument')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              {t('settings.cancel')}
            </Button>
            <Button
              onClick={() => {
                setConfirming(false)
                apply(true)
              }}
            >
              {t('settings.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function AksonTab() {
  const enabled = useApp((s) => s.aksonEnabled)
  if (!enabled) return <AksonIntro />
  return (
    <div className="@container flex h-full min-h-0 flex-col">
      <AksonBar />
      <div className="min-h-0 flex-1">
        <ReadView engine="akson" />
      </div>
    </div>
  )
}

export function ResultsPanel() {
  const tab = useApp((s) => s.resultsTab)
  return (
    <Tabs value={tab} onValueChange={(v) => useApp.getState().setResultsTab(v as EngineModel)} className="flex h-full min-h-0 flex-col gap-0">
      <div className="flex items-center gap-2 border-b px-2 py-1.5">
        <TabsList>
          <TabsTrigger value="openthai">OpenThai</TabsTrigger>
          <TabsTrigger value="akson">AksonOCR</TabsTrigger>
        </TabsList>
        <div className="ml-auto">
          <ExportMenu />
        </div>
      </div>
      <TabsContent value="openthai" className="min-h-0 flex-1">
        <ReadView engine="openthai" />
      </TabsContent>
      <TabsContent value="akson" className="min-h-0 flex-1">
        <AksonTab />
      </TabsContent>
    </Tabs>
  )
}
