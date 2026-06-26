import React, { useEffect, useState, useRef } from 'react';
import { View, StyleSheet, Animated, Text as RNText, Image as RNImage, Dimensions } from 'react-native';
import { Stack, useRouter, useSegments, useNavigationContainerRef } from 'expo-router';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import * as Sentry from '@sentry/react-native';
import { ThemeProvider, useTheme } from '../src/theme';
import { fontAssets } from '../src/theme/fonts';
import { useAuthStore } from '../src/store';
import { BrowserMiniBar } from '../src/components/ui/BrowserMiniBar';
import { BrowserBottomBand } from '../src/components/ui/BrowserBottomBand';
import { MusicBottomIndicator } from '../src/components/ui/MusicBottomIndicator';
import { MusicFullPlayer } from '../src/components/ui/MusicFullPlayer';
import { MiniAppHost } from '../src/components/ui/MiniAppHost';
import { Toast } from '../src/components/ui/Toast';
import { initRateLimits } from '../src/services/rateLimit';
import { cacheCleanup } from '../src/services/cacheManager';
import { installImageMemoryManager } from '../src/services/imageMemoryManager';
import { useConnectivityStore } from '../src/services/connectivityMonitor';
import { useEntityStore } from '../src/services/entityStore';
import { setCacheAccount } from '../src/services/cacheService';
import { setThrottleAccount } from '../src/services/syncThrottle';
import { useT } from '../src/i18n/store';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
// `@gorhom/bottom-sheet` requires its `BottomSheetModalProvider` to be mounted
// once at the root of the app — every `BottomSheetModal` opened anywhere in
// the tree registers itself with the nearest provider so the lib can host
// the sheet above the rest of the UI. We mount it INSIDE
// `GestureHandlerRootView` (the lib's gestures rely on react-native-
// gesture-handler being already initialised) and OUTSIDE the keyboard /
// theme providers so it stays alive across theme flips.
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { PerfMonitorBubble } from '../src/components/dev/PerfMonitorBubble';
import { perfMonitor, installPerfErrorHooks } from '../src/services/perfMonitor';
import { DynamicOverlayHost } from '../src/components/dynamic-overlay/DynamicOverlayHost';
import { RealtimeAccountBridge } from '../src/components/realtime/RealtimeAccountBridge';
import { NavigationBarController } from '../src/components/system/NavigationBarController';

// Install the global JS error / promise hooks once at module load so we
// capture every crash from the very first render onward (the bubble panel
// can then surface them with a copy button, which is what the user wants
// when they don't have direct Sentry access).
try { installPerfErrorHooks(); } catch {}

SplashScreen.preventAutoHideAsync().catch(() => {});

// Sentry monitoring — initialize before any component renders so the SDK can
// catch the very first error if it happens during the initial JS bundle eval.
// The DSN is a public ingestion URL: it identifies the project but cannot be
// used to read events or modify settings, so it's safe to commit.
const navigationIntegration = Sentry.reactNavigationIntegration({
  enableTimeToInitialDisplay: true,
});

// Wrap init in try/catch so that if anything goes wrong (e.g. the native
// module failed to load on a particular OTA payload, or a regression in the
// Sentry SDK trips an early error) we don't take the whole app down with us.
// Crash reporting is a nice-to-have, working app is critical.
try {
  Sentry.init({
    dsn: 'https://5cc37dc9e4220257f42fe51995c0dbae@o4511549943447552.ingest.de.sentry.io/4511550037229648',
    // Conservative sampling rates so Sentry never becomes a perf problem on
    // weak devices. We can raise these once we have a baseline of traffic.
    tracesSampleRate: 0.1,
    // profilesSampleRate intentionally omitted — the native profiler needs
    // additional setup that's easy to get wrong, and a misconfigured
    // profiler can crash the app at startup.
    enableAutoSessionTracking: true,
    // Don't ship default PII to keep us aligned with the Apple Developer
    // Program License Agreement (no covert collection of user data). We attach
    // user.id manually after auth via Sentry.setUser() if/when needed.
    sendDefaultPii: false,
    integrations: [navigationIntegration],
    // Filter local-dev noise. RELEASE_CHANNEL is set by EAS / expo-updates.
    enabled: !__DEV__,
  });
} catch (err) {
  // eslint-disable-next-line no-console
  console.warn('[Sentry.init] failed:', err);
}

function AuthNavigationGuard({ children }: { children: React.ReactNode }) {
  // Subscribe to ONLY the two flags we actually care about. Pulling the whole
  // auth store re-renders the entire navigation stack on every profile field
  // update (badge, displayName, etc.) — that was a major source of jank.
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const segments = useSegments();
  const router = useRouter();
  const [showSplash, setShowSplash] = useState(true);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  useEffect(() => {
    // Minimum time the branded JS splash stays up. Trimmed 800 → 450 ms so the
    // app reaches the feed faster after the native launch screen hands off —
    // the user perceived the combined native+JS splash as too long.
    const timer = setTimeout(() => setShowSplash(false), 450);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!hasHydrated || showSplash) return;
    const inAuthGroup = segments[0] === '(auth)';
    if (!isAuthenticated && !inAuthGroup) {
      // Show blank screen immediately to prevent crashes from null user
      setIsLoggingOut(true);
      // Navigate after a frame to let components unmount
      setTimeout(() => {
        router.replace('/(auth)/welcome');
        setIsLoggingOut(false);
      }, 50);
    } else if (isAuthenticated && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [isAuthenticated, segments, hasHydrated, showSplash]);

  // Register for push notifications once the user is authenticated and past the
  // splash. Deferred so the permission prompt + token fetch never block startup.
  // No-op on the current build (native module absent — guarded inside).
  useEffect(() => {
    if (!isAuthenticated || !hasHydrated) return;
    const tid = setTimeout(() => {
      import('../src/services/pushNotifications')
        .then((m) => m.registerForPush())
        .catch(() => {});
    }, 1500);
    return () => clearTimeout(tid);
  }, [isAuthenticated, hasHydrated]);

  if (!hasHydrated || showSplash || isLoggingOut) {
    return <CustomSplash />;
  }
  // Synchronous guard: the moment auth is cleared (logout / delete account),
  // render the splash immediately so no protected screen re-renders with a null
  // user for even a single frame (that race was crashing the app on logout).
  const inAuthGroup = segments[0] === '(auth)';
  if (!isAuthenticated && !inAuthGroup) {
    return <CustomSplash />;
  }
  // The whole tree is wrapped in a themed background so any 1-pixel layout
  // gap (e.g. between the Stack and the bottom-docked browser band when
  // its height animates) gets the app's real background colour rather than
  // whatever sits behind us (which can be the OS default white in some
  // edge cases — that was the "white seam" the user saw at the bottom of
  // the screen for a frame after dismissing the band).
  return <ThemedShell>{children}</ThemedShell>;
}

function ThemedShell({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>{children}</View>;
}

function CustomSplash() {
  const t = useT();
  // Splash only needs the display name — subscribe to that field, not the
  // whole user object, so unrelated profile updates don't re-trigger the
  // mount animation.
  const displayName = useAuthStore((s) => s.user?.displayName);
  const logoAnim = useRef(new Animated.Value(-40)).current;
  const textAnim = useRef(new Animated.Value(40)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(logoAnim, { toValue: 0, duration: 500, useNativeDriver: true }),
      Animated.timing(textAnim, { toValue: 0, duration: 500, useNativeDriver: true }),
      Animated.timing(opacityAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
    ]).start();
  }, []);

  // Layout: ORIGINAL side-by-side branding (logo slides in from the left,
  // "San" + greeting from the right). The only thing kept from the splash
  // rework is the fixed dark #141414 background + light text, which matches
  // the NATIVE launch screen (app.json expo-splash-screen) so the
  // native→JS hand-off doesn't flash dark→light. The centered layout was a
  // misstep and is reverted here.
  return (
    <View style={[styles.loadingContainer, { backgroundColor: '#141414' }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 32, maxWidth: '90%' }}>
        <Animated.View style={{ transform: [{ translateX: logoAnim }], opacity: opacityAnim }}>
          <RNImage source={require('../assets/icon.png')} style={{ width: 44, height: 44, borderRadius: 12 }} />
        </Animated.View>
        <Animated.View style={{ transform: [{ translateX: textAnim }], opacity: opacityAnim, flexShrink: 1 }}>
          <RNText style={{ fontSize: 28, fontWeight: '700', color: '#FFFFFF' }}>San</RNText>
          {displayName && (
            <RNText numberOfLines={1} style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>
              {t('splash.greeting', undefined, { name: displayName })}
            </RNText>
          )}
        </Animated.View>
      </View>
    </View>
  );
}

function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(fontAssets);
  const [fontTimeout, setFontTimeout] = useState(false);
  const navigationRef = useNavigationContainerRef();
  const segments = useSegments();
  const lastSegmentRef = useRef<string>('');

  // Hand the navigation container to Sentry so it can track screen
  // transitions as transactions (no PII; it only logs route names).
  useEffect(() => {
    if (navigationRef?.current) {
      navigationIntegration.registerNavigationContainer(navigationRef);
    }
  }, [navigationRef]);

  // Feed navigation transitions into the in-app perf monitor so the user
  // sees which screen change is slow when they're chasing jank. We record
  // the duration as the time from the segment change until two paint
  // frames later — by then most of the new screen's first render work has
  // landed, so the number is a reasonable proxy for "how long did the
  // transition feel". Wrapped defensively — a regression here must not
  // bring down the whole app.
  useEffect(() => {
    try {
      const route = segments.join('/') || '(root)';
      if (route === lastSegmentRef.current) return;
      lastSegmentRef.current = route;
      const startedAt = Date.now();
      // Two RAFs ≈ first paint after layout. We avoid heavier hooks like
      // setTimeout(0) because they add their own scheduling jitter.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          try {
            perfMonitor.recordNavigation(route, Date.now() - startedAt);
          } catch {}
        });
      });
    } catch {}
  }, [segments]);

  useEffect(() => {
    const timer = setTimeout(() => setFontTimeout(true), 3000);
    return () => clearTimeout(timer);
  }, []);

  // Install the global image-memory pressure handler ONCE for the whole
  // session. On an OS low-memory warning (or a sustained background) it drops
  // expo-image's decoded-bitmap memory cache so an image-heavy marathon
  // session can't grow native memory into an OOM-kill — disk bytes are kept,
  // so visible images repaint instantly from local cache. Best-effort + guarded.
  useEffect(() => {
    const dispose = installImageMemoryManager();
    return dispose;
  }, []);

  const ready = fontsLoaded || fontError !== null || fontTimeout;

  useEffect(() => {
    if (!ready) return;

    SplashScreen.hideAsync().catch(() => {});

    // Phase 1 — must run before any feed/conversation hydration so each
    // account loads its own slice of the cache (Telegram-style isolation).
    // These are pure synchronous setters, not network calls.
    const currentUser = useAuthStore.getState().user;
    setCacheAccount(currentUser?.id);
    setThrottleAccount(currentUser?.id);

    // Phase 2 — hydrate cached data so screens have content on first paint.
    useEntityStore.getState().hydrate();

    // Phase 3 — non-critical setup. Defer to the next idle frame so the
    // first render lands without competing for the JS thread. On weak
    // devices this is the difference between "tap profile and freeze for
    // a frame" and "instant transition".
    const idle = setTimeout(() => {
      initRateLimits();
      cacheCleanup();
      useConnectivityStore.getState().start();
      // Proactively cap expo-image's unbounded on-disk cache so a long-running
      // image-heavy session can't grow it into storage-exhaustion / crash
      // territory. Dynamically imported + fully guarded so it never blocks
      // startup and degrades gracefully on an older binary. Internally
      // throttled to once per session and best-effort (clears only when over
      // the cap; images re-download cheaply via the CDN proxy).
      import('../src/services/imageDiskCacheGuard')
        .then(({ enforceImageDiskCacheCap }) => enforceImageDiskCacheCap())
        .catch(() => {});
      // Refresh the viewer's follow graph from the server once on boot so
      // follow buttons reconcile to server truth app-wide (the entity store
      // only rehydrates the cached follow set synchronously above).
      // `syncFollows` is internally throttled, so this is a cheap no-op when
      // it ran recently. Deferred to the idle frame so it never competes
      // with first paint.
      if (currentUser?.id) {
        import('../src/services/syncService')
          .then(({ syncFollows }) => syncFollows(currentUser.id))
          .catch(() => {});
      }
    }, 0);

    // Phase 4 — boot-time image warming. Deferred well past first paint so it
    // NEVER competes with the cold-start frame, then warms the on-disk image
    // cache for the two surfaces the user opens first: the feed heroes and the
    // recent media of the top conversations. This makes re-entering the feed /
    // a chat show images instantly even on a cold launch (Telegram-style),
    // instead of paying a weserv round-trip the first time each screen mounts.
    // Cheap + capped: ≤4 feed heroes + the existing ≤12-URI chat-media budget,
    // all routed through expo-image's deduping prefetcher. Fully guarded.
    const warm = setTimeout(() => {
      try {
        // Feed heroes from the cached feed (top few only).
        const { kvGetJSONSync } = require('../src/services/kvStore');
        const feed = kvGetJSONSync('@san:feed_posts', []);
        if (Array.isArray(feed) && feed.length > 0) {
          const heroes: string[] = [];
          for (let i = 0; i < Math.min(feed.length, 4); i++) {
            const p = feed[i];
            const u = p?.imageUrl || (Array.isArray(p?.imageUrls) ? p.imageUrls[0] : undefined);
            if (typeof u === 'string' && u.startsWith('http')) heroes.push(u);
          }
          if (heroes.length > 0) {
            import('../src/components/ui/CachedImage')
              .then(({ prefetchImages }) => {
                // Must equal PostCard.HERO_IMG_WIDTH (card content width
                // [screen − 32] minus the 12px image inset on each side) so the
                // warmed weserv URL shares an expo-image cache key with the feed
                // hero's real mount. Kept in sync with PostCard by construction.
                const heroWidth = Dimensions.get('window').width - 56;
                prefetchImages(heroes, heroWidth);
              })
              .catch(() => {});
          }
        }
        // Recent chat media for the most-active conversations (already capped
        // + chunked inside the helper). entityStore was hydrated in Phase 2,
        // so the conversation list is available here.
        const convos = (useEntityStore.getState().conversations || []) as Array<{ id: string; lastMessageAt?: string }>;
        if (convos.length > 0) {
          const ids = [...convos]
            .sort((a, b) => (b.lastMessageAt || '').localeCompare(a.lastMessageAt || ''))
            .slice(0, 8)
            .map((c) => c.id);
          import('../src/services/messagesPrefetch')
            .then(({ prefetchRecentChatMedia }) => prefetchRecentChatMedia({ conversationIds: ids, budgetUris: 12 }))
            .catch(() => {});
        }
      } catch {
        // Warming is best-effort; never let it affect launch.
      }
    }, 1200);

    return () => { clearTimeout(idle); clearTimeout(warm); };
  }, [ready]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!useAuthStore.getState().hasHydrated) {
        useAuthStore.setState({ hasHydrated: true });
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={styles.gestureRoot}>
    <BottomSheetModalProvider>
    <KeyboardProvider>
    <ThemeProvider>
      <NavigationBarController />
      <AuthNavigationGuard>
        <BrowserMiniBar />
        <MusicBottomIndicator />
        <MusicFullPlayer />
        <Toast />
        {/* The Stack + bottom-docked browser band sit in a single flex column.
            When the band appears (settings: bottom-position) it occupies its
            own height inside this column, which pushes the entire Stack
            (including the floating tab bar absolutely positioned inside it)
            upward by exactly that height — i.e. the app "lifts" rather than
            the band overlaying. The transition is smoothed by LayoutAnimation
            inside BrowserBottomBand. */}
        <View style={styles.rootColumn}>
          <View style={styles.stackWrapper}>
            <AppStack />
          </View>
          <BrowserBottomBand />
        </View>
        {/* Floating performance monitor — sits above everything else so it
            stays visible on every screen. Defaults to ON; users can hide it
            from the panel that opens when they tap the bubble. */}
        <PerfMonitorBubble />
        {/* Persistent mini-app host — owns the mini-app WebView so collapsing
            then reopening resumes the same page (no reload). Renders only when
            a mini-app is open/minimized; nothing otherwise. */}
        <MiniAppHost />
        {/* App-wide realtime bridge — opens ONE Ably connection for the
            logged-in user, subscribes to the personal notifications
            channel so new conversations / messages show up the instant
            another user sends them. Effects-only, no rendered output.
            Connection is dropped by switchAccount() on logout / switch. */}
        <RealtimeAccountBridge />
        {/* Dynamic Island companion overlay. Triggered by a long-press on
            the Home tab in the bottom navigation (see app/(tabs)/_layout.tsx
            `homeListeners`). Mounts only when the user activates it
            (zIndex 9998 — above the perf bubble's container). All OTA-safe
            — no native modules, no new permissions, never draws above
            `insets.top`. */}
        <DynamicOverlayHost />
      </AuthNavigationGuard>
    </ThemeProvider>
    </KeyboardProvider>
    </BottomSheetModalProvider>
    </GestureHandlerRootView>
  );
}

// Navigator extracted into its own component so it can read the active theme
// (RootLayout sits ABOVE ThemeProvider and can't call useTheme). The key bit
// is `contentStyle`: it paints every native-stack scene on the theme
// background, which kills the white sliver/flash that showed during screen
// transitions and modal dismissals (e.g. closing a mini-app) when the OS color
// scheme didn't match the app's dark theme.
function AppStack() {
  const theme = useTheme();
  const screenOptions = React.useMemo(
    () => ({ headerShown: false, contentStyle: { backgroundColor: theme.colors.background.primary } }),
    [theme.colors.background.primary],
  );
  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="chat/[id]" />
      <Stack.Screen name="chat/ai" />
      <Stack.Screen name="chat/music" />
      <Stack.Screen name="profile/edit" options={{ presentation: 'modal', animation: 'slide_from_bottom', headerShown: false }} />
      <Stack.Screen name="profile/[id]" />
      <Stack.Screen name="comments/[id]" />
      <Stack.Screen name="browser" options={{ presentation: 'modal', headerShown: false, animation: 'slide_from_bottom' }} />
      <Stack.Screen name="mini-app" options={{ headerShown: false, animation: 'none' }} />
      <Stack.Screen name="mini/[id]" options={{ headerShown: false, animation: 'fade' }} />
      <Stack.Screen name="m/[short]" options={{ headerShown: false, animation: 'fade' }} />
      <Stack.Screen name="notifications" />
      <Stack.Screen name="settings/index" />
      <Stack.Screen name="settings/appearance" />
      <Stack.Screen name="settings/profile-theme" />
      <Stack.Screen name="settings/widget" />
      <Stack.Screen name="settings/storage" />
      <Stack.Screen name="settings/device-key" />
      <Stack.Screen name="settings/privacy" />
      <Stack.Screen name="settings/admin" />
      <Stack.Screen name="settings/fonts" />
      <Stack.Screen name="settings/fonts-size" options={{ presentation: 'modal', animation: 'slide_from_bottom', headerShown: false }} />
      <Stack.Screen name="settings/fonts-family" options={{ presentation: 'modal', animation: 'slide_from_bottom', headerShown: false }} />
      <Stack.Screen name="settings/mini-apps" />
      <Stack.Screen name="settings/chat-settings" />
      <Stack.Screen name="settings/chat-background" options={{ presentation: 'modal', animation: 'slide_from_bottom', headerShown: false }} />
      <Stack.Screen name="settings/chat-text-size" options={{ presentation: 'modal', animation: 'slide_from_bottom', headerShown: false }} />
      <Stack.Screen name="settings/chat-bubble-radius" options={{ presentation: 'modal', animation: 'slide_from_bottom', headerShown: false }} />
      <Stack.Screen name="settings/chat-bubble-color" options={{ presentation: 'modal', animation: 'slide_from_bottom', headerShown: false }} />
      <Stack.Screen name="settings/chat-font" options={{ presentation: 'modal', animation: 'slide_from_bottom', headerShown: false }} />
      <Stack.Screen name="settings/browser" />
      <Stack.Screen name="settings/language" />
      <Stack.Screen name="settings/pixel-icons" options={{ presentation: 'modal', animation: 'slide_from_bottom', headerShown: false }} />
      <Stack.Screen name="settings/mini-app-preview" options={{ presentation: 'modal', animation: 'slide_from_bottom', headerShown: false }} />
    </Stack>
  );
}

const styles = StyleSheet.create({
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#141414' },
  rootColumn: { flex: 1 },
  stackWrapper: { flex: 1 },
  gestureRoot: { flex: 1 },
});

// Wrap with Sentry.wrap so the root component is included in the
// performance + error reporting envelope. This is the recommended way to
// register the entry component per Sentry React Native docs.
export default Sentry.wrap(RootLayout);
