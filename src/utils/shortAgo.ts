/**
 * Short, localized "time ago" for posts and comments: «сейчас», «5м», «3ч», «2д», then a date.
 *
 * `formatTimeAgo` in utils/mockData is English-only ("just now", "5m ago"), which showed up as
 * English text in the Russian UI. This reuses the comment screen's `comments.time_*` keys so every
 * place that shows a post or comment age says it the same way.
 */
import { useCallback } from 'react';
import { useT, useI18nStore } from '../i18n/store';

type Translate = ReturnType<typeof useT>;

// One formatter per locale, built on first use rather than per row.
const dateFmts: Record<string, Intl.DateTimeFormat> = {};

function shortDate(ms: number, locale: string): string {
  try {
    const fmt = (dateFmts[locale] ??= new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }));
    return fmt.format(ms);
  } catch {
    return new Date(ms).toLocaleDateString();
  }
}

export function formatShortAgo(iso: string, t: Translate, locale: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '';
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return t('comments.time_now');
  if (mins < 60) return t('comments.time_min', undefined, { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t('comments.time_hour', undefined, { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t('comments.time_day', undefined, { n: days });
  return shortDate(then, locale);
}

/** Hook form: re-renders with the locale, returns a stable formatter. */
export function useShortAgo() {
  const t = useT();
  const locale = useI18nStore((s) => s.locale);
  return useCallback((iso: string) => formatShortAgo(iso, t, locale), [t, locale]);
}
