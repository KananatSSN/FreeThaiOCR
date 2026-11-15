import { Languages, Moon, ScanText, Sun } from 'lucide-react'
import { setTheme, useTheme } from '@/hooks/useTheme'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { fileName, useActiveFile } from '@/state/store'
import { AboutDialog } from './AboutDialog'
import { AddFilesMenu } from './AddFilesMenu'

export function AppHeader() {
  const { t, i18n } = useTranslation()
  const theme = useTheme()
  const file = useActiveFile()
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3">
      <div className="flex items-center gap-2 font-semibold">
        <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <ScanText className="size-4" />
        </span>
        <span>{t('app.title')}</span>
      </div>
      {file && <span className="hidden max-w-[40ch] truncate text-sm text-muted-foreground md:inline">· {fileName(file)}</span>}
      <div className="ml-auto flex items-center gap-1">
        {file && <AddFilesMenu label />}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void i18n.changeLanguage(i18n.language.startsWith('th') ? 'en' : 'th')}
          aria-label={t('lang.toggle')}
        >
          <Languages /> <span className="hidden sm:inline">{t('lang.toggle')}</span>
        </Button>
        <Button size="icon-sm" variant="ghost" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={t('theme.toggle')} title={t('theme.toggle')}>
          {theme === 'dark' ? <Sun /> : <Moon />}
        </Button>
        <AboutDialog />
      </div>
    </header>
  )
}
