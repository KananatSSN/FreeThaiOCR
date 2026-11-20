/** The maintainer's contact details, from .env at build time; forks show nothing unless they set their own. */
export const EMAIL = import.meta.env.VITE_HIRE_EMAIL?.trim()
export const PHONE = import.meta.env.VITE_HIRE_PHONE?.trim()
export const GITHUB = import.meta.env.VITE_HIRE_GITHUB?.trim()
export const WEBSITE = import.meta.env.VITE_HIRE_WEBSITE?.trim()

export const hireEnabled = !!(EMAIL || PHONE || GITHUB || WEBSITE)
/** With only a website set (e.g. a page with your CV and contacts), the menu item links straight to it. */
export const hireDirectUrl = WEBSITE && !(EMAIL || PHONE || GITHUB) ? WEBSITE : undefined
