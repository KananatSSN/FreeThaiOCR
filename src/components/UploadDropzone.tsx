import { Camera, FilePlus, FileUp, FolderOpen, Layers, Lock, ScanText } from 'lucide-react'
import { useRef } from 'react'
import { useDropzone } from 'react-dropzone'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useAddFiles } from '@/hooks/useAddFiles'
import { useFilePickers } from '@/hooks/useFilePickers'
import { cn } from 'cn'
import { LegalLinks } from './LegalPage'

const FEATURES = [
  { key: 'local', icon: Lock },
  { key: 'auto', icon: ScanText },
  { key: 'pdf', icon: Layers },
  { key: 'export', icon: FileUp },
] as const

/**
 * Landing page, laid out to fit the screen without scrolling: a full-height column
 * where the drop area takes up the room left over (within limits) and spacing
 * scales with the screen's height. On very small screens the page still scrolls
 * rather than clipping anything.
 */
export function UploadDropzone() {
  const { t } = useTranslation()
  const { add, busy } = useAddFiles()
  const pickers = useFilePickers()
  const camera = useRef<HTMLInputElement>(null)
  // No `accept` filter: dropped folders contain all sorts of files, and
  // addFiles() skips unsupported ones with a count instead of rejecting the drop.
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    multiple: true,
    disabled: busy,
    noClick: true,
    onDrop: (files) => void add(files),
  })
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-4 pt-[clamp(1rem,4dvh,3rem)] pb-3">
      <div className="flex flex-1 flex-col justify-center gap-[clamp(1rem,3dvh,2rem)]">
        <div className="flex flex-col items-center gap-1.5 text-center">
          <h1 className="text-xl font-semibold tracking-tight text-balance sm:text-3xl">{t('app.tagline')}</h1>
          <p className="text-sm text-muted-foreground sm:text-base">{t('app.privacy')}</p>
        </div>

        <div
          {...getRootProps()}
          className={cn(
            'flex min-h-52 flex-1 flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed bg-card p-5 text-center transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:max-h-96 sm:min-h-60 sm:p-8',
            isDragActive ? 'border-primary bg-primary/5' : 'hover:border-primary/50 hover:bg-muted/40',
            busy && 'pointer-events-none opacity-60',
          )}
        >
          <input {...getInputProps()} />
          {/* The icon gives way first when height is short. */}
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary sm:size-14 [@media(max-height:700px)]:hidden">
            <ScanText className="size-6 sm:size-7" />
          </span>
          <div className="flex flex-col gap-1">
            <p className="text-base font-medium text-balance sm:text-lg">{t('upload.title')}</p>
            <p className="text-sm text-muted-foreground">{t('upload.hint')}</p>
          </div>
          <div className="mt-1 flex flex-wrap justify-center gap-2">
            {pickers.inputs}
            <Button onClick={pickers.pickFiles} disabled={busy}>
              <FilePlus /> {t('files.pickFiles')}
            </Button>
            <Button variant="outline" onClick={pickers.pickFolder} disabled={busy}>
              <FolderOpen /> {t('files.pickFolder')}
            </Button>
            <input ref={camera} type="file" hidden accept="image/*" capture="environment" onChange={(e) => void add(e.target.files)} />
            <Button variant="outline" className="sm:hidden" onClick={() => camera.current?.click()} disabled={busy}>
              <Camera /> {t('upload.camera')}
            </Button>
          </div>
        </div>

        <ul className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {FEATURES.map(({ key, icon: Icon }) => (
            <li key={key} className="flex items-start gap-2.5 rounded-xl border bg-card p-3">
              <Icon className="mt-0.5 size-4 shrink-0 text-primary" />
              <div className="min-w-0">
                <p className="text-sm font-medium">{t(`features.${key}.title`)}</p>
                <p className="text-xs leading-snug text-muted-foreground [@media(max-height:720px)]:max-sm:hidden">{t(`features.${key}.desc`)}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Bottom row; on phones it stays left of the round support button. */}
      <LegalLinks className="shrink-0 justify-center pt-[clamp(0.75rem,2.5dvh,1.5rem)] max-sm:justify-start max-sm:pr-20 sm:pb-1" />
    </div>
  )
}
