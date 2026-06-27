import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { View, Pressable, ActivityIndicator, Share, Linking, BackHandler, Animated, Dimensions, Easing, Alert } from 'react-native';
import { WebView } from 'react-native-webview';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { Text } from './Text';
import { useLiquidGlassActive, NativeGlassView } from './LiquidGlass';
import { SlideUpSheet } from './SlideUpSheet';
import { useMiniAppStore } from '../../store/miniAppStore';
import { useBrowserStore } from '../../store/browserStore';
import { useMiniAppsStore } from '../../store/miniAppsStore';
import { buildMiniAppShareUrl } from '../../utils/miniAppShare';
import { useT } from '../../i18n/store';
import { triggerHaptic } from '../../utils/haptics';
import { showToast } from '../../store/toastStore';
import { submitReport } from '../../services/moderation';
import { useTheme } from '../../theme';

const SCREEN_H = Dimensions.get('window').height;

// Root-level persistent mini-app host. See src/store/miniAppStore.ts for the
// state machine. The WebView is mounted while mode !== 'closed' and is NEVER
// torn down on minimize — minimizing just parks the overlay off-screen
// (translateY) at opacity 0 with pointerEvents 'none', keeping its zIndex
// STABLE (no reorder repaint), so the page keeps its scroll/section/JS state
// and restoring is instant with no reload.

const REPORT_CATS: { key: string; labelKey: string }[] = [
  { key: 'spam', labelKey: 'report.cat.spam' },
  { key: 'violence', labelKey: 'report.cat.violence' },
  { key: 'misinformation', labelKey: 'report.cat.misinformation' },
  { key: 'fraud', labelKey: 'report.cat.fraud' },
  { key: 'copyright', labelKey: 'report.cat.copyright' },
  { key: 'other', labelKey: 'report.cat.other' },
];

function normalizeUrl(raw0: string): string {
  let raw = (raw0 || '').trim();
  for (let i = 0; i < 3; i++) {
    try {
      const decoded = decodeURIComponent(raw);
      if (decoded === raw) break;
      raw = decoded;
    } catch { break; }
  }
  raw = raw.trim();
  if (/^https:\/\//i.test(raw)) return raw;
  if (/^http:\/\//i.test(raw)) return 'https://' + raw.slice(raw.indexOf('://') + 3);
  return `https://${raw}`;
}

export function MiniAppHost() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const t = useT();
  const glassActive = useLiquidGlassActive();

  const mode = useMiniAppStore((s) => s.mode);
  const url = useMiniAppStore((s) => s.url);
  const name = useMiniAppStore((s) => s.name);
  const emoji = useMiniAppStore((s) => s.emoji);
  const id = useMiniAppStore((s) => s.id);
  const sessionKey = useMiniAppStore((s) => s.sessionKey);

  const webViewRef = useRef<WebView>(null);
  const [currentUrl, setCurrentUrl] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [reportOpen, setReportOpen] = useState(false);
  const loadTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const decodedUrl = useMemo(() => normalizeUrl(url), [url]);

  // Reset transient UI when a NEW session starts (different app opened).
  useEffect(() => {
    setIsLoading(true);
    setCurrentUrl('');
    setReportOpen(false);
  }, [sessionKey]);

  const armLoadTimeout = useCallback(() => {
    if (loadTimeout.current) clearTimeout(loadTimeout.current);
    loadTimeout.current = setTimeout(() => setIsLoading(false), 8000);
  }, []);
  const stopLoading = useCallback(() => {
    if (loadTimeout.current) { clearTimeout(loadTimeout.current); loadTimeout.current = null; }
    setIsLoading(false);
  }, []);
  useEffect(() => () => { if (loadTimeout.current) clearTimeout(loadTimeout.current); }, []);

  // Slide the overlay UP on open/restore and DOWN on minimize/close.
  //
  // The overlay's stacking (zIndex / elevation) and background are kept STABLE
  // for the entire lifetime of a session — they are NEVER toggled at the end of
  // an animation. On Android, reordering an absolutely-positioned view's zIndex
  // (the old 9999 → -1 flip when minimize finished) forces a one-frame
  // repaint, which is exactly the blink/artifact the user saw. Instead the
  // overlay is "parked" purely by sliding it fully off-screen (translateY) and
  // fading it out (opacity → 0), both driven by the SAME native-driver value
  // below, so there is no JS-side style commit at the end of the slide.
  const slideY = useRef(new Animated.Value(SCREEN_H)).current;

  useEffect(() => {
    if (mode === 'full') {
      // Open / restore. Starting a new timing on slideY implicitly cancels any
      // in-flight minimize/close slide, so a quick restore mid-collapse simply
      // reverses cleanly from the CURRENT position — no stale state.
      Animated.timing(slideY, { toValue: 0, duration: 400, easing: Easing.bezier(0.16, 1, 0.3, 1), useNativeDriver: true }).start();
      try { useBrowserStore.getState().clearMinimized(); } catch {}
    } else if (mode === 'min') {
      Animated.timing(slideY, { toValue: SCREEN_H, duration: 340, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(({ finished }) => {
        // Bail if the slide was interrupted (e.g. user restored / closed
        // mid-collapse) — the new transition owns the value now.
        if (!finished) return;
        // Re-check the live mode: even a NATURALLY finished slide must no-op if
        // the session is no longer minimized by the time this fires (a close or
        // restore could have landed on the final frame). This prevents the
        // familiar widget from popping in for a stale 'min' that already moved on.
        if (useMiniAppStore.getState().mode !== 'min') return;
        // Reveal the user's FAMILIAR minimized widget (BrowserMiniBar /
        // BrowserBottomBand) ONLY AFTER the collapse finishes, so the widget
        // never appears while the window is still sliding down.
        try {
          const st = useMiniAppStore.getState();
          useBrowserStore.getState().setMinimized(normalizeUrl(st.url), st.name, true, st.emoji);
        } catch {}
      });
    }
  }, [mode, slideY]);

  // While minimized, dismissing the widget (its x / swipe-away) clears
  // browserStore — observe that and tear the live WebView down so the two
  // stores never drift out of sync.
  useEffect(() => {
    if (mode !== 'min') return;
    const unsub = useBrowserStore.subscribe((s) => {
      // Only treat a cleared widget as a genuine user-dismiss while we are
      // STILL minimized. Restore (and close) clear the widget themselves via
      // clearMinimized(), but by then the mode has already moved off 'min' —
      // without this guard that self-inflicted clear would fire close() in the
      // middle of a restore, tearing the WebView down right as it slides back
      // up (the rapid open/close the user reported).
      if (!s.minimizedUrl && useMiniAppStore.getState().mode === 'min') {
        useMiniAppStore.getState().close();
      }
    });
    return unsub;
  }, [mode]);

  // Animate the overlay down before tearing the WebView down (matches the old
  // dismiss feel), then clear the familiar widget too.
  const requestClose = useCallback(() => {
    triggerHaptic('light');
    Animated.timing(slideY, { toValue: SCREEN_H, duration: 320, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => {
      useMiniAppStore.getState().close();
      try { useBrowserStore.getState().clearMinimized(); } catch {}
    });
  }, [slideY]);

  // Hardware back (Android): while fullscreen, back minimizes the mini-app
  // (Telegram-style) instead of leaving it on screen. No-op otherwise.
  useEffect(() => {
    if (mode !== 'full') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      useMiniAppStore.getState().minimize();
      return true;
    });
    return () => sub.remove();
  }, [mode]);

  const onShouldStartLoadWithRequest = useCallback((req: { url: string }) => {
    const u = (req?.url || '');
    const lower = u.toLowerCase();
    if (u === 'about:blank' || lower.startsWith('about:')) return true;
    if (lower.startsWith('https://')) return true;
    if (lower.startsWith('blob:')) return true;
    if (lower.startsWith('http://')) return false;
    if (lower.startsWith('file:') || lower.startsWith('javascript:') || lower.startsWith('data:')) return false;
    // Allowlist of safe external schemes that may open WITHOUT confirmation.
    if (lower.startsWith('tel:') || lower.startsWith('mailto:') || lower.startsWith('sms:')) {
      Linking.openURL(u).catch(() => {});
      return false;
    }
    // Never let untrusted mini-app content drive in-app navigation/redirects
    // via our own scheme — silently ignore it.
    if (lower.startsWith('san-mes://')) return false;
    // Any OTHER unknown scheme: confirm with the user before leaving the app.
    // The WebView itself never navigates there (we always return false).
    Alert.alert(
      t('mini_app.external_link_title', 'Открыть ссылку? / Open link?'),
      t('mini_app.external_link_message', '{url}', { url: u }),
      [
        { text: t('common.cancel', 'Отмена / Cancel'), style: 'cancel' },
        { text: t('common.open', 'Открыть / Open'), onPress: () => { Linking.openURL(u).catch(() => {}); } },
      ],
    );
    return false;
  }, [t]);

  const displayName = name || 'App';
  const appEmoji = emoji || '📱';

  const shareableId = (() => {
    const fromParams = (id || '').trim();
    if (fromParams) return fromParams;
    const apps = useMiniAppsStore.getState().apps;
    const byUrl = apps.find((a) => a.url === decodedUrl);
    return byUrl?.id || '';
  })();
  const canShare = !!shareableId;

  const handleShare = async () => {
    if (!canShare) return;
    triggerHaptic('light');
    try {
      await Share.share({ message: `${appEmoji} ${displayName}\n${buildMiniAppShareUrl({ id: shareableId })}` });
    } catch {}
  };
  const handleReport = (categoryKey: string) => {
    triggerHaptic('medium');
    setReportOpen(false);
    if (shareableId) {
      void submitReport({ targetType: 'mini_app', targetId: shareableId, category: categoryKey });
    }
    showToast(t('toast.report_sent'), 'flag');
  };

  if (mode === 'closed') return null;

  const full = mode === 'full';

  return (
    <>
      {/* WebView overlay — kept mounted across minimize. zIndex + background
          are STABLE for the whole session (no zIndex flip → no repaint flash),
          and it is parked purely by sliding fully off-screen via translateY.
          IMPORTANT: do NOT put an `opacity` on this container — a parent alpha
          breaks the native liquid-glass (UIVisualEffectView) on the overlay
          buttons (the effect silently stops rendering). Off-screen translateY
          alone keeps the parked overlay invisible. */}
      <Animated.View
        pointerEvents={full ? 'auto' : 'none'}
        style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          zIndex: 9999,
          backgroundColor: '#000',
          transform: [{ translateY: slideY }],
        }}
      >
        {isLoading && (
          <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000', zIndex: 40, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator size="large" color="#FFFFFF" />
          </View>
        )}

        <WebView
          key={sessionKey}
          ref={webViewRef}
          source={{ uri: decodedUrl }}
          style={{ flex: 1, backgroundColor: '#000' }}
          onLoadStart={() => { setIsLoading(true); armLoadTimeout(); }}
          onLoadEnd={stopLoading}
          onNavigationStateChange={(navState) => setCurrentUrl(navState.url)}
          onError={stopLoading}
          onHttpError={stopLoading}
          onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
          renderError={(_d, _c, errorDesc) => (
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
          bounces
          scrollEnabled
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          allowsFullscreenVideo
          sharedCookiesEnabled={false}
          thirdPartyCookiesEnabled={false}
          cacheEnabled
          javaScriptCanOpenWindowsAutomatically={false}
          setSupportMultipleWindows={false}
          mixedContentMode="never"
          originWhitelist={['https://*']}
          allowFileAccess={false}
          allowFileAccessFromFileURLs={false}
          allowUniversalAccessFromFileURLs={false}
          geolocationEnabled={false}
          startInLoadingState={false}
          injectedJavaScript={`
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

        {full ? (
          <View style={{ position: 'absolute', top: insets.top + 8, left: 16, right: 16, zIndex: 60, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            {/* Collapse pill. Glass is rendered as a BACKGROUND layer (GlassBg)
                with the icon+label as SIBLINGS on top — the codebase's proven
                pattern. Putting content INSIDE a GlassView made the glass
                collapse/disappear (and warp content). A dark tint keeps the
                glass visible over the WebView, which the effect can't sample. */}
            {/* Collapse / actions pills. Restored to the ORIGINAL structure
                (content INSIDE NativeGlassView) — this is what rendered real
                liquid glass before. The earlier GlassBg rewrite + the parent
                `opacity` (now removed) were what killed the effect. */}
            <Pressable onPress={() => { triggerHaptic('light'); useMiniAppStore.getState().minimize(); }} style={glassActive ? { borderRadius: 14 } : { borderRadius: 14, overflow: 'hidden' }}>
              {glassActive ? (
                <NativeGlassView glassStyle="regular" isInteractive colorScheme="dark" style={{ height: 28, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, borderRadius: 14 }}>
                  <Feather name="chevron-down" size={12} color="#FFFFFF" />
                  <Text style={{ fontSize: 10, color: '#FFFFFF', fontWeight: '500' }}>{t('mini_app.collapse')}</Text>
                </NativeGlassView>
              ) : (
                <BlurView intensity={80} tint="dark" style={{ height: 28, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10 }}>
                  <Feather name="chevron-down" size={12} color="#FFFFFF" />
                  <Text style={{ fontSize: 10, color: '#FFFFFF', fontWeight: '500' }}>{t('mini_app.collapse')}</Text>
                </BlurView>
              )}
            </Pressable>
            <View style={glassActive ? { borderRadius: 14 } : { borderRadius: 14, overflow: 'hidden' }}>
              {glassActive ? (
                <NativeGlassView glassStyle="regular" colorScheme="dark" style={{ height: 28, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 12, borderRadius: 14 }}>
                  {canShare ? <Pressable onPress={handleShare} hitSlop={6}><Feather name="share" size={13} color="#FFFFFF" /></Pressable> : null}
                  <Pressable onPress={() => { triggerHaptic('light'); setReportOpen(true); }} hitSlop={6}><Feather name="flag" size={13} color="#FFFFFF" /></Pressable>
                  <Pressable onPress={requestClose} hitSlop={6}><Feather name="x" size={14} color="#FFFFFF" /></Pressable>
                </NativeGlassView>
              ) : (
                <BlurView intensity={80} tint="dark" style={{ height: 28, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 12 }}>
                  {canShare ? <Pressable onPress={handleShare} hitSlop={6}><Feather name="share" size={13} color="#FFFFFF" /></Pressable> : null}
                  <Pressable onPress={() => { triggerHaptic('light'); setReportOpen(true); }} hitSlop={6}><Feather name="flag" size={13} color="#FFFFFF" /></Pressable>
                  <Pressable onPress={requestClose} hitSlop={6}><Feather name="x" size={14} color="#FFFFFF" /></Pressable>
                </BlurView>
              )}
            </View>
          </View>
        ) : null}
      </Animated.View>

      {full ? (
        <SlideUpSheet visible={reportOpen} onClose={() => setReportOpen(false)}>
          <View style={{ paddingBottom: 8 }}>
            <Text variant="body" weight="semibold" align="center" style={{ paddingVertical: 10 }}>{t('report.title')}</Text>
            <Text variant="caption" color={theme.colors.text.tertiary} align="center" style={{ paddingHorizontal: 24, paddingBottom: 10, fontSize: 12 }}>
              {t('mini_app.report_about', undefined, { name: displayName })}
            </Text>
            {REPORT_CATS.map((cat) => (
              <Pressable key={cat.key} onPress={() => handleReport(cat.key)} style={{ paddingVertical: 14, paddingHorizontal: 20, borderTopWidth: 0.5, borderTopColor: theme.colors.border.light }}>
                <Text variant="body">{t(cat.labelKey)}</Text>
              </Pressable>
            ))}
          </View>
        </SlideUpSheet>
      ) : null}
    </>
  );
}
