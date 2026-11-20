import { ExternalLink, Globe, Mail, Phone } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EMAIL, GITHUB, PHONE, WEBSITE } from '@/lib/hire'
import { GitHubMark } from './GitHubMark'

/** A URL shown without its scheme and trailing slash: https://github.com/me/ → github.com/me */
const bare = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '')

interface Contact {
  key: string
  label: string
  value: string
  href: string
  icon: ReactNode
  external?: boolean
}

export function HireDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation()
  const contacts: Contact[] = []
  if (EMAIL) contacts.push({ key: 'email', label: t('hire.email'), value: EMAIL, href: `mailto:${EMAIL}`, icon: <Mail /> })
  if (PHONE) contacts.push({ key: 'phone', label: t('hire.phone'), value: PHONE, href: `tel:${PHONE.replace(/[^\d+]/g, '')}`, icon: <Phone /> })
  if (GITHUB) contacts.push({ key: 'github', label: t('hire.github'), value: bare(GITHUB), href: GITHUB, icon: <GitHubMark className="size-4" />, external: true })
  if (WEBSITE) contacts.push({ key: 'website', label: t('hire.website'), value: bare(WEBSITE), href: WEBSITE, icon: <Globe />, external: true })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94dvh] overflow-y-auto sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('hire.title')}</DialogTitle>
          <DialogDescription>{t('hire.body')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {contacts.map((c) => (
            <Button key={c.key} asChild variant="outline" className="h-auto justify-start py-2.5">
              <a href={c.href} {...(c.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
                {c.icon}
                <span className="flex min-w-0 flex-col items-start">
                  <span>{c.label}</span>
                  {/* Shown as text too, so desktop visitors without a mail or phone app can copy it. */}
                  <span className="max-w-full truncate text-xs font-normal text-muted-foreground select-all">{c.value}</span>
                </span>
                {c.external && <ExternalLink className="ml-auto opacity-60" />}
              </a>
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
