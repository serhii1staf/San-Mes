// Centralized read-only access to third-party service keys.
//
// Only `EXPO_PUBLIC_*` env vars are surfaced — those are intentionally baked
// into the JS bundle at build time and visible to anyone who unzips the IPA.
// Every key here is a client-safe identifier that gates rate-limits, NOT a
// server secret. Server secrets (Algolia Write API key, Liveblocks Secret
// key, OpenAI key, etc.) MUST be configured on Vercel env and accessed
// through our `/api/*` routes — never imported in any file under `src/` or
// `app/`.
//
// Each accessor returns `null` when the key is missing so the calling code
// can degrade gracefully (NASA APOD falls back to `DEMO_KEY`, LibreTranslate
// silently disables translation, etc.).

function read(name: string): string | null {
  // process.env is the standard surface for Expo's EXPO_PUBLIC_*. The babel
  // plugin inlines these at build time on iOS/Android; on web they're set
  // via Webpack DefinePlugin. Either way, this is a synchronous string get.
  const v = (process.env as Record<string, string | undefined>)[name];
  if (!v) return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** NASA APOD API key. `null` → fall back to `DEMO_KEY` (low rate limit). */
export function getNasaKey(): string {
  return read('EXPO_PUBLIC_NASA_KEY') || 'DEMO_KEY';
}

/** LibreTranslate API key. `null` → translation feature is disabled. */
export function getLibreTranslateKey(): string | null {
  return read('EXPO_PUBLIC_LIBRETRANSLATE_KEY');
}

export interface AlgoliaConfig {
  appId: string;
  searchKey: string;
}

/**
 * Algolia config for client-side search. Returns null when not configured —
 * caller should fall back to the existing SQL-based search in that case.
 */
export function getAlgoliaConfig(): AlgoliaConfig | null {
  const appId = read('EXPO_PUBLIC_ALGOLIA_APP_ID');
  const searchKey = read('EXPO_PUBLIC_ALGOLIA_SEARCH_KEY');
  if (!appId || !searchKey) return null;
  return { appId, searchKey };
}

/** Liveblocks public key. `null` disables Liveblocks-driven presence. */
export function getLiveblocksPublicKey(): string | null {
  return read('EXPO_PUBLIC_LIVEBLOCKS_PUBLIC');
}
