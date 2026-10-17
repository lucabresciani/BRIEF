import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { readPreference, writePreference } from '@/platform/preferences'
import { makeTranslator, type Lang, type Translator } from './translate'

interface I18nValue {
  lang: Lang
  t: Translator
  setLang: (lang: Lang) => void
}

const I18nContext = createContext<I18nValue | null>(null)
const STORAGE_KEY = 'brief.lang'
const FORMER_STORAGE_KEY = 'sde.lang'

function initialLang(): Lang {
  const stored = readPreference(STORAGE_KEY, FORMER_STORAGE_KEY)
  return stored === 'en' || stored === 'it' ? stored : 'en'
}

export function I18nProvider({ children, lang: forced }: { children: ReactNode; lang?: Lang }) {
  const [lang, setLangState] = useState<Lang>(() => forced ?? initialLang())
  const t = useMemo(() => makeTranslator(lang), [lang])

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const value = useMemo<I18nValue>(
    () => ({
      lang,
      t,
      setLang: (next) => {
        setLangState(next)
        writePreference(STORAGE_KEY, next)
      },
    }),
    [lang, t],
  )
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const v = useContext(I18nContext)
  if (!v) throw new Error('useI18n must be used inside <I18nProvider>')
  return v
}

export function useT(): Translator {
  return useI18n().t
}
