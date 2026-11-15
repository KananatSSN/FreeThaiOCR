import generatePayload from 'promptpay-qr'
import QRCode from 'qrcode'
import { Coffee, Download, ExternalLink } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

/** The maintainer's own QR card from private/ (see vite.config.ts). */
const QR_IMAGE = import.meta.env.VITE_PROMPTPAY_QR?.trim()
const PROMPTPAY_ID = import.meta.env.VITE_PROMPTPAY_ID?.trim()
const DONATE_URL = import.meta.env.VITE_DONATE_URL?.trim()
const AMOUNTS = ['', '50', '100', '300']

export const donationsEnabled = !!(QR_IMAGE || PROMPTPAY_ID || DONATE_URL)

/** The bank's QR card image, with a save button (phones can't scan their own screen). */
function QrCard() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center gap-3">
      <img src={QR_IMAGE} alt={t('donate.promptpay')} className="max-h-[52dvh] w-auto rounded-xl border bg-white object-contain" />
      <Button asChild variant="outline" size="sm">
        <a href={QR_IMAGE} download="ThaiOCR-PromptPay.jpg">
          <Download /> {t('donate.save')}
        </a>
      </Button>
      <p className="text-center text-xs text-muted-foreground">{t('donate.saveHint')}</p>
    </div>
  )
}

/** Fallback when only a PromptPay ID is configured: a QR generated in the browser. */
function GeneratedQr() {
  const { t } = useTranslation()
  const [amount, setAmount] = useState('')
  const [src, setSrc] = useState('')
  useEffect(() => {
    if (!PROMPTPAY_ID) return
    const payload = generatePayload(PROMPTPAY_ID, amount ? { amount: Number(amount) } : {})
    QRCode.toDataURL(payload, { margin: 1, width: 480, errorCorrectionLevel: 'M' }).then(setSrc, () => setSrc(''))
  }, [amount])
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border p-4">
      <p className="text-sm font-medium">{t('donate.promptpay')}</p>
      {src ? <img src={src} alt="PromptPay QR" className="size-52 rounded-lg bg-white p-2" /> : <div className="size-52" />}
      <div className="flex flex-col items-center gap-1.5">
        <Label className="text-xs text-muted-foreground">{t('donate.amount')}</Label>
        <ToggleGroup type="single" variant="outline" size="sm" value={amount} onValueChange={(v) => setAmount(v ?? '')}>
          {AMOUNTS.map((a) => (
            <ToggleGroupItem key={a || 'any'} value={a} className="min-w-12">
              {a ? `฿${a}` : '—'}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
    </div>
  )
}

export function DonateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94dvh] overflow-y-auto sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('donate.title')}</DialogTitle>
          <DialogDescription>{t('donate.body')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {QR_IMAGE ? <QrCard /> : PROMPTPAY_ID && <GeneratedQr />}
          {DONATE_URL && (
            <Button asChild variant="outline" className="h-auto justify-start py-2.5">
              <a href={DONATE_URL} target="_blank" rel="noopener noreferrer">
                <Coffee />
                <span className="flex flex-col items-start">
                  <span>{t('donate.kofi')}</span>
                  <span className="text-xs font-normal text-muted-foreground">{t('donate.kofiHint')}</span>
                </span>
                <ExternalLink className="ml-auto opacity-60" />
              </a>
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
