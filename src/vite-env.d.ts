/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** PromptPay ID (phone, national ID or e-wallet ID) for the donation QR; hidden when unset. */
  readonly VITE_PROMPTPAY_ID?: string
  /** URL of the donation QR image, set at build time from private/promptpay_qr.* (see vite.config.ts). */
  readonly VITE_PROMPTPAY_QR?: string
  /** Ko-fi / Buy Me a Coffee page URL; hidden when unset. */
  readonly VITE_DONATE_URL?: string
  /** Public source repository URL shown in the About dialog. */
  readonly VITE_REPO_URL?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
