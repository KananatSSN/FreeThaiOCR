import { lazy, Suspense } from 'react'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AppHeader } from '@/components/AppHeader'
import { SupportFab } from '@/components/SupportFab'
import { UploadDropzone } from '@/components/UploadDropzone'
import { useApp } from '@/state/store'

// The viewer (Konva, pdf.js) loads with the first document, not with the landing page.
const Workspace = lazy(() => import('@/components/Workspace').then((m) => ({ default: m.Workspace })))

export default function App() {
  const hasDoc = useApp((s) => s.files.length > 0)
  return (
    <>
      <TooltipProvider delayDuration={400}>
        <div className="flex h-dvh flex-col bg-background text-foreground">
          <AppHeader />
          <main className="flex min-h-0 flex-1 flex-col overflow-auto">{hasDoc ? (
              <Suspense fallback={null}>
                <Workspace />
              </Suspense>
            ) : (
              <UploadDropzone />
            )}</main>
        </div>
        {/* On phones the workspace has a bottom bar; sit above it. */}
        <SupportFab className={hasDoc ? 'max-md:bottom-20' : undefined} />
        <Toaster position="bottom-center" richColors />
      </TooltipProvider>
    </>
  )
}
