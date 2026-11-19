// Whether this device should be offered AksonOCR-Lite's document mode (layout + tables: +112 MB
// download, up to ~0.9 GB of memory on the CPU path). With the GPU switched on, most of that stays
// off the CPU heap; otherwise we want a computer (8 GB reported, or a fine pointer when unknown).
import type { Backend } from '@/ocr/worker'

export function documentModeCapable(backend: Backend): boolean {
  if (typeof navigator === 'undefined') return false
  if (backend === 'webgpu' && 'gpu' in navigator) return true
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  if (mem !== undefined) return mem >= 8
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches
  return !coarse
}
