import { useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark'
const KEY = 'freethaiocr.theme'
const listeners = new Set<() => void>()
const media = window.matchMedia('(prefers-color-scheme: dark)')

function saved(): Theme | null {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : null
  } catch {
    return null
  }
}

const current = (): Theme => saved() ?? (media.matches ? 'dark' : 'light')

function apply() {
  document.documentElement.classList.toggle('dark', current() === 'dark')
  listeners.forEach((l) => l())
}
media.addEventListener('change', apply)

export function setTheme(t: Theme) {
  try {
    localStorage.setItem(KEY, t)
  } catch {
    /* not persisted in private mode; still applied for this visit */
    document.documentElement.classList.toggle('dark', t === 'dark')
    listeners.forEach((l) => l())
    return
  }
  apply()
}

/** Light/dark theme: the user's choice, else the system setting. */
export function useTheme(): Theme {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'),
  )
}
