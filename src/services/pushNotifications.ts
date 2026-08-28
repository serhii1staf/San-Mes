import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { apiPost } from './apiClient';
import { kvGetStringRawSync, kvSetStringRaw } from './kvStore';
import { useSettingsStore } from '../store/settingsStore';
import { isActiveThread } from './activeThread';

// ── Push notifications (Expo Push) ──────────────────────────────────────────
//
// Client half of push: request permission, obtain an Expo push token, and
// register it with the Worker (`POST /v1/push/register`). The Worker stores the
// token per user and fans out pushes (new message / comment reply / follow) via
// the Expo Push API.
//
// IMPORTANT: `expo-notifications` is a NATIVE module that only exists from the
// next native build onward. Every entry point dynamic-requires it inside a
// try/catch so the CURRENT OTA build (which doesn't bundle the native module)
// is a harmless no-op instead of crashing.

const TOKEN_SENT_KEY = '@san:push_token_sent';
let handlerConfigured = false;

function getModules(): { Notifications: any; Device: any } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Notifications = require('expo-notifications');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Device = require('expo-device');
    return { Notifications, Device };
  } catch {
    return null;
  }
}

/**
 * Should a foreground push be presented, given what is on screen?
 *
 * ── THE BUG ─────────────────────────────────────────────────────────────────
 *
 * Reported as: "someone writes to me while I am inside that chat and I still get a push. Why
 * do I need a push for the chat I am looking at?" Same for comments.
 *
 * `handleNotification` returned four constants and ignored the notification argument entirely,
 * so a push for the conversation currently on screen was presented exactly like one for a chat
 * the user had never opened. The message was already being delivered over Ably and rendered in
 * the transcript at the same moment — so the banner was not just noise, it announced something
 * the user could already see.
 *
 * Suppression is on the THREAD, not on "app is foreground": a message from a different chat
 * still deserves a banner while the user is in this one. That is the whole point of matching
 * the payload's `conversation_id` / `post_id` against the register.
 *
 * Suppressed means presentation only. The notification is never dropped from the system list
 * for another reason — see the return value.
 */
function shouldPresent(notification: any): boolean {
  try {
    const data = notification?.request?.content?.data;
    if (!data || typeof data !== 'object') return true;
    if (data.type === 'message') {
      return !isActiveThread('chat', typeof data.conversation_id === 'string' ? data.conversation_id : null);
    }
    if (data.type === 'comment') {
      return !isActiveThread('post', typeof data.post_id === 'string' ? data.post_id : null);
    }
    // 'follow' and anything unrecognised: always present. A follow is never "already on
    // screen", and an unknown type must fail OPEN — silently swallowing a notification is a
    // worse failure than showing one banner too many.
    return true;
  } catch {
    return true;
  }
}

/** Foreground presentation: show banner + play sound, don't touch the badge. */
export function configureNotificationHandler(): void {
  const mods = getModules();
  if (!mods || handlerConfigured) return;
  handlerConfigured = true;
  try {
    mods.Notifications.setNotificationHandler({
      handleNotification: async (notification: any) => {
        const present = shouldPresent(notification);
        return {
          shouldShowBanner: present,
          shouldPlaySound: present,
          // Kept true even when suppressed: the banner is redundant because the user is
          // looking at the message, but the entry in Notification Centre is the record that
          // it arrived, and removing that would lose history rather than reduce noise.
          shouldShowList: true,
          shouldSetBadge: false,
        };
      },
    });
  } catch {}
}

function resolveProjectId(): string | undefined {
  try {
    return (
      (Constants as any)?.expoConfig?.extra?.eas?.projectId ||
      (Constants as any)?.easConfig?.projectId ||
      undefined
    );
  } catch {
    return undefined;
  }
}

/**
 * Request permission, get the Expo push token, and register it with the Worker.
 * Safe to call repeatedly — the token is only POSTed when it changes. No-op on
 * a build without the native module, on a simulator, or when permission is
 * denied.
 */
export async function registerForPush(): Promise<void> {
  // Respect the user's master switch — when push is turned off in Settings we
  // must neither request permission nor register a token. Defensive try/catch
  // so a store-read failure never blocks the (already best-effort) flow.
  try {
    if (useSettingsStore.getState().pushNotificationsEnabled === false) return;
  } catch {}
  const mods = getModules();
  if (!mods) return;
  const { Notifications, Device } = mods;
  try {
    if (Device?.isDevice === false) return; // simulators can't get a push token

    configureNotificationHandler();

    if (Platform.OS === 'android') {
      try {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'Default',
          importance: Notifications.AndroidImportance?.HIGH ?? 4,
          sound: 'default',
        });
      } catch {}
    }

    let status = (await Notifications.getPermissionsAsync())?.status;
    if (status !== 'granted') {
      status = (await Notifications.requestPermissionsAsync())?.status;
    }
    if (status !== 'granted') return;

    const projectId = resolveProjectId();
    const resp = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    const token: string | undefined = resp?.data;
    if (!token) return;

    // Avoid redundant network writes when the token is unchanged.
    if (kvGetStringRawSync(TOKEN_SENT_KEY) === token) return;
    const { error } = await apiPost('/v1/push/register', { token, platform: Platform.OS });
    if (!error) kvSetStringRaw(TOKEN_SENT_KEY, token);
  } catch {}
}

/** Drop the token server-side on logout / account switch. */
export async function unregisterPush(): Promise<void> {
  try {
    const token = kvGetStringRawSync(TOKEN_SENT_KEY);
    if (!token) return;
    await apiPost('/v1/push/unregister', { token });
    kvSetStringRaw(TOKEN_SENT_KEY, '');
  } catch {}
}

// ── Tapping a notification must open the thread it came from ────────────────
//
// Reported as: "I tap the notification and the app opens, but not the section the message came
// from."
//
// That is exactly what the code did. There was no `addNotificationResponseReceivedListener`
// and no `getLastNotificationResponseAsync` anywhere in the app, so the `{ type,
// conversation_id | post_id | follower_id }` payload the Worker faithfully sends was read by
// nobody. The OS launched or foregrounded the app, expo-router restored its default route, and
// the payload was discarded.
//
// Both cases have to be handled, and they are genuinely different:
//
//   WARM  — app already running. `addNotificationResponseReceivedListener` fires on tap.
//   COLD  — app was killed. No listener exists yet at the moment of the tap, so the response
//           has to be COLLECTED after startup via `getLastNotificationResponseAsync`. Missing
//           this is why "tap a push after the app was closed" would land on the feed even with
//           a listener installed.

/** Where a notification payload should take the user, or null when it should not navigate. */
export function routeForNotificationData(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
  switch (d.type) {
    case 'message': {
      const id = str(d.conversation_id);
      return id ? `/chat/${encodeURIComponent(id)}` : null;
    }
    case 'comment': {
      const id = str(d.post_id);
      return id ? `/comments/${encodeURIComponent(id)}` : null;
    }
    case 'follow': {
      // The follower's profile is the useful destination — it is what the user wants to look
      // at, and it is where the follow-back action lives.
      const id = str(d.follower_id);
      return id ? `/profile/${encodeURIComponent(id)}` : null;
    }
    default:
      return null;
  }
}

/**
 * Install the tap handler. Returns a disposer; safe to call when the native module is absent.
 *
 * `navigate` is injected rather than importing the router here so this stays a plain service
 * (testable, and with no opinion about which navigation library is in use).
 */
export function installNotificationTapHandler(navigate: (path: string) => void): () => void {
  const mods = getModules();
  if (!mods) return () => {};
  const { Notifications } = mods;
  let disposed = false;

  const go = (response: any) => {
    if (disposed) return;
    try {
      const path = routeForNotificationData(response?.notification?.request?.content?.data);
      if (path) navigate(path);
    } catch {}
  };

  let sub: { remove?: () => void } | null = null;
  try {
    sub = Notifications.addNotificationResponseReceivedListener(go);
  } catch {}

  // COLD START. The tap that launched the app happened before any listener existed, so ask for
  // it explicitly. Guarded against double-handling: if the warm listener also delivers this
  // same response, `handledColdStart` means we navigate once.
  let handledColdStart = false;
  try {
    Notifications.getLastNotificationResponseAsync?.()
      .then((response: any) => {
        if (disposed || handledColdStart || !response) return;
        handledColdStart = true;
        // One tick so the router has mounted its initial route — navigating into a stack that
        // has not committed yet is dropped silently.
        setTimeout(() => go(response), 400);
      })
      .catch(() => {});
  } catch {}

  return () => {
    disposed = true;
    try { sub?.remove?.(); } catch {}
  };
}

// ── THE APP ICON NEVER CARRIED A NUMBER ──────────────────────────────────────
//
// Reported as: on iPhone, if you leave a message unread the count normally stays on the app icon even
// after you swipe the push away — and this app shows nothing there.
//
// Correct, and it is not a subtle bug: `setBadgeCountAsync` was never called anywhere in the codebase,
// and the foreground handler explicitly passes `shouldSetBadge: false` with the note "don't touch the
// badge". So the only trace of an unread message was the push itself, and dismissing the push destroyed
// the last thing that knew about it. That is exactly the symptom.
//
// This is a separate mechanism from the in-app badge. The in-app one is derived from the cached
// notification feed against a last-seen watermark (`notificationsBadgeStore`); the OS badge is a single
// integer owned by the system and painted on the launcher icon. Nothing was keeping them in step because
// nothing was writing the second one at all.
//
// ── WHAT THIS FIXES AND WHAT IT CANNOT ───────────────────────────────────────
//
// It fixes every case where the app has run since the message arrived: the store now mirrors its unread
// count onto the icon, so backgrounding the app leaves the number visible, and dismissing the push no
// longer loses it.
//
// It does NOT fix a fully-terminated app, and that half is not an OTA. While the process is dead no JS
// runs, so the number can only come from the push payload itself — the Expo push message needs a `badge`
// field, which means the Worker's fan-out has to compute and send it. That is a Worker deploy, tracked
// separately rather than pretended away here.
//
// ── TWO CLIENT-SIDE SHORTCUTS THAT DO NOT EXIST, CHECKED RATHER THAN ASSUMED ──
//
// Reported again as: the push sits on the home screen and the icon carries no number until I open the
// app once. That is this gap exactly, and the honest answer to "how many minutes should it take" is
// never — it is structural, not a delay. Before concluding that, two client-side escapes were checked
// against the INSTALLED module rather than against documentation:
//
//   1. `showBadge: true` on the Android channel. Does nothing on the version we ship. Searching
//      `node_modules/expo-notifications/android` for `setShowBadge` finds exactly ONE call —
//      `channel.setShowBadge(true)` inside `BaseNotificationBuilder.createFallbackChannel()`, i.e. the
//      channel used when no channelId is given. `showBadge` appears in
//      `build/NotificationChannelManager.types.d.ts` only on the type describing a channel READ BACK;
//      there is no Kotlin reading it from the JS input for `setNotificationChannelAsync`. So passing it
//      to the explicit 'default' channel this file creates would be silently ignored.
//
//      This is the same trap as `enableBackgroundPlayback` on expo-audio 1.1.1, recorded in
//      .kiro/steering/apple-compliance.md: an option that exists in the docs for a later release and is
//      accepted-and-dropped by the version installed. Check the module source for the version we ship.
//
//      It is also unnecessary on Android: because nothing calls `setShowBadge` on our explicit channel,
//      Android's own `NotificationChannel` default applies, and that default is already true. The
//      launcher DOT works; what is missing is the NUMBER, and that comes from the payload.
//
//   2. Waking JS on delivery to compute the number locally. Needs `content-available` on iOS, which is
//      again a payload field the Worker would have to send. Same blocker, one layer down.
//
// So there is no client-only fix on either platform, and the remaining work is server-side and larger
// than a payload field: `workers/api/src/push.ts` builds `{ to, title, body, sound, priority, channelId,
// data }` and the Worker has no read-state at all (`app/(tabs)/messages.tsx` says so outright, and the
// watermark lives in per-install MMKV). A correct badge needs a read-state column plus an endpoint to
// advance it — a schema AND data-flow change, which also brings the steering doc's privacy section into
// scope because per-user read timestamps would become server-side data we do not currently hold.
//
// `shouldSetBadge` in the foreground handler stays FALSE on purpose. Letting the OS increment on delivery
// would race this: a push for the chat the user is already reading is deliberately not presented, and it
// must not silently bump the icon either. The count is derived from one place, and this is the writer.
//
// No new permission. On iOS the badge authorisation is part of the alert/sound/badge set that
// `requestPermissionsAsync` already asks for; Android draws the count as a launcher dot/number with no
// separate grant. Nothing new is collected or transmitted — the number is computed locally from the
// notification cache that is already on the device.
export async function setOsBadgeCount(count: number): Promise<void> {
  const mods = getModules();
  if (!mods) return;
  try {
    const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
    await mods.Notifications.setBadgeCountAsync(n);
  } catch {
    // Unsupported launcher, permission not granted, or the native module absent on this build. A badge
    // that cannot be written must never surface as an error to the user.
  }
}
