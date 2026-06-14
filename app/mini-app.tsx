import React, { useRef, useState } from 'react';
import { View, Pressable, ActivityIndicator, Share } from 'react-native';
import { WebView } from 'react-native-webview';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { Text } from '../src/components/ui';
import { SlideUpSheet } from '../src/components/ui/SlideUpSheet';
import { useBrowserStore } from '../src/store/browserStore';
import { useMiniAppsStore } from '../src/store/miniAppsStore';
import { buildMiniAppShareUrl } from '../src/utils/miniAppShare';
import { useT } from '../src/i18n/store';
import { triggerHaptic } from '../src/utils/haptics';
import { showToast } from '../src/store/toastStore';
import { useTheme } from '../src/theme';

// Mini-app screen — opens a third-party URL inside an in-app WebView. The
// floating top-bar buttons match the profile-screen visual language: small
// pill capsules with a frosted BlurView background so they read on any
// page colour without competing with the page content.
//
// Three actions on the bar:
//   - Свернуть: keeps the session alive in the global "minimised app" bar
//   - Закрыть: terminates the session
//   - Flag (right-most): opens the standard report sheet — App Store
//     Guideline 1.2 requires user-generated/third-party content to be
//     reportable, and a mini-app's URL is effectively user-supplied.

// Report categories live as STABLE keys; their visible labels come from
// the existing `report.cat.*` dictionary entries via t() at render time.
const REPORT_CATS: { key: string; labelKey: string }[] = [
  { key: 'spam', labelKey: 'report.cat.spam' },
  { key: 'violence', labelKey: 'report.cat.violence' },
  { key: 'misinformation', labelKey: 'report.cat.misinformation' },
  { key: 'fraud', labelKey: 'report.cat.fraud' },
  { key: 'copyright', labelKey: 'report.cat.copyright' },
  { key: 'other', labelKey: 'report.cat.other' },
];

export default function MiniAppScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const t = useT();
  const { url, name, emoji, id } = useLocalSearchParams<{ url: string; name: string; emoji: string; id?: string }>();
  const webViewRef = useRef<WebView>(null);
  const [currentUrl, setCurrentUrl] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [reportOpen, setReportOpen] = useState(false);
  const loadTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Safety net: if the page never fires onLoadEnd (e.g. the device is offline
  // and the request hangs), force the loading overlay off after 8 s so the
  // close/minimise buttons aren't stuck behind an endless spinner. Without
  // this the user has to kill the whole app to escape a hung mini-app.
  const armLoadTimeout = () => {
    if (loadTimeout.current) clearTimeout(loadTimeout.current);
    loadTimeout.current = setTimeout(() => setIsLoading(false), 8000);
  };
  React.useEffect(() => {
    armLoadTimeout();
    return () => { if (loadTimeout.current) clearTimeout(loadTimeout.current); };
  }, []);
  const stopLoading = () => {
    if (loadTimeout.current) { clearTimeout(loadTimeout.current); loadTimeout.current = null; }
    setIsLoading(false);
  };

  // Decode URL properly — handle double encoding and trim whitespace
  const decodedUrl = (() => {
    let raw = (url || '').trim();
    // Decode until no more encoding
    for (let i = 0; i < 3; i++) {
      try {
        const decoded = decodeURIComponent(raw);
        if (decoded === raw) break;
        raw = decoded;
      } catch { break; }
    }
    raw = raw.trim();
    if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
    if (raw.includes('.')) return `https://${raw}`;
    return `https://${raw}`;
  })();

  const displayName = name || 'App';
  const appEmoji = emoji || '📱';

  // Resolve the public mini-app id used for sharing. Most call sites
  // (settings list, search, FAB, push notifications) push us with the id
  // in params; the minimised-bar call sites only carry url+name+emoji, so
  // we fall back to a URL match against the local store. If neither
  // works, the share button hides itself rather than expose the raw URL.
  const shareableId = (() => {
    const fromParams = (id || '').trim();
    if (fromParams) return fromParams;
    const apps = useMiniAppsStore.getState().apps;
    const byUrl = apps.find((a) => a.url === decodedUrl);
    return byUrl?.id || '';
  })();
  const canShare = !!shareableId;

  const handleMinimize = () => {
    // Pop the mini-app screen FIRST, then flip the minimized state ~1
    // dismiss duration later. Doing both on the same tap (the previous
    // sequence: setMinimized → router.back()) made the bottom widget
    // pop in INSTANTLY at the bottom of the screen while the mini-app
    // surface above was still mid-slide-down — the widget appearance
    // raced ahead of the iOS dismiss animation, so the user saw the
    // pill flash in before the page they came from had finished
    // leaving. Deferring `setMinimized` past the dismiss animation
    // (`fullScreenModal` slide_from_bottom takes ~280 ms on iOS) lines
    // the two up: the page slides off, then the widget rises into
    // place, in sequence rather than overlapping.
    const url = currentUrl || decodedUrl;
    router.back();
    setTimeout(() => {
      useBrowserStore.getState().setMinimized(url, displayName, true, appEmoji);
    }, 280);
  };

  const handleClose = () => {
    useBrowserStore.getState().clearMinimized();
    router.back();
  };

  const handleReport = (_categoryKey: string) => {
    triggerHaptic('medium');
    setReportOpen(false);
    showToast(t('toast.report_sent'), 'flag');
  };

  // Share — produces an internal short share URL via buildMiniAppShareUrl.
  // The underlying third-party URL the WebView proxies to is intentionally
  // NOT included; resolution happens server-side via the SSR page at
  // api/m/[short].ts (which also keeps the URL out of its HTML).
  const handleShare = async () => {
    if (!canShare) return;
    triggerHaptic('light');
    try {
      await Share.share({
        message: `${appEmoji} ${displayName}\n${buildMiniAppShareUrl({ id: shareableId })}`,
      });
    } catch {}
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      {/* Loading overlay on black bg to prevent white flash. pointerEvents
          "none" so it never swallows taps meant for the floating top
          buttons — critical when offline, where the overlay would otherwise
          trap the user behind an endless spinner. */}
      {isLoading && (
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000', zIndex: 40, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color="#FFFFFF" />
        </View>
      )}

      {/* Full-screen WebView */}
      <WebView
        ref={webViewRef}
        source={{ uri: decodedUrl }}
        style={{ flex: 1, backgroundColor: '#000' }}
        onLoadStart={() => { setIsLoading(true); armLoadTimeout(); }}
        onLoadEnd={stopLoading}
        onNavigationStateChange={(navState) => setCurrentUrl(navState.url)}
        onError={stopLoading}
        onHttpError={stopLoading}
        renderError={(_errorDomain, _errorCode, errorDesc) => (
          <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
            <Text style={{ fontSize: 16, color: '#FFFFFF', fontWeight: '600', marginBottom: 8 }}>{t('mini_app.load_failed')}</Text>
            <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', textAlign: 'center' }}>{errorDesc}</Text>
            <Pressable onPress={() => webViewRef.current?.reload()} style={{ marginTop: 16, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.1)' }}>
              <Text style={{ fontSize: 12, color: '#FFFFFF' }}>{t('common.retry')}</Text>
            </Pressable>
          </View>
        )}
        allowsBackForwardNavigationGestures
        javaScriptEnabled
        domStorageEnabled
        bounces={true}
        scrollEnabled={true}
        decelerationRate="normal"
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        allowsFullscreenVideo
        sharedCookiesEnabled={true}
        thirdPartyCookiesEnabled={true}
        cacheEnabled={true}
        javaScriptCanOpenWindowsAutomatically={true}
        mixedContentMode="always"
        originWhitelist={['*']}
        setSupportMultipleWindows={false}
        allowFileAccess={true}
        allowUniversalAccessFromFileURLs={true}
        geolocationEnabled={true}
        startInLoadingState={false}
        injectedJavaScript={`
          // Enable viewport meta for proper scaling
          if (!document.querySelector('meta[name="viewport"]')) {
            var meta = document.createElement('meta');
            meta.name = 'viewport';
            meta.content = 'width=device-width, initial-scale=1, maximum-scale=5, user-scalable=yes';
            document.head.appendChild(meta);
          }
          true;
        `}
        userAgent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
      />

      {/* Floating top buttons — frosted BlurView capsules matching the
          profile screen's QR/edit pill style. Compact icon-only buttons:
          Свернуть (chevron) on the left, flag + close grouped on the right.
          zIndex 60 keeps them ABOVE the loading overlay (zIndex 40) so they
          stay tappable even while a page is loading or hung offline. */}
      <View style={{ position: 'absolute', top: insets.top + 8, left: 16, right: 16, zIndex: 60, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Pressable onPress={handleMinimize} style={{ borderRadius: 14, overflow: 'hidden' }}>
          <BlurView intensity={80} tint="dark" style={{ height: 28, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10 }}>
            <Feather name="chevron-down" size={12} color="#FFFFFF" />
            <Text style={{ fontSize: 10, color: '#FFFFFF', fontWeight: '500' }}>{t('mini_app.collapse')}</Text>
          </BlurView>
        </Pressable>
        <View style={{ borderRadius: 14, overflow: 'hidden' }}>
          <BlurView intensity={80} tint="dark" style={{ height: 28, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 12 }}>
            {canShare ? (
              <Pressable onPress={handleShare} hitSlop={6}>
                <Feather name="share" size={13} color="#FFFFFF" />
              </Pressable>
            ) : null}
            <Pressable onPress={() => { triggerHaptic('light'); setReportOpen(true); }} hitSlop={6}>
              <Feather name="flag" size={13} color="#FFFFFF" />
            </Pressable>
            <Pressable onPress={handleClose} hitSlop={6}>
              <Feather name="x" size={14} color="#FFFFFF" />
            </Pressable>
          </BlurView>
        </View>
      </View>

      {/* Report sheet — uses the same Modal-based pattern as SlideUpSheet but
          we call it directly so the visual matches the feed's PostMenuModal
          (same marginH 8, marginB 16, borderRadius 40). On the mini-app screen
          we skip the StatusBar hidden inside SlideUpSheet because the WebView
          already hides it; doubling up can confuse Android. */}
      <SlideUpSheet visible={reportOpen} onClose={() => setReportOpen(false)}>
        <View style={{ paddingBottom: 8 }}>
          <Text variant="body" weight="semibold" align="center" style={{ paddingVertical: 10 }}>{t('report.title')}</Text>
          <Text variant="caption" color={theme.colors.text.tertiary} align="center" style={{ paddingHorizontal: 24, paddingBottom: 10, fontSize: 12 }}>
            {t('mini_app.report_about', undefined, { name: displayName })}
          </Text>
          {REPORT_CATS.map((cat) => (
            <Pressable
              key={cat.key}
              onPress={() => handleReport(cat.key)}
              style={{ paddingVertical: 14, paddingHorizontal: 20, borderTopWidth: 0.5, borderTopColor: theme.colors.border.light }}
            >
              <Text variant="body">{t(cat.labelKey)}</Text>
            </Pressable>
          ))}
        </View>
      </SlideUpSheet>
    </View>
  );
}
