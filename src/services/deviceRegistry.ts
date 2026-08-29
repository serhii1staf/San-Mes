// Keep this install's row on the server fresh, and find out if it has been revoked.
//
// ── THE TWO JOBS, AND WHY THEY SHARE ONE CALL ──────────────────────────────
//
// The Devices screen lists rows from the `devices` table, which is written by this heartbeat. So the
// heartbeat is what makes a device appear at all — it is not telemetry, it is the feature.
//
// The second job is revocation. Token verification in the Worker is pure HMAC with zero database
// reads per request, and tokens last 30 days; putting a revocation lookup on that path would add a D1
// read to every single call in the app. The heartbeat already talks to the database, so it is where
// the server can answer "you were removed" — and this module signs the device out when it hears that.
//
// Being honest about the limit: notifications are cut the instant the owner taps revoke (the push
// token row is deleted, and the fan-out reads that table), but the sign-out happens on this device's
// next heartbeat. A device that never reaches the network again keeps whatever it has cached until it
// does. That is true of every token-based session and is stated in the Devices screen rather than
// glossed over.
//
// ── WHEN IT RUNS ───────────────────────────────────────────────────────────
//
// On sign-in, and on each return to the foreground, throttled. Not on a timer: a timer would be work
// the app does forever for a value that only matters when someone is looking at the screen or when a
// revoke has just happened, and this codebase has already paid for one always-on background loop.

import { apiPost } from './apiClient';
import { getInstallId } from './installId';

/**
 * Minimum gap between heartbeats.
 *
 * Ten minutes. `last_seen_at` drives the "most recently active first" ordering and the date the screen
 * shows, and neither needs finer resolution than that. The revocation channel does not need it either:
 * a revoke is followed by the owner watching the other device, not by a stopwatch.
 */
const THROTTLE_MS = 10 * 60 * 1000;

let lastSentAt = 0;
let inFlight = false;

/**
 * Read the app version without making this module depend on `expo-constants` at import time.
 *
 * `expo-constants` is not free to resolve and this module is on the sign-in path. A missing value is
 * fine — the column is nullable and the screen renders without it.
 */
function readAppVersion(): string | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const C = require('expo-constants').default;
    return C?.expoConfig?.version || undefined;
  } catch {
    return undefined;
  }
}

/**
 * The descriptive fields, read from `expo-device`.
 *
 * These travel BESIDE the opaque install id and are never combined to form it — see the note in
 * `installId.ts`. They exist so the owner can tell two rows apart, which is the entire purpose of the
 * screen: "Android" next to "Android" answers nothing.
 *
 * `expo-device` is required lazily and inside try/catch because it is a native module: a build without
 * it (or a web target) must degrade to a row with nulls rather than throw on sign-in.
 */
function readDeviceLabels(): { platform?: string; model?: string; osVersion?: string } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Device = require('expo-device');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Platform } = require('react-native');
    return {
      platform: Platform?.OS,
      // Deliberately `modelName` ("iPhone 15", "Pixel 8") and NOT `deviceName`. `deviceName` is the
      // user-assigned name ("Vivian's iPhone"), which is personal data we have no need for — and on
      // iOS 16+ it returns a generic "iPhone" anyway without a special entitlement, so it would be
      // worse at the one job it could do here.
      model: Device?.modelName || undefined,
      osVersion: Device?.osVersion || undefined,
    };
  } catch {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { Platform } = require('react-native');
      return { platform: Platform?.OS };
    } catch {
      return {};
    }
  }
}

/**
 * Report this install, and act on a revocation answer.
 *
 * `force` skips the throttle — used on sign-in, where the whole point is that the device appears in
 * its owner's list immediately rather than up to ten minutes later.
 *
 * Never throws. A failed heartbeat costs a stale `last_seen_at`, which the next one fixes.
 */
export async function heartbeatDevice(opts?: { force?: boolean }): Promise<void> {
  const now = Date.now();
  if (!opts?.force && now - lastSentAt < THROTTLE_MS) return;
  // A second call while one is in flight would race the throttle stamp and could double-post on a slow
  // network, which is exactly what happens when sign-in and a foreground transition land together.
  if (inFlight) return;
  inFlight = true;
  try {
    const labels = readDeviceLabels();
    const { data } = await apiPost<{ ok?: boolean; revoked?: boolean }>('/v1/devices/heartbeat', {
      installId: getInstallId(),
      platform: labels.platform,
      model: labels.model,
      osVersion: labels.osVersion,
      appVersion: readAppVersion(),
    });
    // Stamp only on a reply. Stamping unconditionally would let one offline attempt suppress the next
    // ten minutes of heartbeats, so a device that was offline at sign-in would stay invisible.
    if (data) lastSentAt = now;

    if (data?.revoked) {
      // ── THE OWNER REMOVED THIS DEVICE ────────────────────────────────────
      //
      // Sign out exactly the way a rejected token does, so there is one teardown path rather than two:
      // clear the token, flip the auth store (the root navigator bounces to welcome synchronously on
      // that), then `switchAccount(null)` to disconnect the realtime socket and wipe the in-memory
      // feed / chat / entity stores so nothing of this account can still be read off the screen.
      //
      // Dynamic imports so this module stays off the startup dependency graph of the auth store.
      try {
        const { clearAuthToken } = await import('./authClient');
        clearAuthToken();
      } catch {}
      try {
        const { useAuthStore } = await import('../store/authStore');
        if (useAuthStore.getState().isAuthenticated) useAuthStore.getState().logout();
      } catch {}
      try {
        const { switchAccount } = await import('./accountSwitch');
        switchAccount(null);
      } catch {}
    }
  } catch {
    // best-effort
  } finally {
    inFlight = false;
  }
}

/** Test seam: drop the throttle state. */
export function __resetDeviceRegistryForTests(): void {
  lastSentAt = 0;
  inFlight = false;
}
