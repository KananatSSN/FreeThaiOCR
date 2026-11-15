import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'
import en from './en.json'
import th from './th.json'

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en }, th: { translation: th } },
    supportedLngs: ['th', 'en'],
    nonExplicitSupportedLngs: true,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    detection: { order: ['querystring', 'localStorage', 'navigator'], lookupQuerystring: 'lng', lookupLocalStorage: 'freethaiocr.lang', caches: ['localStorage'] },
  })

const syncHtmlLang = (lng: string) => document.documentElement.setAttribute('lang', lng.startsWith('th') ? 'th' : 'en')
syncHtmlLang(i18n.language ?? 'en')
i18n.on('languageChanged', syncHtmlLang)

export default i18n
