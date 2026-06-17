import React, { useEffect, useState, useRef } from 'react';
import { View, StyleSheet, Animated, Text as RNText, Image as RNImage } from 'react-native';
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
import { Toast } from '../src/components/ui/Toast';
import { initRateLimits } from '../src/services/rateLimit';
import { cacheCleanup } from '../src/services/cacheManager';
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
    const timer = setTimeout(() => setShowSplash(false), 800);
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
  const theme = useTheme();
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

  return (
    <View style={[styles.loadingContainer, { backgroundColor: theme.colors.background.primary }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 32, maxWidth: '90%' }}>
        <Animated.View style={{ transform: [{ translateX: logoAnim }], opacity: opacityAnim }}>
          <RNImage source={require('../assets/icon.png')} style={{ width: 44, height: 44, borderRadius: 12 }} />
        </Animated.View>
        <Animated.View style={{ transform: [{ translateX: textAnim }], opacity: opacityAnim, flexShrink: 1 }}>
          <RNText style={{ fontSize: 28, fontWeight: '700', color: theme.colors.text.primary }}>San</RNText>
          {displayName && (
            <RNText numberOfLines={1} style={{ fontSize: 13, color: theme.colors.text.tertiary, marginTop: 2 }}>
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

    return () => clearTimeout(idle);
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
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="(auth)" />
              <Stack.Screen name="chat/[id]" />
              <Stack.Screen name="chat/ai" />
              <Stack.Screen name="chat/music" />
              <Stack.Screen name="profile/edit" options={{ presentation: 'modal', animation: 'slide_from_bottom', headerShown: false }} />
              <Stack.Screen name="profile/[id]" />
              <Stack.Screen name="comments/[id]" />
              <Stack.Screen name="browser" options={{ presentation: 'modal', headerShown: false, animation: 'slide_from_bottom' }} />
              <Stack.Screen name="mini-app" options={{ presentation: 'fullScreenModal', headerShown: false, animation: 'slide_from_bottom' }} />
              <Stack.Screen name="mini/[id]" options={{ headerShown: false, animation: 'fade' }} />
              <Stack.Screen name="m/[short]" options={{ headerShown: false, animation: 'fade' }} />
              <Stack.Screen name="notifications" />
              <Stack.Screen name="settings/index" />
              <Stack.Screen name="settings/appearance" />
              <Stack.Screen name="settings/widget" />
              <Stack.Screen name="settings/storage" />
              <Stack.Screen name="settings/device-key" />
              <Stack.Screen name="settings/privacy" />
              <Stack.Screen name="settings/admin" />
              <Stack.Screen name="settings/fonts" />
              <Stack.Screen
                name="settings/fonts-size"
                options={{
                  presentation: 'modal',
                  animation: 'slide_from_bottom',
                  headerShown: false,
                }}
              />
              <Stack.Screen
                name="settings/fonts-family"
                options={{
                  presentation: 'modal',
                  animation: 'slide_from_bottom',
                  headerShown: false,
                }}
              />
              <Stack.Screen name="settings/mini-apps" />
              <Stack.Screen name="settings/chat-settings" />
              <Stack.Screen
                name="settings/chat-background"
                options={{
                  presentation: 'modal',
                  animation: 'slide_from_bottom',
                  headerShown: false,
                }}
              />
              <Stack.Screen
                name="settings/chat-text-size"
                options={{
                  presentation: 'modal',
                  animation: 'slide_from_bottom',
                  headerShown: false,
                }}
              />
              <Stack.Screen
                name="settings/chat-bubble-radius"
                options={{
                  presentation: 'modal',
                  animation: 'slide_from_bottom',
                  headerShown: false,
                }}
              />
              <Stack.Screen
                name="settings/chat-font"
                options={{
                  presentation: 'modal',
                  animation: 'slide_from_bottom',
                  headerShown: false,
                }}
              />
              <Stack.Screen name="settings/browser" />
              <Stack.Screen name="settings/language" />
              <Stack.Screen
                name="settings/pixel-icons"
                options={{
                  presentation: 'modal',
                  animation: 'slide_from_bottom',
                  headerShown: false,
                }}
              />
              <Stack.Screen
                name="settings/mini-app-preview"
                options={{
                  presentation: 'modal',
                  animation: 'slide_from_bottom',
                  headerShown: false,
                }}
              />
            </Stack>
          </View>
          <BrowserBottomBand />
        </View>
        {/* Floating performance monitor — sits above everything else so it
            stays visible on every screen. Defaults to ON; users can hide it
            from the panel that opens when they tap the bubble. */}
        <PerfMonitorBubble />
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
