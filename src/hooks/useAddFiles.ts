import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

/** Add picked/dropped files and report what was added or skipped. */
export function useAddFiles() {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const add = async (files: File[] | FileList | null | undefined) => {
    const list = files ? Array.from(files) : []
    if (!list.length) return
    setBusy(true)
    try {
      // pdf.js and the OCR client load only once files are chosen.
      const { addFiles } = await import('@/lib/ocrService')
      const r = addFiles(list)
      if (!r.added) {
        toast.error(r.duplicates ? t('files.allDuplicates') : t('upload.unsupported'))
      } else if (r.skipped || r.duplicates || r.added > 1) {
        const parts = [t('files.added', { count: r.added })]
        if (r.skipped) parts.push(t('files.skipped', { count: r.skipped }))
        if (r.duplicates) parts.push(t('files.duplicates', { count: r.duplicates }))
        toast(parts.join(' · '))
      }
    } catch (e) {
      toast.error(t('upload.failed', { error: e instanceof Error ? e.message : String(e) }))
    } finally {
      setBusy(false)
    }
  }
  return { add, busy }
}
