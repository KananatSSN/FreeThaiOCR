import { Braces, ChevronDown, ClipboardCopy, Download, FileArchive, FileCode, FileText, FileType } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useCopy } from '@/hooks/useCopy'
import { fileName, getFile, useActiveFile, useApp, viewEngine } from '@/state/store'

// pdf-lib, fflate and the font only load when an export is requested.
const exporters = () => import('@/lib/exporters')
type Kind = 'txt' | 'md' | 'json' | 'pdf'

/** Pages above which the export toast warns that OCR will take a while. */
const LONG_JOB_PAGES = 1000

export function ExportMenu() {
  const { t } = useTranslation()
  const copy = useCopy()
  const file = useActiveFile()
  const nFiles = useApp((s) => s.files.length)
  const busy = useApp((s) => !!s.batch)
  // Exports use the engine of the open tab.
  const engine = useApp(viewEngine)
  if (!file) return null

  /**
   * Run an export: missing pages are OCR'd first (progress + Cancel in the toast),
   * then the file is built and downloaded.
   */
  const run = async (job: (m: Awaited<ReturnType<typeof exporters>>) => Promise<'done' | 'cancelled'>) => {
    const id = toast.loading(t('export.preparing'), {
      action: { label: t('toolbar.cancel'), onClick: () => void import('@/lib/ocrService').then((m) => m.cancelBatch()) },
      duration: Infinity,
    })
    // Mirror batch progress into the toast while OCR runs (only when it changes: the
    // store also changes with every background read).
    let shown = ''
    const unsub = useApp.subscribe((s) => {
      const b = s.batch
      if (!b || b.scope !== 'export' || !b.pagesTotal) return
      const desc = [t('toolbar.progress', { done: b.pagesDone, total: b.pagesTotal }), b.pagesTotal > LONG_JOB_PAGES ? t('export.long') : '', b.currentPath ?? ''].filter(Boolean).join(' · ')
      if (desc === shown) return
      shown = desc
      toast.loading(t('export.ocrMissing'), { id, description: desc })
    })
    // The outcome gets a toast of its own: an in-place update arriving right after a
    // progress update can be lost by the toaster, leaving "Reading…" up for good.
    const finish = (show: () => void) => {
      unsub()
      toast.dismiss(id)
      show()
    }
    try {
      const outcome = await job(await exporters())
      if (outcome === 'cancelled') finish(() => toast.info(t('export.cancelled'), { duration: 3000 }))
      else finish(() => toast.success(t('export.done'), { duration: 3000 }))
    } catch (e) {
      finish(() => toast.error(t('export.failed', { error: e instanceof Error ? e.message : String(e) }), { duration: 6000 }))
    } finally {
      unsub()
    }
  }

  const exportThis = (kind: Kind) => () => void run((m) => m.exportFile(file.id, kind, engine))
  const exportAll = (kind: Kind) => () => void run((m) => m.exportAll(kind, engine))
  const copyAll = () =>
    void run(async (m) => {
      const { completeFiles } = await import('@/lib/ocrService')
      if (!(await completeFiles([file.id], 'export', engine))) return 'cancelled'
      const latest = getFile(useApp.getState(), file.id)
      if (latest) await copy(m.allText(m.asRead(latest, engine).pages))
      return 'done'
    })

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" disabled={busy}>
          <Download /> {t('export.menu')} <ChevronDown className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="truncate text-xs text-muted-foreground">{t('export.thisFile', { name: fileName(file) })}</DropdownMenuLabel>
        <p className="px-2 pb-1 text-xs text-muted-foreground">{t('export.engine', { engine: engine === 'akson' ? 'AksonOCR-Lite' : 'OpenThai 2.1' })}</p>
        <DropdownMenuItem onSelect={copyAll}>
          <ClipboardCopy /> {t('export.copyAll')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={exportThis('txt')}>
          <FileText /> {t('export.txt')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={exportThis('md')}>
          <FileCode /> {t('export.md')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={exportThis('json')}>
          <Braces /> {t('export.json')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={exportThis('pdf')}>
          <FileType /> {t('export.pdf')}
        </DropdownMenuItem>
        {nFiles > 1 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">{t('export.allFiles', { count: nFiles })}</DropdownMenuLabel>
            <DropdownMenuItem onSelect={exportAll('txt')}>
              <FileArchive /> {t('export.zipTxt')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={exportAll('md')}>
              <FileArchive /> {t('export.zipMd')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={exportAll('json')}>
              <FileArchive /> {t('export.zipJson')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={exportAll('pdf')}>
              <FileArchive /> {t('export.zipPdf')}
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <p className="px-2 py-1.5 text-xs text-muted-foreground">{t('export.completeNote')}</p>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
