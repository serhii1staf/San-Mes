import { Linking } from 'react-native';
import { router } from 'expo-router';
import { useSettingsStore } from '../store/settingsStore';

/**
 * Normalize a URL to https.
 * - Upgrades a leading `http://` scheme to `https://` (cleartext hardening).
 * - Prefixes `https://` when no scheme is present.
 * - Leaves an existing `https://` untouched.
 */
function normalizeToHttps(url: string): string {
  if (url.startsWith('https://')) {
    return url;
  }
  if (url.startsWith('http://')) {
    // Replace only the leading scheme, preserve the rest of the URL.
    return `https://${url.slice('http://'.length)}`;
  }
  return `https://${url}`;
}

export function openUrl(url: string) {
  const fullUrl = normalizeToHttps(url);
  const { useInAppBrowser } = useSettingsStore.getState();

  // Defensive guard: never hand a non-https value to Linking.openURL directly.
  // Route anything unexpected through the in-app /browser, which has its own
  // scheme hardening, falling back to a safe no-op only if that path is unavailable.
  const isHttps = fullUrl.startsWith('https://');

  if (useInAppBrowser || !isHttps) {
    router.push({ pathname: '/browser', params: { url: encodeURIComponent(fullUrl) } });
  } else {
    Linking.openURL(fullUrl);
  }
}
