import { Code, Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { LegalLinks } from './LegalPage'

const REPO_URL = import.meta.env.VITE_REPO_URL?.trim()

export function AboutDialog() {
  const { t } = useTranslation()
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label={t('about.button')} title={t('about.button')}>
          <Info />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('about.title')}</DialogTitle>
          <DialogDescription>{t('about.body')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-muted-foreground">{t('about.limits')}</p>
          <p>
            {t('about.model')}{' '}
            <a className="underline underline-offset-4" href="https://huggingface.co/iapp/OpenThai2.1-OCR-Text-20261118" target="_blank" rel="noopener noreferrer">
              Hugging Face
            </a>
          </p>
          <p>
            {t('about.akson')}{' '}
            <a className="underline underline-offset-4" href="https://huggingface.co/Remtir/AksonOCR-Lite" target="_blank" rel="noopener noreferrer">
              Hugging Face
            </a>
          </p>
          <p>{t('about.license')}</p>
          {REPO_URL && (
            <Button asChild variant="outline" className="self-start">
              <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
                <Code /> {t('about.source')}
              </a>
            </Button>
          )}
          <LegalLinks newTab className="border-t pt-3" />
        </div>
      </DialogContent>
    </Dialog>
  )
}
