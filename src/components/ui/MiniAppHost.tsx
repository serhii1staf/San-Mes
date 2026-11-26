import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { View, Pressable, ActivityIndicator, Share, Linking, BackHandler, Animated, Dimensions, Easing, Alert, PixelRatio, StyleSheet } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import { WebView } from 'react-native-webview';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from '../../components/ui/AppBlurView';
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
import { browserBandHeight, useEffectiveBrowserWidgetPosition } from '../../lib/browserWidget';
import { APP_CORNER, AppCornerCutouts, MinimizedBarRow, minimizedBarStyles, useMinimizedBarColors } from './MinimizedBarRow';

const SCREEN_H = Dimensions.get('window').height;
/** Further down than the root reaches: where the panel waits out of sight. */
const OFFSCREEN = Math.max(SCREEN_H, Dimensions.get('screen').height);

// ── Motion: the bar is the panel's top edge (Nov 2026) ───────────────────────
//
// Asked: the mini app and its bar should move the way the welcome screen's sheet and wordmark do,
// rising together on «Войти» and coming down together on «Назад». It used to be two things: the panel
// slid off the bottom of the screen and the bar then rose from below on its own, and opening, the panel
// came up from under the screen over a bar that stayed put.
//
// Now the bar is the panel's top edge. Minimizing, the panel slides down until its top is the bar's top,
// carrying a copy of the bar (MinimizedBarRow) that fades in on it; opening from the bar, it rises from
// there and the copy fades as it goes. The real bar is set as the panel starts down, so it rises under
// the panel and is in place when the panel lands on it; a moment later the panel leaves the screen and
// the bar, showing the same pixels, takes over (see BrowserBottomBand).
//
// One value, `progress` (1 covering the screen, 0 on the bar), moves the panel and the copy and fades
// the copy, on the native driver, with the welcome screen's curve and durations
// (app/(auth)/welcome.tsx). A fresh open comes up from below the screen on the same curve. The × still
// slides the panel away with a symmetric ease-in-out: an ease-in there made closing slam out.
const OPEN = { duration: 560, easing: Easing.bezier(0.22, 1, 0.36, 1) };
const CLOSE = { duration: 460, easing: Easing.bezier(0.22, 1, 0.36, 1) };
const DISMISS_EASING = Easing.bezier(0.33, 0, 0.67, 1);
const DISMISS_MS = 360;

/**
 * With the widget at the top (BrowserMiniBar) the panel still leaves downwards, and the widget appears
 * this far into that exit, so the two overlap instead of one appearing after the other.
 */
const HANDOFF_AT = 0.62;

/**
 * How long the panel stays on the bar after landing before it leaves the screen to it. The bar under
 * it started rising (BAND_SPRING, about 0.4 s) a frame or two after the panel started down; this is the
 * margin for a slow first frame, so the bar is at rest before it is uncovered.
 */
const PARK_AFTER_MS = 140;

// Root-level persistent mini-app host. See src/store/miniAppStore.ts for the
// state machine. The WebView is mounted while mode !== 'closed' and is NEVER
// torn down on minimize — minimizing parks the panel below the screen
// (translateY) with pointerEvents 'none', keeping its zIndex STABLE (no
// reorder repaint), so the page keeps its scroll/section/JS state and
// restoring is instant with no reload.

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

// ── WebView navigation hardening helpers (anti-malware / anti-phishing) ──────
// These are pure functions (no hooks) so they don't affect React hook order.

// Executable / installer file extensions we must never let a mini-app or a
// linked page download — distributing these would turn the app into a malware
// vector. Matched against the URL path with query/hash stripped.
const EXECUTABLE_DOWNLOAD_RE = /\.(ipa|apk|exe|dmg|pkg|msi|bat|sh|scr)$/i;

function isExecutableDownload(rawUrl: string): boolean {
  let path = rawUrl;
  try { path = new URL(rawUrl).pathname; } catch { path = rawUrl.split('#')[0].split('?')[0]; }
  return EXECUTABLE_DOWNLOAD_RE.test(path);
}

function hostOf(rawUrl: string): string {
  try { return new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}

// Registrable-domain approximation (eTLD+1) used ONLY for phishing friction:
// navigations that stay on the same base domain (incl. subdomains) don't
// prompt; a jump to a different base domain surfaces the destination host.
function baseDomain(host: string): string {
  const parts = host.split('.').filter(Boolean);
  return parts.length <= 2 ? host : parts.slice(-2).join('.');
}

// Per-session set of destination base-domains the user already approved leaving
// to — keyed by sessionKey so a new mini-app starts clean. Module-scoped to
// avoid adding a React hook (preserves hook order/count).
const miniAppApprovedHosts = new Map<number, Set<string>>();

// External / custom schemes are NEVER auto-opened — always confirm first.
function confirmExternalOpen(u: string, t: (k: string, d?: string, p?: Record<string, string | number>) => string) {
  Alert.alert(
    t('mini_app.external_link_title', 'Открыть ссылку? / Open link?'),
    t('mini_app.external_link_message', '{url}', { url: u }),
    [
      { text: t('common.cancel', 'Отмена / Cancel'), style: 'cancel' },
      { text: t('common.open', 'Открыть / Open'), onPress: () => { Linking.openURL(u).catch(() => {}); } },
    ],
  );
}

export function MiniAppHost() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const t = useT();
  const glassActive = useLiquidGlassActive();
  const barColors = useMinimizedBarColors();

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
    // Clear any "leave-origin" approvals from the previous session.
    miniAppApprovedHosts.clear();
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

  /**
   * Show the minimized bar (or the top widget) for this session.
   *
   * Mode-guarded and idempotent: with the widget at the top it is called from a timer partway through
   * the exit and from its end. It replaces a site's bar that is still showing (the panel clears that one
   * only once it has covered the screen), so the bar the panel lands on is always its own.
   */
  const revealMinimizedWidget = useCallback(() => {
    try {
      const st = useMiniAppStore.getState();
      if (st.mode !== 'min') return;
      const target = normalizeUrl(st.url);
      const bar = useBrowserStore.getState();
      if (bar.isMiniApp && bar.minimizedUrl === target) return; // already this session's
      bar.setMinimized(target, st.name, true, st.emoji);
    } catch {}
  }, []);

  // ── Where the panel is ─────────────────────────────────────────────────────
  //
  // The panel's stacking (zIndex / elevation) and background stay the same for the whole session and
  // are never toggled at the end of an animation: on Android, reordering an absolutely positioned
  // view's zIndex forces a one-frame repaint (the blink once seen when a minimize finished). It moves
  // only by translateY, from two native-driver values, so nothing is committed from JS as it moves.
  const toBar = useEffectiveBrowserWidgetPosition() === 'bottom';
  const toBarRef = useRef(toBar);
  toBarRef.current = toBar;

  const bandH = browserBandHeight(insets.bottom);
  // The panel's height is the root's, which the bar is laid out from as well.
  const [hostH, setHostH] = useState(0);
  const hostHRef = useRef(0);
  const onPanelLayout = useCallback((e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (h > 0 && Math.abs(h - hostHRef.current) >= 0.5) {
      hostHRef.current = h;
      setHostH(h);
    }
  }, []);
  // The bar's top, on the pixel grid where layout puts it, so the panel's edge meets the copy's exactly.
  const barTop = PixelRatio.roundToNearestPixel(Math.max(0, (hostH || SCREEN_H) - bandH));

  // 1: the panel covers the screen. 0: its top is the bar's top.
  const progress = useRef(new Animated.Value(1)).current;
  // Added below that: 0 while the panel is in play; more while it comes up from under the screen,
  // leaves through the bottom, or waits out of sight.
  const away = useRef(new Animated.Value(OFFSCREEN)).current;
  const motion = useMemo(() => ({
    panelY: Animated.add(progress.interpolate({ inputRange: [0, 1], outputRange: [barTop, 0] }), away),
    // The copy is laid out where the bar is, so at 0 it is the bar's pixels; above that it rides the
    // panel's top edge.
    copyY: Animated.add(progress.interpolate({ inputRange: [0, 1], outputRange: [0, -barTop] }), away),
    // The bar fades in on the panel as it comes down, and out as it rises from the bar.
    copyOpacity: progress.interpolate({ inputRange: [0, 0.6], outputRange: [1, 0], extrapolate: 'clamp' }),
    // The rounded corners it gives the screen above its edge, only while it is between screen and bar: a
    // fresh open from under the screen and the × keep the plain edge.
    cornersOpacity: progress.interpolate({ inputRange: [0, 0.98, 1], outputRange: [1, 1, 0], extrapolate: 'clamp' }),
  }), [progress, away, barTop]);

  // 'away': out of sight, or leaving. 'full': covering the screen, or on its way there. 'bar': on its
  // way down to the bar, or on it. 'parked': it landed on the bar and left the screen to the bar.
  const phase = useRef<'away' | 'full' | 'bar' | 'parked'>('away');
  // The session the bar was set for by a minimize: only that one grows back out of it.
  const barSession = useRef<number | null>(null);

  const handoffTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const parkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revealFrame = useRef<number | null>(null);
  const cancelTimers = useCallback(() => {
    if (handoffTimer.current) { clearTimeout(handoffTimer.current); handoffTimer.current = null; }
    if (parkTimer.current) { clearTimeout(parkTimer.current); parkTimer.current = null; }
    if (revealFrame.current != null) { cancelAnimationFrame(revealFrame.current); revealFrame.current = null; }
  }, []);
  useEffect(() => () => cancelTimers(), [cancelTimers]);

  useEffect(() => {
    cancelTimers();
    if (mode === 'closed') {
      phase.current = 'away';
      barSession.current = null;
      return;
    }

    if (mode === 'full') {
      const ownBar = barSession.current === sessionKey && toBarRef.current;
      if (ownBar && phase.current === 'parked') {
        // Back onto the bar, which shows the same pixels, and up from there.
        away.setValue(0);
      } else if (!(ownBar && phase.current === 'bar')) {
        // A fresh open, or another app: up from under the screen. (On its way down to the bar it simply
        // turns back from where it is.)
        progress.setValue(1);
        away.setValue(hostHRef.current || OFFSCREEN);
      }
      phase.current = 'full';
      // The bar is cleared once the panel covers the screen, not as it starts to rise: its space goes
      // back to the screen underneath, and under the panel nothing is seen moving. A minimize that
      // interrupts the open leaves it set, which is right: the session is minimized again.
      Animated.parallel([
        Animated.timing(progress, { toValue: 1, ...OPEN, useNativeDriver: true }),
        Animated.timing(away, { toValue: 0, ...OPEN, useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (!finished || useMiniAppStore.getState().mode !== 'full') return;
        barSession.current = null;
        try { useBrowserStore.getState().clearMinimized(); } catch {}
      });
      return;
    }

    // mode === 'min'
    if (toBarRef.current) {
      phase.current = 'bar';
      barSession.current = sessionKey;
      Animated.parallel([
        Animated.timing(progress, { toValue: 0, ...CLOSE, useNativeDriver: true }),
        Animated.timing(away, { toValue: 0, ...CLOSE, useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (!finished || useMiniAppStore.getState().mode !== 'min') return;
        parkTimer.current = setTimeout(() => {
          parkTimer.current = null;
          if (useMiniAppStore.getState().mode !== 'min' || phase.current !== 'bar') return;
          // The bar under it shows the same pixels; the panel and its WebView leave the screen.
          away.setValue(OFFSCREEN);
          phase.current = 'parked';
        }, PARK_AFTER_MS);
      });
      // The bar a frame later, once the panel is moving: setting it re-lays out the screens for its
      // space, and that must not hold the panel's first frame. It rises under the panel and is in
      // place when the panel lands on it.
      revealFrame.current = requestAnimationFrame(() => {
        revealFrame.current = null;
        revealMinimizedWidget();
      });
      return;
    }

    // The widget at the top: the panel leaves through the bottom and the widget appears partway through.
    phase.current = 'away';
    barSession.current = null;
    Animated.timing(away, { toValue: hostHRef.current || OFFSCREEN, duration: DISMISS_MS, easing: DISMISS_EASING, useNativeDriver: true }).start(({ finished }) => {
      if (!finished || useMiniAppStore.getState().mode !== 'min') return;
      revealMinimizedWidget();
    });
    handoffTimer.current = setTimeout(() => {
      handoffTimer.current = null;
      revealMinimizedWidget();
    }, Math.round(DISMISS_MS * HANDOFF_AT));
  }, [mode, sessionKey, progress, away, cancelTimers, revealMinimizedWidget]);

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

  // Slide the panel out through the bottom before tearing the WebView down, then clear the widget too.
  const requestClose = useCallback(() => {
    triggerHaptic('light');
    cancelTimers();
    phase.current = 'away';
    Animated.timing(away, { toValue: hostHRef.current || OFFSCREEN, duration: DISMISS_MS, easing: DISMISS_EASING, useNativeDriver: true }).start(() => {
      useMiniAppStore.getState().close();
      try { useBrowserStore.getState().clearMinimized(); } catch {}
    });
  }, [away, cancelTimers]);

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

  const onShouldStartLoadWithRequest = useCallback((req: { url: string; isTopFrame?: boolean }) => {
    const u = (req?.url || '');
    const lower = u.toLowerCase();
    // iOS provides isTopFrame; on Android it's undefined — treat unknown as
    // top-level so the strict guards still apply.
    const isTopFrame = req?.isTopFrame !== false;

    // Internal blank/about pages used by WebKit during init — always safe.
    if (u === 'about:blank' || lower.startsWith('about:')) return true;

    // Anti-malware: block executable/installer downloads on ANY scheme.
    if (isExecutableDownload(u)) {
      Alert.alert(
        t('mini_app.blocked_download_title', 'Download blocked'),
        t('mini_app.blocked_download_message', "This link points to a file that can't be opened safely in the app."),
      );
      return false;
    }

    if (lower.startsWith('https://')) {
      // Phishing friction: a top-level jump to a DIFFERENT base domain than the
      // mini-app's declared origin is surfaced (with the destination host)
      // before navigating, instead of silently following the redirect.
      if (isTopFrame) {
        const origin = baseDomain(hostOf(decodedUrl));
        const dest = baseDomain(hostOf(u));
        const approved = miniAppApprovedHosts.get(sessionKey) || new Set<string>();
        if (origin && dest && dest !== origin && !approved.has(dest)) {
          Alert.alert(
            t('mini_app.leaving_origin_title', 'Leave this app?'),
            t('mini_app.leaving_origin_message', 'This is trying to open {host}, which is outside the app.', { host: hostOf(u) }),
            [
              { text: t('common.cancel', 'Отмена / Cancel'), style: 'cancel' },
              {
                text: t('common.continue', 'Продолжить / Continue'),
                onPress: () => {
                  approved.add(dest);
                  miniAppApprovedHosts.set(sessionKey, approved);
                  webViewRef.current?.injectJavaScript(`window.location.href = ${JSON.stringify(u)}; true;`);
                },
              },
            ],
          );
          return false;
        }
      }
      return true;
    }

    // blob: is generated by the page itself — safe to render.
    if (lower.startsWith('blob:')) return true;

    // http: upgrade top-level navigations to https instead of loading cleartext.
    if (lower.startsWith('http://')) {
      if (isTopFrame) {
        const upgraded = 'https://' + u.slice('http://'.length);
        webViewRef.current?.injectJavaScript(`window.location.replace(${JSON.stringify(upgraded)}); true;`);
      }
      return false;
    }

    // Hard-blocked: local file access, script injection, and data: URLs
    // (data: is a known top-level phishing/exfil vector — block outright here).
    if (lower.startsWith('file:') || lower.startsWith('javascript:') || lower.startsWith('data:')) return false;

    // Our own deep-link scheme must never be driven by untrusted mini-app
    // content — silently ignore it.
    if (lower.startsWith('san-mes://')) return false;

    // Every external/custom scheme (tel:, mailto:, sms:, app-store, deep links):
    // NEVER auto-open — require explicit user confirmation before handing to OS.
    confirmExternalOpen(u, t);
    return false;
  }, [t, decodedUrl, sessionKey]);

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
        onLayout={onPanelLayout}
        style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          zIndex: 9999,
          backgroundColor: '#000',
          transform: [{ translateY: motion.panelY }],
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

        {/* The pills stay mounted while the session is open, so they ride down with the panel and up
            again instead of popping out as it starts down; the bar's copy covers them on the bar, and
            the panel takes no touches unless it is full. */}
        <View style={{ position: 'absolute', top: insets.top + 8, left: 16, right: 16, zIndex: 60, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          {/* Collapse / actions pills, content INSIDE NativeGlassView: the structure that renders real
              liquid glass. A GlassBg rewrite and a parent `opacity` were what killed the effect. A dark
              tint keeps the glass visible over the WebView, which the effect can't sample. */}
          <Pressable onPress={() => { triggerHaptic('light'); useMiniAppStore.getState().minimize(); }} style={glassActive ? { borderRadius: 14 } : { borderRadius: 14, overflow: 'hidden' }}>
            {glassActive ? (
              <NativeGlassView glassStyle="regular" isInteractive colorScheme="dark" style={{ height: 28, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, borderRadius: 14 }}>
                <Feather name="chevron-down" size={12} color="#FFFFFF" />
                <Text style={{ fontSize: 10, color: '#FFFFFF', fontWeight: '500' }}>{t('mini_app.collapse')}</Text>
              </NativeGlassView>
            ) : (
              <BlurView intensity={80} role="scrim" tint="dark" style={{ height: 28, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10 }}>
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
              <BlurView intensity={80} role="scrim" tint="dark" style={{ height: 28, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 12 }}>
                {canShare ? <Pressable onPress={handleShare} hitSlop={6}><Feather name="share" size={13} color="#FFFFFF" /></Pressable> : null}
                <Pressable onPress={() => { triggerHaptic('light'); setReportOpen(true); }} hitSlop={6}><Feather name="flag" size={13} color="#FFFFFF" /></Pressable>
                <Pressable onPress={requestClose} hitSlop={6}><Feather name="x" size={14} color="#FFFFFF" /></Pressable>
              </BlurView>
            )}
          </View>
        </View>
      </Animated.View>

      {toBar ? (
        // The bar on the panel's top edge (see the Motion note at the top). Laid out like the bar itself,
        // from the bottom of the same frame with the same height, so on the bar it is the bar's pixels.
        // No touches: on the bar, the real one under it takes them.
        <Animated.View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.barCopy, { height: APP_CORNER + bandH, transform: [{ translateY: motion.copyY }] }]}
        >
          <Animated.View style={{ opacity: motion.cornersOpacity }}>
            <AppCornerCutouts />
          </Animated.View>
          <Animated.View renderToHardwareTextureAndroid style={[minimizedBarStyles.band, { height: bandH, opacity: motion.copyOpacity }]}>
            <View style={[minimizedBarStyles.surface, { backgroundColor: barColors.surface }]}>
              <MinimizedBarRow title={name} ink={barColors.ink} />
            </View>
          </Animated.View>
        </Animated.View>
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

const styles = StyleSheet.create({
  // Above the panel (9999), where the bar is: the bar's corners and band, laid out from the bottom.
  barCopy: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 10000 },
});
