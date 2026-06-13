// LibreTranslate client.
//
// Endpoint: https://libretranslate.com/translate (POST)
// Auth: `api_key` form field (we read EXPO_PUBLIC_LIBRETRANSLATE_KEY).
// Privacy: text is sent over HTTPS to libretranslate.com. We only ever
// translate text the user explicitly asks to translate (via the chat /
// comment context menu) — never automatic, never bulk. No PII other than
// what the user typed.
//
// Caching: identical (source-text, target) pairs are cached for 7 days in
// MMKV so repeat reads are free. Cache key uses a short hash of the
// normalized text so the bundle never holds the raw user content as a key
// in the SQLite/MMKV index.

import { kvGetJSONSync, kvSetJSON } from '../kvStore';
import { getLibreTranslateKey } from '../env';

const FETCH_TIMEOUT_MS = 8000;
const CACHE_PREFIX = '@san:translate:';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ENDPOINT = 'https://libretranslate.com/translate';

export interface TranslationResult {
  /** Translated text. */
  text: string;
  /** ISO-639-1 code LibreTranslate detected for the input. */
  detectedSource: string;
  /** Confidence 0..1. */
  detectedConfidence: number;
}

interface CacheEntry {
  t: number;
  d: TranslationResult;
}

// Tiny non-cryptographic FNV-1a hash for cache keys. We do NOT want raw user
// text appearing as a key in the kv index, and a stable 32-bit hash gives a
// good-enough collision rate for a 7-day translation cache.
function hash32(s: string): string {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function cacheKey(text: string, target: string): string {
  return `${CACHE_PREFIX}${target}:${hash32(text)}:${text.length}`;
}

/**
 * Translate `text` into the user's `target` language. Returns null on any
 * failure — the UI hides the result section in that case so the user can
 * retry without seeing a half-broken sheet.
 *
 * Source language is auto-detected by the server (`source: 'auto'`).
 */
export async function translateText(
  text: string,
  target: string,
): Promise<TranslationResult | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // 1) Cache hit?
  try {
    const cached = kvGetJSONSync<CacheEntry | null>(cacheKey(trimmed, target), null);
    if (cached && Date.now() - cached.t < CACHE_TTL_MS) return cached.d;
  } catch {}

  const apiKey = getLibreTranslateKey();
  // The public LibreTranslate instance requires an API key; without one we
  // gracefully fall back to no-translation rather than spam unauthenticated
  // requests that always return 403.
  if (!apiKey) return null;

  // 2) Network round-trip.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const body = new URLSearchParams({
      q: trimmed,
      source: 'auto',
      target,
      format: 'text',
      api_key: apiKey,
    });
    const resp = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: controller.signal,
    });
    if (!resp.ok) return null;
    const json = (await resp.json()) as {
      translatedText?: string;
      detectedLanguage?: { language?: string; confidence?: number };
    };
    if (!json?.translatedText) return null;
    const result: TranslationResult = {
      text: json.translatedText,
      detectedSource: json.detectedLanguage?.language || 'auto',
      detectedConfidence:
        typeof json.detectedLanguage?.confidence === 'number'
          ? json.detectedLanguage.confidence
          : 0,
    };

    // 3) Stash in cache. Best-effort.
    try {
      kvSetJSON(cacheKey(trimmed, target), { t: Date.now(), d: result });
    } catch {}

    return result;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
