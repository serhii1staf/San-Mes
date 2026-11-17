/**
 * One-shot flags read during startup. Tiny on purpose: the root layout imports this on the launch
 * path, so it must not pull in stores or the realtime client.
 *
 * Stored through the raw (un-namespaced) KV API because they describe the NEXT launch, which may be
 * a different account than the one that wrote them.
 */
import { kvGetStringRawSync, kvSetStringRaw } from './kvStore';

/** Set right before `Updates.reloadAsync()` after an account switch; read once by the splash. */
export const SKIP_SPLASH_ONCE_KEY = '@san:skip_splash_once';

export function markSkipSplashOnce(): void {
  try { kvSetStringRaw(SKIP_SPLASH_ONCE_KEY, '1'); } catch {}
}

/** True at most once per flag set; clears the flag as it reads it. */
export function consumeSkipSplashOnce(): boolean {
  try {
    if (kvGetStringRawSync(SKIP_SPLASH_ONCE_KEY) !== '1') return false;
    kvSetStringRaw(SKIP_SPLASH_ONCE_KEY, '');
    return true;
  } catch {
    return false;
  }
}

/** The splash colour (app.json `splash.backgroundColor`), for anything that must match it. */
export const SPLASH_BACKGROUND = '#141414';
