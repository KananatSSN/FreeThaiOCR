import { BriefcaseBusiness, HandHeart, MessageCircleHeart, X } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from 'cn'
import { DonateDialog, donationsEnabled } from './DonateDialog'
import { GitHubMark } from './GitHubMark'
import { hireDirectUrl, hireEnabled } from '@/lib/hire'
import { HireDialog } from './HireDialog'

const REPO_URL = import.meta.env.VITE_REPO_URL?.trim()
const MODEL_URL = 'https://huggingface.co/iapp/OpenThai2.1-OCR-Text-20261118'
const AKSON_URL = 'https://huggingface.co/Remtir/AksonOCR-Lite'
// Layout: the items stand in one column straight above the round button, evenly
// spaced, each with its label to its left at the same distance. Sizes in px.
const FAB = 56 // the round button
const ITEM = 48 // each item
const GAP = 12 // between neighbouring items, and between the button and the first item
/** Distance the k-th item from the bottom (k = 0 nearest the button) rises above it. */
const rise = (k: number) => FAB / 2 + GAP + ITEM / 2 + k * (ITEM + GAP)

// Motion: items rise out of the button with a soft spring, nearest first, and
// tuck back in quicker, in reverse order. Labels fade in once their item has
// almost settled. Durations in ms.
const OPEN_MS = 380
const CLOSE_MS = 200
const STAGGER_OPEN = 40
const STAGGER_CLOSE = 25
const LABEL_DELAY = 160
const SPRING = 'cubic-bezier(0.34, 1.36, 0.64, 1)' // slight overshoot, settles softly
const TUCK = 'cubic-bezier(0.4, 0, 1, 1)' // accelerate away

const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

interface Item {
  key: string
  label: string
  icon: ReactNode
  href?: string
  onSelect?: () => void
}

function useItems(setDonate: (open: boolean) => void, setHire: (open: boolean) => void): Item[] {
  const { t } = useTranslation()
  const items: Item[] = []
  // Top of the column, so it is the first thing read when the menu opens.
  if (hireEnabled) items.push({ key: 'hire', label: t('fab.hire'), icon: <BriefcaseBusiness className="size-5 text-sky-600 dark:text-sky-400" />, ...(hireDirectUrl ? { href: hireDirectUrl } : { onSelect: () => setHire(true) }) })
  if (donationsEnabled) items.push({ key: 'donate', label: t('fab.donate'), icon: <HandHeart className="size-5 text-rose-600 dark:text-rose-400" />, onSelect: () => setDonate(true) })
  if (REPO_URL) items.push({ key: 'github', label: t('fab.github'), icon: <GitHubMark className="size-5" />, href: REPO_URL })
  items.push({ key: 'model', label: t('fab.model'), icon: <span className="text-xl leading-none" aria-hidden="true">🤗</span>, href: MODEL_URL })
  items.push({ key: 'akson', label: t('fab.aksonModel'), icon: <span className="text-sm font-bold leading-none" aria-hidden="true">Ak</span>, href: AKSON_URL })
  return items
}

/**
 * Floating button (bottom right) that opens a column of links: support the
 * developer, contact the developer about work, the GitHub repo and the OpenThai and AksonOCR-Lite models on Hugging Face.
 */
export function SupportFab({ className }: { className?: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [donate, setDonate] = useState(false)
  const [hire, setHire] = useState(false)
  const items = useItems(setDonate, setHire)
  const reduced = prefersReducedMotion()
  const root = useRef<HTMLDivElement>(null)

  // Close on Escape or a click/tap anywhere outside the menu.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown)
    }
  }, [open])

  return (
    <>
      <div ref={root} className={cn('fixed right-4 bottom-4 z-40 size-14', className)}>
        {items.map((item, i) => {
          const k = items.length - 1 - i // 0 = nearest the button
          const placed = `translateY(${-rise(k)}px) scale(1)`
          const tucked = reduced ? placed : 'translateY(0px) scale(0.3)'
          const delay = reduced ? 0 : open ? k * STAGGER_OPEN : (items.length - 1 - k) * STAGGER_CLOSE
          const itemClass = cn(
            'absolute top-1 left-1 flex size-12 items-center justify-center rounded-full border bg-background shadow-lg outline-none will-change-[transform,opacity] hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50',
            !open && 'pointer-events-none',
          )
          const style = {
            transform: open ? placed : tucked,
            opacity: open ? 1 : 0,
            transition: open
              ? `transform ${OPEN_MS}ms ${SPRING} ${delay}ms, opacity 160ms ease-out ${delay}ms`
              : `transform ${CLOSE_MS}ms ${TUCK} ${delay}ms, opacity 140ms ease-in ${delay + 40}ms`,
          }
          // The label is part of the item, so it moves with it and its spacing never varies;
          // it is also part of the tap target. Shown whenever open (touch screens have no hover).
          // mr-[13px]: measured from inside the item's 1 px border, so the visible gap is GAP (12 px).
          const label = (
            <span
              aria-hidden="true"
              data-fab-label=""
              className="absolute top-1/2 right-full mr-[13px] flex -translate-y-1/2 items-center rounded-md bg-foreground px-3 py-1.5 text-xs whitespace-nowrap text-background shadow-md"
              style={{
                opacity: open ? 1 : 0,
                transition: open ? `opacity 180ms ease-out ${reduced ? 0 : delay + LABEL_DELAY}ms` : 'opacity 80ms ease-in',
              }}
            >
              {item.label}
              <span className="absolute top-1/2 -right-1 size-2.5 -translate-y-1/2 rotate-45 rounded-[2px] bg-foreground" />
            </span>
          )
          const common = { className: itemClass, style, 'aria-label': item.label, tabIndex: open ? 0 : -1, 'aria-hidden': !open }
          return item.href ? (
            <a key={item.key} {...common} href={item.href} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}>
              {item.icon}
              {label}
            </a>
          ) : (
            <button
              key={item.key}
              {...common}
              type="button"
              onClick={() => {
                setOpen(false)
                item.onSelect?.()
              }}
            >
              {item.icon}
              {label}
            </button>
          )
        })}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? t('fab.close') : t('fab.open')}
          title={open ? undefined : t('fab.open')}
          className="relative flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xl outline-none transition-transform hover:scale-105 focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-95"
        >
          <MessageCircleHeart className={cn('absolute size-6 transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.34,1.36,0.64,1)] motion-reduce:transition-opacity', open ? 'scale-50 rotate-90 opacity-0' : 'opacity-100')} />
          <X className={cn('absolute size-6 transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.34,1.36,0.64,1)] motion-reduce:transition-opacity', open ? 'opacity-100' : 'scale-50 -rotate-90 opacity-0')} />
        </button>
      </div>
      <DonateDialog open={donate} onOpenChange={setDonate} />
      <HireDialog open={hire} onOpenChange={setHire} />
    </>
  )
}
