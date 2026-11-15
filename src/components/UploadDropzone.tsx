import { Camera, FilePlus, FileUp, FolderOpen, Layers, Lock, ScanText, SquareDashedMousePointer } from 'lucide-react'
import { useRef } from 'react'
import { useDropzone } from 'react-dropzone'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useAddFiles } from '@/hooks/useAddFiles'
import { useFilePickers } from '@/hooks/useFilePickers'
import { cn } from 'cn'
import { LegalLinks } from './LegalPage'

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
  const features = [
    { icon: Lock, text: t('features.local') },
    { icon: SquareDashedMousePointer, text: t('features.box') },
    { icon: Layers, text: t('features.pdf') },
    { icon: FileUp, text: t('features.export') },
  ]
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:py-14">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">{t('app.tagline')}</h1>
        <p className="text-muted-foreground">{t('app.privacy')}</p>
      </div>
      <div
        {...getRootProps()}
        className={cn(
          'flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed bg-card p-10 text-center transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:p-14',
          isDragActive ? 'border-primary bg-primary/5' : 'hover:border-primary/50 hover:bg-muted/40',
          busy && 'pointer-events-none opacity-60',
        )}
      >
        <input {...getInputProps()} />
        <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <ScanText className="size-7" />
        </span>
        <p className="text-lg font-medium">{t('upload.title')}</p>
        <p className="text-sm text-muted-foreground">{t('upload.hint')}</p>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
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
      <div className="grid gap-2 sm:grid-cols-2">
        {features.map(({ icon: Icon, text }) => (
          <Card key={text} className="flex-row items-center gap-3 p-3 text-sm shadow-none">
            <Icon className="size-4 shrink-0 text-primary" /> {text}
          </Card>
        ))}
      </div>
      <LegalLinks className="justify-center pt-2" />
    </div>
  )
}
