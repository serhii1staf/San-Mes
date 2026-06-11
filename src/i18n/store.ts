import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

import ru from './locales/ru';
import en from './locales/en';

export type Locale = 'ru' | 'en';

// All dictionaries indexed by locale code. They share the same key space —
// adding a key in `ru.ts` without an `en.ts` counterpart falls back to the
// key itself or the fallback string passed to t().
const dictionaries: Record<Locale, Record<string, string>> = { ru, en };

const i18nStorage: StateStorage = {
  setItem: async (name: string, value: string) => { await AsyncStorage.setItem(name, value); },
  getItem: async (name: string) => { return await AsyncStorage.getItem(name); },
  removeItem: async (name: string) => { await AsyncStorage.removeItem(name); },
};

interface I18nState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export const useI18nStore = create<I18nState>()(
  persist(
    (set) => ({
      locale: 'ru',
      setLocale: (locale) => set({ locale }),
    }),
    {
      name: 'i18n',
      storage: createJSONStorage(() => i18nStorage),
    }
  )
);

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Translate a key. Use this from non-component contexts (utility functions,
 * services, store actions). Inside React components prefer the useT() hook
 * so the component re-renders when the locale changes.
 *
 * Optional `vars` interpolates `{name}`-style placeholders in the result.
 */
export function t(key: string, fallback?: string, vars?: Record<string, string | number>): string {
  const locale = useI18nStore.getState().locale;
  const dict = dictionaries[locale] || dictionaries.ru;
  let value = dict[key];
  if (value === undefined) value = dictionaries.ru[key];
  if (value === undefined) value = fallback ?? key;
  if (vars) {
    for (const name of Object.keys(vars)) {
      value = value.replace(new RegExp(`\\{${name}\\}`, 'g'), String(vars[name]));
    }
  }
  return value;
}

/**
 * Hook flavour of t(). Component re-renders when the locale changes.
 */
export function useT() {
  const locale = useI18nStore((s) => s.locale);
  return (key: string, fallback?: string, vars?: Record<string, string | number>): string => {
    const dict = dictionaries[locale] || dictionaries.ru;
    let value = dict[key];
    if (value === undefined) value = dictionaries.ru[key];
    if (value === undefined) value = fallback ?? key;
    if (vars) {
      for (const name of Object.keys(vars)) {
        value = value.replace(new RegExp(`\\{${name}\\}`, 'g'), String(vars[name]));
      }
    }
    return value;
  };
}

export const SUPPORTED_LOCALES: { key: Locale; name: string; native: string }[] = [
  { key: 'ru', name: 'Russian', native: 'Русский' },
  { key: 'en', name: 'English', native: 'English' },
];
