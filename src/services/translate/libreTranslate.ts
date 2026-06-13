// Translation client with provider cascade.
//
// Reliability over a single provider: we try a series of free / keyless
// endpoints in order, returning the first one that succeeds. None of them
// hit our own backend — every call goes directly to a third-party host —
// so this costs us nothing in DB / Vercel quota.
//
// Order:
//   1) Google Translate `gtx` endpoint — undocumented but the most reliable
//      and fastest free option. Used by every open-source translator app
//      (gtranslate.cc, simply translate, etc.). No key, no daily limit.
//   2) MyMemory — officially keyless, free up to 1000 words/day per IP for
//      anonymous use. Slower but stable.
//   3) LibreTranslate (with the user-provided key) — paid tier, last fallback
//      because the free endpoint has been flaky in practice.
//
// Each provider has a hard 6-second timeout so a stuck network never makes
// the user wait forever — we just move to the next provider.
//
// Caching: identical (source-text, target) pairs are cached for 7 days in
// MMKV so repeat reads are free. Cache key uses a short FNV-1a hash so the
// raw user content never appears as an MMKV index entry.

import { kvGetJSONSync, kvSetJSON } from '../kvStore';
import { getLibreTranslateKey } from '../env';

const FETCH_TIMEOUT_MS = 6000;
const CACHE_PREFIX = '@san:translate:';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface TranslationResult {
  /** Translated text. */
  text: string;
  /** ISO-639-1 code the provider detected for the input. */
  detectedSource: string;
  /** Confidence 0..1 (0 when the provider doesn't expose this). */
  detectedConfidence: number;
  /** Which provider answered — useful for debugging in dev tools. */
  provider: 'google-gtx' | 'mymemory' | 'libretranslate';
}

interface CacheEntry {
  t: number;
  d: TranslationResult;
}

// Tiny non-cryptographic FNV-1a hash for cache keys. Keeps raw user text out
// of the MMKV key index while giving acceptable collision rates for 7-day
// translation cache.
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

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await p;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Provider 1: Google Translate gtx ────────────────────────────────────
// Endpoint: https://translate.googleapis.com/translate_a/single
// Returns a deeply-nested array; we walk it carefully and join the segments
// (Google chunks long input into multiple translation pieces).
async function viaGoogleGtx(text: string, target: string): Promise<TranslationResult | null> {
  const url =
    `https://translate.googleapis.com/translate_a/single?client=gtx` +
    `&sl=auto&tl=${encodeURIComponent(target)}&dt=t` +
    `&q=${encodeURIComponent(text)}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { signal: ctl.signal });
    if (!resp.ok) return null;
    const json = (await resp.json()) as any[];
    // [ [ [ "translated piece", "original piece", null, null, …], … ], …, "src-lang", … ]
    const segments = json?.[0];
    if (!Array.isArray(segments)) return null;
    const translated = segments
      .map((s) => (Array.isArray(s) && typeof s[0] === 'string' ? s[0] : ''))
      .join('');
    const detected = typeof json?.[2] === 'string' ? json[2] : 'auto';
    if (!translated.trim()) return null;
    return {
      text: translated,
      detectedSource: detected,
      detectedConfidence: 0,
      provider: 'google-gtx',
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Provider 2: MyMemory ────────────────────────────────────────────────
// Endpoint: https://api.mymemory.translated.net/get
// MyMemory needs explicit langpair "src|tgt" — autodetect is done by their
// server when src='Autodetect' is passed. Quota: 1000 words/day per IP.
async function viaMyMemory(text: string, target: string): Promise<TranslationResult | null> {
  const url =
    `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}` +
    `&langpair=Autodetect%7C${encodeURIComponent(target)}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { signal: ctl.signal });
    if (!resp.ok) return null;
    const json = (await resp.json()) as {
      responseData?: { translatedText?: string };
      matches?: { source?: string }[];
      responseStatus?: number;
    };
    const translated = json?.responseData?.translatedText;
    if (!translated) return null;
    // MyMemory returns a "PLEASE SELECT TWO DISTINCT LANGUAGES" string when
    // detection picked the same language as target. Treat that as a failure
    // so the cascade tries the next provider, but if the fallback also fails
    // we'd rather show no result than this canned string.
    if (translated.includes('PLEASE SELECT')) return null;
    const detected = json.matches?.[0]?.source || 'auto';
    return {
      text: translated,
      detectedSource: detected,
      detectedConfidence: 0,
      provider: 'mymemory',
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Provider 3: LibreTranslate (paid) ───────────────────────────────────
// Last fallback — its hosted endpoint has been flaky in practice. We only
// try it when the user has an API key configured.
async function viaLibreTranslate(text: string, target: string): Promise<TranslationResult | null> {
  const apiKey = getLibreTranslateKey();
  if (!apiKey) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const body = new URLSearchParams({
      q: text,
      source: 'auto',
      target,
      format: 'text',
      api_key: apiKey,
    });
    const resp = await fetch('https://libretranslate.com/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: ctl.signal,
    });
    if (!resp.ok) return null;
    const json = (await resp.json()) as {
      translatedText?: string;
      detectedLanguage?: { language?: string; confidence?: number };
    };
    if (!json?.translatedText) return null;
    return {
      text: json.translatedText,
      detectedSource: json.detectedLanguage?.language || 'auto',
      detectedConfidence:
        typeof json.detectedLanguage?.confidence === 'number'
          ? json.detectedLanguage.confidence
          : 0,
      provider: 'libretranslate',
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Translate `text` into the user's `target` language. Returns null only when
 * every provider in the cascade failed. Source language is auto-detected.
 */
export async function translateText(
  text: string,
  target: string,
): Promise<TranslationResult | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // 1) Cache hit? Identical (text, target) requests are served instantly.
  try {
    const cached = kvGetJSONSync<CacheEntry | null>(cacheKey(trimmed, target), null);
    if (cached && Date.now() - cached.t < CACHE_TTL_MS) return cached.d;
  } catch {}

  // 2) Provider cascade — first hit wins.
  const result =
    (await viaGoogleGtx(trimmed, target)) ||
    (await viaMyMemory(trimmed, target)) ||
    (await viaLibreTranslate(trimmed, target));

  if (!result) return null;

  // 3) Stash for 7 days. Best-effort.
  try {
    kvSetJSON(cacheKey(trimmed, target), { t: Date.now(), d: result });
  } catch {}

  return result;
}
