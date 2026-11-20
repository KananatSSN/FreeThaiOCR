/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** PromptPay ID (phone, national ID or e-wallet ID) for the donation QR; hidden when unset. */
  readonly VITE_PROMPTPAY_ID?: string
  /** URL of the donation QR image, set at build time from private/promptpay_qr.* (see vite.config.ts). */
  readonly VITE_PROMPTPAY_QR?: string
  /** Ko-fi / Buy Me a Coffee page URL; hidden when unset. */
  readonly VITE_DONATE_URL?: string
  /** Operator named in the privacy policy and terms; defaults to "the FreeThaiOCR maintainer". */
  readonly VITE_OPERATOR_NAME?: string
  /** Contact e-mail for the privacy policy and terms; defaults to the repo's GitHub issues page. */
  readonly VITE_CONTACT_EMAIL?: string
  /** The maintainer's contact details for the "open to work" card in the support menu; hidden when all are unset. */
  readonly VITE_HIRE_EMAIL?: string
  readonly VITE_HIRE_PHONE?: string
  readonly VITE_HIRE_GITHUB?: string
  readonly VITE_HIRE_WEBSITE?: string
  /** Public source repository URL shown in the About dialog. */
  readonly VITE_REPO_URL?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
