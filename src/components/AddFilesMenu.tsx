import { FilePlus, FolderOpen, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useFilePickers } from '@/hooks/useFilePickers'

export function AddFilesMenu({ label = false }: { label?: boolean }) {
  const { t } = useTranslation()
  const { inputs, busy, pickFiles, pickFolder } = useFilePickers()
  return (
    <>
      {inputs}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size={label ? 'sm' : 'icon-sm'} variant="ghost" disabled={busy} aria-label={t('files.add')} title={t('files.add')}>
            <Plus /> {label && <span className="hidden sm:inline">{t('files.add')}</span>}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={pickFiles}>
            <FilePlus /> {t('files.pickFiles')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={pickFolder}>
            <FolderOpen /> {t('files.pickFolder')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
