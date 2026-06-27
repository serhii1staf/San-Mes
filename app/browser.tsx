import React, { useState, useRef, useEffect } from 'react';
import { View, Pressable, ActivityIndicator, ViewStyle, Linking, Alert } from 'react-native';
import { WebView } from 'react-native-webview';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../src/theme';
import { Text } from '../src/components/ui';
import { useBrowserStore } from '../src/store/browserStore';
import { t } from '../src/i18n/store';

// ── WebView navigation hardening helpers (anti-malware / anti-phishing) ──────
// Pure functions (no hooks) so they don't affect React hook order/count.

// Executable / installer extensions we must never let a linked page download —
// distributing these would turn the app into a malware vector. Matched against
// the URL path with query/hash stripped.
const EXECUTABLE_DOWNLOAD_RE = /\.(ipa|apk|exe|dmg|pkg|msi|bat|sh|scr)$/i;

function isExecutableDownload(rawUrl: string): boolean {
  let path = rawUrl;
  try { path = new URL(rawUrl).pathname; } catch { path = rawUrl.split('#')[0].split('?')[0]; }
  return EXECUTABLE_DOWNLOAD_RE.test(path);
}

// External / custom schemes are NEVER auto-opened — always confirm first.
function confirmExternalOpen(u: string) {
  Alert.alert(
    t('mini_app.external_link_title', 'Открыть ссылку? / Open link?'),
    t('mini_app.external_link_message', '{url}', { url: u }),
    [
      { text: t('common.cancel', 'Отмена / Cancel'), style: 'cancel' },
      { text: t('common.open', 'Открыть / Open'), onPress: () => { Linking.openURL(u).catch(() => {}); } },
    ],
  );
}

export default function BrowserScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { url } = useLocalSearchParams<{ url: string }>();
  const [isLoading, setIsLoading] = useState(true);
  const [currentUrl, setCurrentUrl] = useState(url || '');
  const [canGoBack, setCanGoBack] = useState(false);
  const webViewRef = useRef<WebView>(null);
  const closedManually = useRef(false);
  // Field-level selectors — destructuring re-rendered the whole browser
  // screen on every unrelated browser-store change.
  const setMinimized = useBrowserStore((s) => s.setMinimized);
  const clearMinimized = useBrowserStore((s) => s.clearMinimized);

  // Clear minimized state when browser opens (user tapped the mini-bar)
  useEffect(() => {
    clearMinimized();
  }, []);

  // When modal is dismissed via swipe (not X button), minimize to bar.
  // We deliberately defer the `setMinimized` flip past the iOS dismiss
  // animation (`presentation: 'modal' / slide_from_bottom` ≈ 280 ms) so
  // the bottom widget rises into place AFTER the page finishes sliding
  // away — without the timeout the widget popped in instantly while the
  // page was still mid-animation, racing the dismissal and reading as a
  // visual glitch. We snapshot the URL at gesture-start because the
  // screen is already unmounting by the time the timer fires.
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', () => {
      if (!closedManually.current) {
        const url = currentUrl || decodedUrl;
        const domain = displayDomain;
        setTimeout(() => {
          setMinimized(url, domain);
        }, 280);
      }
    });
    return unsubscribe;
  }, [navigation, currentUrl]);

  const handleClose = () => {
    closedManually.current = true;
    clearMinimized();
    router.back();
  };

  const decodedUrl = (() => {
    try {
      const decoded = decodeURIComponent(url || '');
      // Validate it's a proper URL
      if (decoded.startsWith('http://') || decoded.startsWith('https://')) return decoded;
      return `https://${decoded}`;
    } catch {
      return url || 'https://google.com';
    }
  })();

  // Extract domain for display
  const displayDomain = (() => {
    try {
      return new URL(decodedUrl).hostname.replace('www.', '');
    } catch {
      return decodedUrl;
    }
  })();

  // Navigation guard — pages opened here come from posts/chats and are
  // untrusted. Block the local-file / script-injection schemes outright and
  // hand non-web schemes (tel:, mailto:, app deep links, …) to the OS instead
  // of loading them in-webview. http/https/blob/about/data load normally (this
  // is a general-purpose browser, unlike the https-only mini-app sandbox).
  const onShouldStartLoadWithRequest = (req: { url: string; isTopFrame?: boolean }) => {
    const u = req?.url || '';
    const lower = u.toLowerCase();
    // iOS provides isTopFrame; on Android it's undefined — treat unknown as
    // top-level so the strict guards still apply.
    const isTopFrame = req?.isTopFrame !== false;

    // Anti-malware: block executable/installer downloads on ANY scheme.
    if (isExecutableDownload(u)) {
      Alert.alert(
        t('mini_app.blocked_download_title', 'Download blocked'),
        t('mini_app.blocked_download_message', "This link points to a file that can't be opened safely in the app."),
      );
      return false;
    }

    // Hard-blocked schemes: local file access + script injection.
    if (lower.startsWith('file:') || lower.startsWith('javascript:')) return false;

    // Top-level data: URLs are a phishing/exfil vector — block (allow only as
    // subframe content, e.g. inline images/iframes the page renders itself).
    if (lower.startsWith('data:')) return !isTopFrame;

    // http: upgrade top-level navigations to https instead of loading cleartext.
    if (lower.startsWith('http://')) {
      if (isTopFrame) {
        const upgraded = 'https://' + u.slice('http://'.length);
        webViewRef.current?.injectJavaScript(`window.location.replace(${JSON.stringify(upgraded)}); true;`);
      }
      return false;
    }

    // https / blob / about load normally (general-purpose browser).
    if (lower.startsWith('https://') || lower.startsWith('blob:') || lower.startsWith('about:')) return true;

    // Our own deep-link scheme must never be driven by untrusted web content.
    if (lower.startsWith('san-mes://')) return false;

    // Every external/custom scheme (tel:, mailto:, sms:, app-store, deep links):
    // NEVER auto-open — require explicit user confirmation before handing to OS.
    // The WebView itself never navigates there (we always return false).
    confirmExternalOpen(u);
    return false;
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
      {/* Header bar */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingTop: insets.top,
          paddingBottom: 10,
          paddingHorizontal: 12,
          backgroundColor: theme.colors.background.elevated,
          borderBottomWidth: 0.5,
          borderBottomColor: theme.colors.border.light,
        }}
      >
        {/* Close button */}
        <Pressable onPress={handleClose} style={{ padding: 8 }}>
          <Feather name="x" size={22} color={theme.colors.text.primary} />
        </Pressable>

        {/* Back button */}
        <Pressable
          onPress={() => webViewRef.current?.goBack()}
          style={{ padding: 8, opacity: canGoBack ? 1 : 0.3 }}
          disabled={!canGoBack}
        >
          <Feather name="chevron-left" size={22} color={theme.colors.text.primary} />
        </Pressable>

        {/* URL bar */}
        <View
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: theme.colors.background.secondary,
            borderRadius: 10,
            paddingHorizontal: 12,
            paddingVertical: 8,
            marginHorizontal: 8,
          }}
        >
          <Feather name="lock" size={12} color={theme.colors.text.tertiary} style={{ marginRight: 6 }} />
          <Text variant="caption" color={theme.colors.text.secondary} numberOfLines={1} style={{ flex: 1 }}>
            {displayDomain}
          </Text>
          {isLoading && <ActivityIndicator size="small" color={theme.colors.accent.primary} style={{ marginLeft: 6 }} />}
        </View>

        {/* Reload */}
        <Pressable onPress={() => webViewRef.current?.reload()} style={{ padding: 8 }}>
          <Feather name="refresh-cw" size={18} color={theme.colors.text.secondary} />
        </Pressable>
      </View>

      {/* WebView */}
      <WebView
        ref={webViewRef}
        source={{ uri: decodedUrl }}
        style={{ flex: 1 }}
        onLoadStart={() => setIsLoading(true)}
        onLoadEnd={() => setIsLoading(false)}
        onNavigationStateChange={(navState) => {
          setCanGoBack(navState.canGoBack);
          setCurrentUrl(navState.url);
        }}
        allowsBackForwardNavigationGestures
        javaScriptEnabled
        domStorageEnabled
        onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
        // Defense-in-depth: never grant local-file access to remote pages
        // (OWASP MASTG local-file-inclusion / universal-XSS vector).
        allowFileAccess={false}
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
        mixedContentMode="never"
      />
    </View>
  );
}
