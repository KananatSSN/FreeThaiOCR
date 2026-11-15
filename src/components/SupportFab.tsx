import { HandHeart, MessageCircleHeart, X } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from 'cn'
import { DonateDialog, donationsEnabled } from './DonateDialog'

const REPO_URL = import.meta.env.VITE_REPO_URL?.trim()
const MODEL_URL = 'https://huggingface.co/iapp/OpenThai2.0-OCR-Text'
const RADIUS = 96 // px from the button's centre to each item's centre

function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={className} fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  )
}

interface Item {
  key: string
  label: string
  icon: ReactNode
  href?: string
  onSelect?: () => void
}

/**
 * Floating button (bottom right) that opens a wheel of links: support the
 * developer, the GitHub repo and the OpenThai model on Hugging Face.
 */
export function SupportFab({ className }: { className?: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [donate, setDonate] = useState(false)
  // Labels appear once the items finish sliding out: tooltips are positioned
  // when they open and don't follow CSS transform animations.
  const [labels, setLabels] = useState(false)
  useEffect(() => {
    if (!open) return
    const id = setTimeout(() => setLabels(true), 260)
    return () => {
      clearTimeout(id)
      setLabels(false)
    }
  }, [open])
  const root = useRef<HTMLDivElement>(null)

  const items: Item[] = []
  if (donationsEnabled) items.push({ key: 'donate', label: t('fab.donate'), icon: <HandHeart className="size-5 text-rose-600 dark:text-rose-400" />, onSelect: () => setDonate(true) })
  if (REPO_URL) items.push({ key: 'github', label: t('fab.github'), icon: <GitHubMark className="size-5" />, href: REPO_URL })
  items.push({ key: 'model', label: t('fab.model'), icon: <span className="text-xl leading-none" aria-hidden="true">🤗</span>, href: MODEL_URL })

  // Close on Escape or a click/tap anywhere outside the wheel.
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

  // Spread items over a quarter circle, from straight up (90°) to straight left (180°).
  const angleOf = (i: number) => (items.length === 1 ? 135 : 90 + (i * 90) / (items.length - 1))

  return (
    <>
      <div ref={root} className={cn('fixed right-4 bottom-4 z-40 size-14', className)}>
        {items.map((item, i) => {
          const a = (angleOf(i) * Math.PI) / 180
          const x = Math.cos(a) * RADIUS
          const y = -Math.sin(a) * RADIUS
          const itemClass = cn(
            'absolute top-1 left-1 flex size-12 items-center justify-center rounded-full border bg-background shadow-lg outline-none transition-all duration-200 ease-out hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50',
            !open && 'pointer-events-none opacity-0',
          )
          const style = {
            transform: open ? `translate(${x}px, ${y}px) scale(1)` : 'translate(0, 0) scale(0.4)',
            transitionDelay: open ? `${i * 40}ms` : '0ms',
          }
          const common = { className: itemClass, style, 'aria-label': item.label, tabIndex: open ? 0 : -1, 'aria-hidden': !open }
          return (
            // Labels show whenever the wheel is open (touch screens have no hover).
            <Tooltip key={item.key} open={labels}>
              <TooltipTrigger asChild>
                {item.href ? (
                  <a {...common} href={item.href} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}>
                    {item.icon}
                  </a>
                ) : (
                  <button
                    {...common}
                    type="button"
                    onClick={() => {
                      setOpen(false)
                      item.onSelect?.()
                    }}
                  >
                    {item.icon}
                  </button>
                )}
              </TooltipTrigger>
              <TooltipContent side={angleOf(i) < 112.5 ? 'top' : 'left'} className="pointer-events-none">
                {item.label}
              </TooltipContent>
            </Tooltip>
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
          <MessageCircleHeart className={cn('absolute size-6 transition-all duration-200', open ? 'scale-50 rotate-90 opacity-0' : 'opacity-100')} />
          <X className={cn('absolute size-6 transition-all duration-200', open ? 'opacity-100' : 'scale-50 -rotate-90 opacity-0')} />
        </button>
      </div>
      <DonateDialog open={donate} onOpenChange={setDonate} />
    </>
  )
}
