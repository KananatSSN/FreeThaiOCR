import { CheckCheck, Pause, Play } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { setAutoPaused } from '@/lib/ocrService'
import { useApp } from '@/state/store'
import { cn } from 'cn'

/** OpenThai's background reading over all files: progress, with Stop and Resume. */
export function AutoProgress({ className }: { className?: string }) {
  const { t } = useTranslation()
  const paused = useApp((s) => s.autoPaused)
  const [done, total, loading] = useApp(
    useShallow((s) => {
      let done = 0
      let total = 0
      for (const f of s.files) {
        if (f.status !== 'ready') continue
        total += f.pages.length
        done += f.pages.filter((p) => p.status === 'done' || p.status === 'error').length
      }
      return [done, total, s.files.some((f) => f.status === 'loading')]
    }),
  )
  if (!total) return null
  if (done >= total && !loading) {
    return (
      <span className={cn('flex items-center gap-1.5 px-2 text-xs text-emerald-700 dark:text-emerald-400', className)} role="status">
        <CheckCheck className="size-4" /> <span className="hidden sm:inline">{t('auto.allDone')}</span>
      </span>
    )
  }
  return (
    <div className={cn('flex min-w-40 items-center gap-2 rounded-lg border px-2 py-1 text-xs', className)} role="status">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="whitespace-nowrap tabular-nums">{t(paused ? 'auto.paused' : 'auto.progress', { done, total })}</span>
        <Progress value={(done / total) * 100} className="h-1.5" />
      </div>
      {paused ? (
        <Button size="xs" variant="ghost" onClick={() => setAutoPaused(false)}>
          <Play /> {t('auto.resume')}
        </Button>
      ) : (
        <Button size="xs" variant="ghost" onClick={() => setAutoPaused(true)}>
          <Pause /> {t('auto.stop')}
        </Button>
      )}
    </div>
  )
}
