/**
 * A link as an absolute URL: "dr-kana.com" or "//dr-kana.com" becomes "https://dr-kana.com".
 * Without a scheme the browser would treat it as a path on this site.
 */
export function withScheme(url: string | undefined): string | undefined {
  const v = url?.trim()
  if (!v) return undefined
  if (/^https?:\/\//i.test(v)) return v
  return `https://${v.replace(/^\/+/, '')}`
}

/** The maintainer's contact details, from .env at build time; forks show nothing unless they set their own. */
export const EMAIL = import.meta.env.VITE_HIRE_EMAIL?.trim()
export const PHONE = import.meta.env.VITE_HIRE_PHONE?.trim()
export const GITHUB = withScheme(import.meta.env.VITE_HIRE_GITHUB)
export const WEBSITE = withScheme(import.meta.env.VITE_HIRE_WEBSITE)

export const hireEnabled = !!(EMAIL || PHONE || GITHUB || WEBSITE)
/** With only a website set (e.g. a page with your CV and contacts), the menu item links straight to it. */
export const hireDirectUrl = WEBSITE && !(EMAIL || PHONE || GITHUB) ? WEBSITE : undefined
