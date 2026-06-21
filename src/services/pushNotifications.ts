import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { apiPost } from './apiClient';
import { kvGetStringRawSync, kvSetStringRaw } from './kvStore';
import { useSettingsStore } from '../store/settingsStore';

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

/** Foreground presentation: show banner + play sound, don't touch the badge. */
export function configureNotificationHandler(): void {
  const mods = getModules();
  if (!mods || handlerConfigured) return;
  handlerConfigured = true;
  try {
    mods.Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
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
