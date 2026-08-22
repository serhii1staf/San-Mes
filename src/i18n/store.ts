import { useCallback } from 'react';
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
  // ── `useCallback` IS LOAD-BEARING. DO NOT REMOVE IT. ────────────────────────
  //
  // This used to return a bare arrow function, so `t` had a NEW IDENTITY on every
  // render of every consumer. `t` is listed in the dependency array of a lot of
  // `useMemo`s across the app, and the most expensive ones are chained:
  //
  //   app/(tabs)/profile.tsx     tabs -> tabsRow -> listHeader -> ListHeaderComponent
  //   app/profile/[id].tsx       tabs -> tabsRow -> listHeader -> ListHeaderComponent
  //                              bannerHeader also lists `t` directly
  //
  // Every one of those memos was therefore invalidated on EVERY render, and each
  // profile screen handed its `Animated.FlatList` a brand-new header element tree
  // each time. The header is the heavy part: a `CachedImage` banner, two or three
  // `BlurView`/`NativeGlassView` pills, the adaptive-colour identity text, the
  // links row and four tab pills. Those files carry long comments explaining how
  // the memo split keeps the banner mounted across tab switches; none of it held,
  // because of this one missing wrapper.
  //
  // That is the profile FPS drop, on both the own-profile tab and someone else's:
  // any state flip at all (a scroll threshold crossing, a drag start, a follow
  // count arriving) rebuilt the whole banner subtree.
  //
  // `theme` was ruled out as a second cause: ThemeProvider already memoizes its
  // context value on primitive inputs, so `theme` is stable. It was only `t`.
  return useCallback(
    (key: string, fallback?: string, vars?: Record<string, string | number>): string => {
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
    },
    [locale],
  );
}

export const SUPPORTED_LOCALES: { key: Locale; name: string; native: string }[] = [
  { key: 'ru', name: 'Russian', native: 'Русский' },
  { key: 'en', name: 'English', native: 'English' },
];
