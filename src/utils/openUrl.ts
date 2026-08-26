import { Linking } from 'react-native';
import { router } from 'expo-router';
import { useSettingsStore } from '../store/settingsStore';
import { resolveInAppHref } from './appLinks';

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

  // ── OUR OWN CONTENT OPENS IN OUR OWN APP ───────────────────────────────────
  //
  // This is the single choke point every tapped link in the app goes through — `FormattedText` links,
  // both context menus, profile bio links, link previews. Before this check, a link to our own content
  // was treated exactly like a link to a stranger's website: `/browser` (a WebView) or Safari. Tapping
  // a shared post therefore showed the reader our marketing page for a post they have an account for.
  //
  // Expo Router documents WHY this happens, and it is not accidental — a fully-qualified http/https
  // href is deliberately routed to the browser, because that is the documented way to force a web link.
  // Staying in-app means resolving the URL to a relative route first, which is what `resolveInAppHref`
  // does. https://docs.expo.dev/router/advanced/native-intent/ (§ Forcing web links)
  //
  // Placed BEFORE the settings lookup on purpose: "open links in the in-app browser" is a preference
  // about OTHER PEOPLE'S websites. It should not be able to send our own post to a WebView, in either
  // position.
  const inApp = resolveInAppHref(fullUrl);
  if (inApp) {
    router.push(inApp);
    return;
  }

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
