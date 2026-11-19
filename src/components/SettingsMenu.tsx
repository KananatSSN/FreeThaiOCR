import { Settings2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useApp } from '@/state/store'

const hasWebGpu = typeof navigator !== 'undefined' && 'gpu' in navigator

/** Toolbar settings: the GPU switch. (Engines are chosen by the results panel's tabs.) */
export function SettingsMenu() {
  const { t } = useTranslation()
  const backend = useApp((s) => s.backend)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label={t('settings.title')}>
          <Settings2 />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuCheckboxItem checked={backend === 'webgpu'} disabled={!hasWebGpu} onCheckedChange={(on) => useApp.getState().setBackend(on ? 'webgpu' : 'wasm')}>
          {t('engine.gpu')}
        </DropdownMenuCheckboxItem>
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{hasWebGpu ? t('engine.gpuHint') : t('engine.gpuUnavailable')}</DropdownMenuLabel>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
