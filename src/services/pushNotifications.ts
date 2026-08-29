import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';
import { apiPost } from './apiClient';
import { kvGetStringRawSync, kvSetStringRaw } from './kvStore';
import { useSettingsStore, isAlertCategoryEnabled } from '../store/settingsStore';
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

/**
 * Does the user still want to hear about this KIND of event?
 *
 * Reads the payload's `data.type`, which the Worker sets to `'message' | 'comment' | 'follow'` at its
 * three `sendPushToUser` call sites. An unrecognised or missing type is allowed through, matching
 * `shouldPresent`'s fail-open rule: a payload shape we do not understand must not be silently dropped.
 */
function categoryAllowed(notification: any): boolean {
  try {
    const raw = notification?.request?.content?.data?.type;
    if (raw !== 'message' && raw !== 'comment' && raw !== 'follow' && raw !== 'like') return true;
    return isAlertCategoryEnabled(raw);
  } catch {
    return true;
  }
}

/**
 * Translate a notification into an in-app alert and queue it.
 *
 * Field mapping is taken from what the Worker actually sends, not from a guess:
 *   • `routes/messages.ts` → `title: sender.display_name || username || 'New message'`,
 *                             `data: { type: 'message', conversation_id, sender_id }`
 *   • `routes/follows.ts`  → `title: followerName`, `data: { type: 'follow', follower_id }`
 * so `title` is the ACTOR'S NAME rather than a sentence, which is exactly what the pill wants.
 *
 * No emoji is sent in the payload, so it is resolved locally from the profile we already hold and
 * falls back to a neutral glyph. Nothing is fetched to fill it in: an alert is not worth a network
 * round trip, and the pill reads correctly without one.
 */
function enqueueInAppAlert(notification: any): void {
  const content = notification?.request?.content;
  const data = content?.data;
  const rawType = typeof data?.type === 'string' ? data.type : '';
  const kind =
    rawType === 'message' || rawType === 'comment' || rawType === 'like' || rawType === 'follow'
      ? (rawType as 'message' | 'comment' | 'like' | 'follow')
      : null;
  // Unknown type: no pill. Unlike the banner decision, which fails OPEN because swallowing a
  // notification is worse than one banner too many, an ambient pill for an unrecognised event would
  // have no honest text to show.
  if (!kind) return;

  const actorId =
    (typeof data?.sender_id === 'string' && data.sender_id) ||
    (typeof data?.follower_id === 'string' && data.follower_id) ||
    undefined;

  const name = typeof content?.title === 'string' && content.title.trim().length > 0
    ? content.title.trim()
    : 'Someone';

  let emoji = kind === 'follow' ? '👤' : kind === 'like' ? '❤️' : kind === 'comment' ? '💬' : '✉️';
  try {
    if (actorId) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { useEntityStore } = require('./entityStore') as typeof import('./entityStore');
      const profile: any = (useEntityStore.getState() as any).profiles?.[actorId];
      if (profile && typeof profile.emoji === 'string' && profile.emoji.length > 0) {
        emoji = profile.emoji;
      }
    }
  } catch {
    // No profile cached, or the store shape changed. The kind-based glyph is a fine answer.
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { useInAppAlert } = require('../store/inAppAlertStore') as typeof import('../store/inAppAlertStore');
  // `'push'` marks this as the FALLBACK producer. `RealtimeAccountBridge` is primary — it is
  // platform-independent (the reason the pill appeared on iPhone but not on Android when it was fed only
  // from here) and carries the sender's emoji, name and preview text, none of which are in a push
  // payload. The store drops a push-sourced alert while the bridge is delivering; see its
  // producer-precedence note.
  useInAppAlert.getState().push(
    {
      kind,
      emoji,
      name,
      actorId,
      targetId:
        (typeof data?.conversation_id === 'string' && data.conversation_id) ||
        (typeof data?.post_id === 'string' && data.post_id) ||
        undefined,
    },
    'push',
  );
}

/** Foreground presentation: show banner + play sound, don't touch the badge. */
export function configureNotificationHandler(): void {
  const mods = getModules();
  if (!mods || handlerConfigured) return;
  handlerConfigured = true;
  try {
    mods.Notifications.setNotificationHandler({
      handleNotification: async (notification: any) => {
        // ── IN THE FOREGROUND, THE OS BANNER IS REPLACED BY THE IN-APP PILL ────
        //
        // Requested: while the user is inside the app, do not show a push banner — show an in-app
        // alert instead, starting as the actor's emoji in a circle and expanding outward.
        //
        // The thread-level `shouldPresent` check below stays and still runs first, because a message
        // for the chat already on screen deserves NEITHER a banner nor a pill: the message is being
        // rendered into the transcript at that same moment, which is the whole argument in the note
        // above. So suppression is layered — thread first, then foreground.
        //
        // `handleNotification` is a plain native callback with no component to talk to, which is why
        // the pill is fed through a store. Wrapped in its own try/catch: a failure to show an ambient
        // alert must never change what the OS does with the notification.
        // ── PER-CATEGORY PREFERENCE, APPLIED AS A THIRD LAYER ──────────────────
        //
        // Suppression order is thread → category → foreground, and the order matters. The thread
        // check is about redundancy (you are looking at the message), the category check is about
        // consent (you asked not to be told about this kind), and the foreground check is only about
        // WHICH surface presents it. A muted category is suppressed on every surface, including the
        // Notification Centre entry — `shouldShowList` follows it below, because a "muted" event that
        // still stacks up in the shade is not muted in any sense the user would recognise.
        //
        // What this cannot do is stop the push being SENT. See the note on `notifyCategories`: the
        // Worker has no category parameter and `push_tokens` has no preference column, so while the
        // app is not running the OS still renders the payload. The settings screen says so rather
        // than implying otherwise.
        const present = shouldPresent(notification) && categoryAllowed(notification);
        const inForeground = AppState.currentState === 'active';
        if (present && inForeground) {
          try {
            enqueueInAppAlert(notification);
          } catch {
            // An alert that cannot be queued simply does not appear.
          }
        }
        return {
          // Foreground: the pill is the presentation, so the OS banner is stood down. Background or
          // inactive: unchanged behaviour, the OS banner is the only thing that can be seen.
          shouldShowBanner: present && !inForeground,
          shouldPlaySound: present,
          // Kept true for a THREAD suppression: the banner is redundant because the user is looking
          // at the message, but the Notification Centre entry is the record that it arrived, and
          // removing that would lose history rather than reduce noise.
          //
          // Dropped for a CATEGORY suppression, which is a different judgement — the user asked not
          // to be told about this kind at all, so leaving it in the shade would keep exactly the
          // notification they turned off. `categoryAllowed` is re-evaluated rather than reusing
          // `present`, so a thread-suppressed message still keeps its history entry.
          shouldShowList: categoryAllowed(notification),
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

/**
 * This install's Expo push token, as last accepted by the Worker, or `''`.
 *
 * Exists so the Devices screen can mark one row as "this device" without a second round-trip: the
 * stored value is byte-identical to the `push_tokens` primary key the list endpoint returns.
 *
 * An accessor rather than exporting `TOKEN_SENT_KEY`, so the MMKV key stays owned by this module —
 * a consumer that knew the key could write it, and a wrong value here would make the app skip
 * registration entirely (`registerForPush` treats a match as "already sent").
 *
 * Empty in three legitimate cases the caller must handle: notification permission was never granted,
 * the build has no native module (simulator / bare OTA), or the user has logged out since. In all
 * three the screen simply marks no row as current.
 */
export function getRegisteredPushToken(): string {
  try {
    return kvGetStringRawSync(TOKEN_SENT_KEY) || '';
  } catch {
    return '';
  }
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
