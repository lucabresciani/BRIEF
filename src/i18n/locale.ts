import { toMB } from '@/domain/import/limits'
import type { Lang } from './translate'

/**
 * The Intl locale of a UI language. English uses the British conventions (day before month, 24-hour
 * clock), closer to the SI usage of the app than the US ones.
 */
export const intlLocale = (lang: Lang): string => (lang === 'it' ? 'it-IT' : 'en-GB')

/**
 * A size in megabytes (2^20 bytes) with at most one decimal, in the language's number notation, with
 * a non-breaking space so the number never wraps away from its unit: "1.5 MB", "1,5 MB".
 */
export function formatMegabytes(bytes: number, lang: Lang): string {
  return new Intl.NumberFormat(intlLocale(lang), { maximumFractionDigits: 1 }).format(toMB(bytes)) + ' MB'
}
