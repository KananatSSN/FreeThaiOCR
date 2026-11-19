import { Settings2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { documentModeCapable } from '@/lib/device'
import type { EngineModel } from '@/ocr/worker'
import { useApp } from '@/state/store'

const hasWebGpu = typeof navigator !== 'undefined' && 'gpu' in navigator

type Pending = { kind: 'akson' } | { kind: 'document' } | null

/** Toolbar settings: OCR engine, Akson document mode, GPU. Big downloads are confirmed first. */
export function SettingsMenu() {
  const { t } = useTranslation()
  const backend = useApp((s) => s.backend)
  const engineModel = useApp((s) => s.engineModel)
  const documentMode = useApp((s) => s.documentMode)
  const [pending, setPending] = useState<Pending>(null)
  const capable = documentModeCapable(backend)

  const chooseEngine = (m: EngineModel) => {
    if (m === engineModel) return
    if (m === 'akson') setPending({ kind: 'akson' })
    else useApp.getState().setEngineModel('openthai')
  }
  const confirm = () => {
    if (pending?.kind === 'akson') useApp.getState().setEngineModel('akson')
    if (pending?.kind === 'document') useApp.getState().setDocumentMode(true)
    setPending(null)
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="ghost" aria-label={t('settings.title')}>
            <Settings2 />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel>{t('settings.engine')}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={engineModel} onValueChange={(v) => chooseEngine(v as EngineModel)}>
            <DropdownMenuRadioItem value="openthai" className="items-start">
              <span className="flex flex-col">
                <span>{t('settings.openthai')}</span>
                <span className="text-xs text-muted-foreground">{t('settings.openthaiHint')}</span>
              </span>
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="akson" className="items-start">
              <span className="flex flex-col">
                <span>{t('settings.akson')}</span>
                <span className="text-xs text-muted-foreground">{t('settings.aksonHint')}</span>
              </span>
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuCheckboxItem
            checked={engineModel === 'akson' && documentMode && capable}
            disabled={engineModel !== 'akson' || !capable}
            onCheckedChange={(on) => (on ? setPending({ kind: 'document' }) : useApp.getState().setDocumentMode(false))}
          >
            {t('settings.document')}
          </DropdownMenuCheckboxItem>
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            {!capable ? t('settings.documentUnavailable') : engineModel !== 'akson' ? t('settings.documentNeedsAkson') : t('settings.documentHint')}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem checked={backend === 'webgpu'} disabled={!hasWebGpu} onCheckedChange={(on) => useApp.getState().setBackend(on ? 'webgpu' : 'wasm')}>
            {t('engine.gpu')}
          </DropdownMenuCheckboxItem>
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{hasWebGpu ? t('engine.gpuHint') : t('engine.gpuUnavailable')}</DropdownMenuLabel>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pending?.kind === 'document' ? t('settings.confirmDocumentTitle') : t('settings.confirmAksonTitle')}</DialogTitle>
            <DialogDescription>{pending?.kind === 'document' ? t('settings.confirmDocument') : t('settings.confirmAkson')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)}>
              {t('settings.cancel')}
            </Button>
            <Button onClick={confirm}>{t('settings.confirm')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
