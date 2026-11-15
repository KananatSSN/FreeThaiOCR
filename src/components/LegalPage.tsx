import { ArrowLeft } from 'lucide-react'
import { Fragment, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { type Block, LEGAL_PATHS, type LegalKind, type LegalVars, privacy, terms } from '@/legal/content'
import { cn } from 'cn'

const REPO_URL = import.meta.env.VITE_REPO_URL?.trim()
const CONTACT_EMAIL = import.meta.env.VITE_CONTACT_EMAIL?.trim()
const OPERATOR = import.meta.env.VITE_OPERATOR_NAME?.trim()

function legalVars(lang: 'th' | 'en'): LegalVars {
  const operator = OPERATOR || (lang === 'th' ? 'ผู้ดูแลโครงการ FreeThaiOCR' : 'the FreeThaiOCR maintainer')
  const contact = CONTACT_EMAIL
    ? `[${CONTACT_EMAIL}](mailto:${CONTACT_EMAIL})`
    : REPO_URL
      ? lang === 'th'
        ? `[หน้า Issues ของโครงการบน GitHub](${REPO_URL}/issues)`
        : `[the project’s GitHub issues page](${REPO_URL}/issues)`
      : lang === 'th'
        ? 'ช่องทางที่ระบุในซอร์สโค้ดของโครงการ'
        : 'the contact listed in the project’s source repository'
  return { operator, contact, repoUrl: REPO_URL }
}

/** Minimal inline markup: **bold** and [text](url). Text is never parsed as HTML. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g
  let last = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index))
    if (m[1]) out.push(<strong key={m.index} className="font-medium text-foreground">{m[1]}</strong>)
    else {
      const href = m[3]
      const external = /^https?:/.test(href)
      out.push(
        <a key={m.index} href={href} className="underline underline-offset-4 hover:text-foreground" {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
          {m[2]}
        </a>,
      )
    }
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function BlockView({ block }: { block: Block }) {
  if (typeof block === 'string') return <p>{inline(block)}</p>
  return (
    <ul className="list-disc space-y-1 pl-5">
      {block.list.map((item, i) => (
        <li key={i}>{inline(item)}</li>
      ))}
    </ul>
  )
}

/** /privacy and /terms: a readable document page in the app's current language. */
export function LegalPage({ kind }: { kind: LegalKind }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language.startsWith('th') ? 'th' : 'en'
  const doc = (kind === 'privacy' ? privacy : terms)(lang, legalVars(lang))
  const tabs: [LegalKind, string][] = [
    ['privacy', t('legal.privacy')],
    ['terms', t('legal.terms')],
  ]
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:py-12">
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <a href="/">
            <ArrowLeft /> {t('legal.back')}
          </a>
        </Button>
        <nav className="ml-auto flex gap-1 text-sm" aria-label={t('legal.nav')}>
          {tabs.map(([k, label]) => (
            <a key={k} href={LEGAL_PATHS[k]} aria-current={k === kind ? 'page' : undefined} className={cn('rounded-md px-2.5 py-1', k === kind ? 'bg-muted font-medium' : 'text-muted-foreground hover:text-foreground')}>
              {label}
            </a>
          ))}
          <a href="/licenses.txt" className="rounded-md px-2.5 py-1 text-muted-foreground hover:text-foreground">
            {t('legal.licenses')}
          </a>
        </nav>
      </div>
      <article className="thai-text space-y-6 leading-relaxed">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{doc.title}</h1>
          <p className="text-sm text-muted-foreground">{doc.updated}</p>
        </header>
        {doc.intro && <p className="rounded-lg border bg-muted/40 p-4">{inline(doc.intro)}</p>}
        {doc.sections.map((s) => (
          <section key={s.heading} className="space-y-2">
            <h2 className="text-lg font-medium">{s.heading}</h2>
            <div className="space-y-2 text-muted-foreground">
              {s.body.map((b, i) => (
                <Fragment key={i}>
                  <BlockView block={b} />
                </Fragment>
              ))}
            </div>
          </section>
        ))}
      </article>
    </div>
  )
}

/** Small footer links (landing page and About). Opens in a new tab so work in progress isn't lost. */
export function LegalLinks({ className, newTab = false }: { className?: string; newTab?: boolean }) {
  const { t } = useTranslation()
  const target = newTab ? { target: '_blank', rel: 'noopener' } : {}
  return (
    <nav className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground', className)} aria-label={t('legal.nav')}>
      <a href={LEGAL_PATHS.privacy} className="hover:text-foreground hover:underline" {...target}>
        {t('legal.privacy')}
      </a>
      <a href={LEGAL_PATHS.terms} className="hover:text-foreground hover:underline" {...target}>
        {t('legal.terms')}
      </a>
      <a href="/licenses.txt" className="hover:text-foreground hover:underline" {...target}>
        {t('legal.licenses')}
      </a>
    </nav>
  )
}
