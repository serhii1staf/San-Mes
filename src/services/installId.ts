// The opaque per-install identifier.
//
// ── WHAT THIS IS FOR ────────────────────────────────────────────────────────
//
// The Devices screen has to be able to say "this install, on this account" so the owner can see who
// is signed in and remove them. Nothing in the app could do that before:
//
//   `profiles.device_key`  is per-ACCOUNT. It is the login secret the second person types in, so both
//                          devices in the reported "my friend uses my account" case hold the
//                          identical string. Its name is misleading and it cannot distinguish them.
//   the Expo push token    is genuinely per-install, but only exists if notification permission was
//                          granted. That is exactly what made the first version of the screen
//                          incomplete.
//
// ── WHY A RANDOM UUID AND NOT SOMETHING ABOUT THE DEVICE ───────────────────
//
// The compliance rules are explicit on both halves of this:
//
//   "No fingerprinting. Do not derive a stable per-device identifier from any data, ever."
//   "Use opaque per-install tokens."
//
// So this is `crypto.randomUUID()`, generated once, persisted, and derived from nothing. Not the
// model, not the OS, not any hardware value, not a hash of any of those. Reinstalling the app
// produces a NEW id and the old server row simply stops being seen — which is the correct behaviour
// for an install token and the opposite of what a device fingerprint would do.
//
// The descriptive fields the screen shows (platform, model, OS version) travel BESIDE this id; they
// are never combined to produce it. That distinction is the whole difference between "a label so you
// can recognise your own phone" and a fingerprint.
//
// ── STORAGE ────────────────────────────────────────────────────────────────
//
// Raw MMKV, deliberately NOT account-namespaced. One physical install has ONE id, and it must stay
// the same across account switches — otherwise signing out and back in would look like a brand new
// device every time, and the list would fill with ghosts of the same phone. The server keys on
// `(install_id, user_id)`, so per-account separation happens there, where it belongs.

import { kvGetStringRawSync, kvSetStringRaw } from './kvStore';

const INSTALL_ID_KEY = '@san:install_id';

/** UUID v4 shape, matching what the Worker validates. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let cached: string | null = null;

/**
 * Fall back to a hand-rolled v4 when `crypto.randomUUID` is unavailable.
 *
 * Hermes has exposed `crypto.randomUUID` for a while, but this module is on the sign-in path and a
 * missing global here would mean no device row at all. `Math.random` is not cryptographically strong
 * and does not need to be: this value is an opaque label, not a secret. It is never used for
 * authorisation — every endpoint that accepts it is already scoped by the authenticated `user_id`, so
 * guessing another install's id grants nothing.
 */
function fallbackUuid(): string {
  const hex = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += '-';
    else if (i === 14) out += '4';
    else if (i === 19) out += hex[(Math.floor(Math.random() * 16) & 0x3) | 0x8];
    else out += hex[Math.floor(Math.random() * 16)];
  }
  return out;
}

/**
 * This install's id, creating and persisting it on first call.
 *
 * Synchronous and cheap after the first call (one module-level variable). Safe to call from anywhere,
 * including a render path, though nothing needs to.
 *
 * Re-validates the stored value against the UUID shape rather than trusting it: a value written by a
 * future build with a different format, or a corrupted read, would otherwise be sent to a server that
 * rejects it, and the device would silently never appear in its owner's list.
 */
export function getInstallId(): string {
  if (cached) return cached;
  try {
    const stored = kvGetStringRawSync(INSTALL_ID_KEY);
    if (stored && UUID_RE.test(stored)) {
      cached = stored;
      return cached;
    }
  } catch {
    // Fall through and mint a fresh one. A read failure must not leave the device unlistable.
  }
  let next: string;
  try {
    next = (globalThis as any)?.crypto?.randomUUID?.() || fallbackUuid();
  } catch {
    next = fallbackUuid();
  }
  if (!UUID_RE.test(next)) next = fallbackUuid();
  try {
    kvSetStringRaw(INSTALL_ID_KEY, next);
  } catch {
    // Unpersisted means a new id next launch, i.e. a duplicate row rather than a broken screen.
    // Preferred over throwing on the sign-in path.
  }
  cached = next;
  return cached;
}

/** Test seam: forget the memoised value so a test can re-exercise the mint path. */
export function __resetInstallIdForTests(): void {
  cached = null;
}
