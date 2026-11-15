import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

/** Copy text to the clipboard with a toast. */
export function useCopy() {
  const { t } = useTranslation()
  return async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(t('results.copied'), { duration: 1500 })
    } catch {
      toast.error('Clipboard unavailable')
    }
  }
}
