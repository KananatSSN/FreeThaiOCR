import { AlertCircle, Loader2, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { ensureEngine } from '@/lib/ocrService'
import { useApp } from '@/state/store'

/** Floating notice while the OCR runtime downloads (first use) or if it failed. */
export function EngineStatus() {
  const { t } = useTranslation()
  const engine = useApp((s) => s.engine)
  const stage = useApp((s) => s.engineStage)
  const error = useApp((s) => s.engineError)
  if (engine === 'loading') {
    return (
      <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center px-3">
        <div className="flex max-w-md items-start gap-3 rounded-xl border bg-background/95 px-4 py-3 text-sm shadow-lg backdrop-blur">
          <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" />
          <div>
            <p className="font-medium">{stage === 'models' ? t('engine.models') : t('engine.runtime')}</p>
            <p className="text-xs text-muted-foreground">{t('engine.firstTime')}</p>
          </div>
        </div>
      </div>
    )
  }
  if (engine === 'error') {
    return (
      <div className="absolute inset-x-0 top-3 z-10 flex justify-center px-3">
        <div className="flex max-w-md items-start gap-3 rounded-xl border border-destructive/40 bg-background px-4 py-3 text-sm shadow-lg">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <p className="flex-1">{t('engine.error', { error })}</p>
          <Button size="sm" variant="outline" onClick={() => void ensureEngine().catch(() => {})}>
            <RotateCcw />
          </Button>
        </div>
      </div>
    )
  }
  return null
}
