import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { cancelBatch } from '@/lib/ocrService'
import { useApp } from '@/state/store'
import { cn } from 'cn'

/** Progress of the running batch (OCR all pages / all files / export prep) with cancel. */
export function BatchProgress({ className, showFile = false }: { className?: string; showFile?: boolean }) {
  const { t } = useTranslation()
  const batch = useApp((s) => s.batch)
  if (!batch) return null
  const pct = batch.pagesTotal ? (batch.pagesDone / batch.pagesTotal) * 100 : 0
  return (
    <div className={cn('flex min-w-44 items-center gap-2 rounded-lg border px-2 py-1 text-xs', className)} role="status">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="whitespace-nowrap tabular-nums">{t('toolbar.progress', { done: batch.pagesDone, total: batch.pagesTotal })}</span>
        {showFile && batch.currentPath && <span className="truncate text-muted-foreground">{batch.currentPath}</span>}
        <Progress value={pct} className="h-1.5" />
      </div>
      <Button size="icon-xs" variant="ghost" onClick={cancelBatch} aria-label={t('toolbar.cancel')} title={t('toolbar.cancel')} disabled={batch.cancelled}>
        <X />
      </Button>
    </div>
  )
}
