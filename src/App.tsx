import { lazy, Suspense } from 'react'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AppHeader } from '@/components/AppHeader'
import { LegalPage } from '@/components/LegalPage'
import type { LegalKind } from '@/legal/content'
import { SupportFab } from '@/components/SupportFab'
import { UploadDropzone } from '@/components/UploadDropzone'
import { useApp } from '@/state/store'

// The viewer (Konva, pdf.js) loads with the first document, not with the landing page.
const Workspace = lazy(() => import('@/components/Workspace').then((m) => ({ default: m.Workspace })))

/** /privacy and /terms are plain pages; everything else is the app. */
const legalKind: LegalKind | null = location.pathname === '/privacy' ? 'privacy' : location.pathname === '/terms' ? 'terms' : null

export default function App() {
  const hasDoc = useApp((s) => s.files.length > 0)
  return (
    <>
      <TooltipProvider delayDuration={400}>
        <div className="flex h-dvh flex-col bg-background text-foreground">
          <AppHeader />
          <main className="flex min-h-0 flex-1 flex-col overflow-auto">{legalKind ? (
              <LegalPage kind={legalKind} />
            ) : hasDoc ? (
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
