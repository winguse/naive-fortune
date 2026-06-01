export type AppLanguage = 'zh-CN' | 'en-US'
export type AppLanguagePreference = AppLanguage | 'auto'

export const APP_LANGUAGE_STORAGE_KEY = 'naive-fortune-language'

const pickFromNavigator = (): string => {
  if (typeof navigator === 'undefined') return 'en-US'
  const preferred = navigator.languages?.[0] ?? navigator.language
  return preferred || 'en-US'
}

export const detectAppLanguage = (): AppLanguage => {
  if (typeof window !== 'undefined') {
    const saved = window.localStorage.getItem(APP_LANGUAGE_STORAGE_KEY) as AppLanguagePreference | null
    if (saved === 'zh-CN' || saved === 'en-US') return saved
  }
  const locale = pickFromNavigator().toLowerCase()
  return locale.startsWith('zh') ? 'zh-CN' : 'en-US'
}

export const persistLanguagePreference = (value: AppLanguagePreference) => {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(APP_LANGUAGE_STORAGE_KEY, value)
}

export const appLanguage = detectAppLanguage()
export const isZh = appLanguage === 'zh-CN'