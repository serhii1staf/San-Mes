import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { View, Pressable, ActivityIndicator, Share, Linking, BackHandler, Text as RNText } from 'react-native';
import { WebView } from 'react-native-webview';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { Text } from './Text';
import { useLiquidGlassActive, NativeGlassView } from './LiquidGlass';
import { SlideUpSheet } from './SlideUpSheet';
import { useMiniAppStore } from '../../store/miniAppStore';
import { useMiniAppsStore } from '../../store/miniAppsStore';
import { buildMiniAppShareUrl } from '../../utils/miniAppShare';
import { useT } from '../../i18n/store';
import { triggerHaptic } from '../../utils/haptics';
import { showToast } from '../../store/toastStore';
import { useTheme } from '../../theme';

// Root-level persistent mini-app host. See src/store/miniAppStore.ts for the
// state machine. The WebView is mounted while mode !== 'closed' and is NEVER
// torn down on minimize — minimizing just hides the overlay (opacity 0, sent
// behind the opaque app screens) so the page keeps its scroll/section/JS
// state and restoring is instant with no reload.

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
    Linking.openURL(u).catch(() => {});
    return false;
  }, []);

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
  const handleReport = (_categoryKey: string) => {
    triggerHaptic('medium');
    setReportOpen(false);
    showToast(t('toast.report_sent'), 'flag');
  };

  if (mode === 'closed') return null;

  const full = mode === 'full';

  return (
    <>
      {/* WebView overlay — kept mounted across minimize. When minimized it is
          sent behind the (opaque) app with opacity 0 so its page state stays
          alive for an instant, reload-free restore. */}
      <View
        pointerEvents={full ? 'auto' : 'none'}
        style={full
          ? { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999, backgroundColor: '#000' }
          // Minimized: sit BEHIND the (opaque, themed) app at zIndex -1 but
          // keep opacity 1 so the OS never culls the WebView — that preserves
          // the live page (scroll / SPA route / JS state) for a reload-free
          // restore. The app screens fully cover it, so it's not visible.
          : { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: -1 }}
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
                  <Pressable onPress={() => { triggerHaptic('light'); useMiniAppStore.getState().close(); }} hitSlop={6}><Feather name="x" size={14} color="#FFFFFF" /></Pressable>
                </NativeGlassView>
              ) : (
                <BlurView intensity={80} tint="dark" style={{ height: 28, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 12 }}>
                  {canShare ? <Pressable onPress={handleShare} hitSlop={6}><Feather name="share" size={13} color="#FFFFFF" /></Pressable> : null}
                  <Pressable onPress={() => { triggerHaptic('light'); setReportOpen(true); }} hitSlop={6}><Feather name="flag" size={13} color="#FFFFFF" /></Pressable>
                  <Pressable onPress={() => { triggerHaptic('light'); useMiniAppStore.getState().close(); }} hitSlop={6}><Feather name="x" size={14} color="#FFFFFF" /></Pressable>
                </BlurView>
              )}
            </View>
          </View>
        ) : null}
      </View>

      {/* Minimized pill — tap to restore, x to close. Sits above the tab bar. */}
      {mode === 'min' ? (
        <View style={{ position: 'absolute', left: 16, right: 16, bottom: 24 + 62 + 6, zIndex: 250 }} pointerEvents="box-none">
          <Pressable
            onPress={() => { triggerHaptic('light'); useMiniAppStore.getState().restore(); }}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 10,
              paddingHorizontal: 12, paddingVertical: 10, borderRadius: 24,
              backgroundColor: theme.isDark ? theme.colors.background.elevated : '#FFFFFF',
              borderWidth: 0.5, borderColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
              shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.14, shadowRadius: 14, elevation: 8,
            }}
          >
            <RNText style={{ fontSize: 18 }} allowFontScaling={false}>{appEmoji}</RNText>
            <Text variant="body" weight="semibold" numberOfLines={1} style={{ flex: 1, color: theme.colors.text.primary }}>{displayName}</Text>
            <Pressable onPress={() => { triggerHaptic('light'); useMiniAppStore.getState().close(); }} hitSlop={8} style={{ padding: 4 }}>
              <Feather name="x" size={16} color={theme.colors.text.tertiary} />
            </Pressable>
          </Pressable>
        </View>
      ) : null}

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
