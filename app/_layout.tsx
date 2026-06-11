import React, { useEffect, useState, useRef } from 'react';
import { View, StyleSheet, Animated, Text as RNText, Image as RNImage } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
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
import { KeyboardProvider } from 'react-native-keyboard-controller';

SplashScreen.preventAutoHideAsync().catch(() => {});

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
  return <>{children}</>;
}

function CustomSplash() {
  const theme = useTheme();
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
              Привет, {displayName}
            </RNText>
          )}
        </Animated.View>
      </View>
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(fontAssets);
  const [fontTimeout, setFontTimeout] = useState(false);

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
    <KeyboardProvider>
    <ThemeProvider>
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
              <Stack.Screen name="profile/edit" options={{ presentation: 'transparentModal', animation: 'fade', headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
              <Stack.Screen name="profile/[id]" />
              <Stack.Screen name="comments/[id]" />
              <Stack.Screen name="browser" options={{ presentation: 'modal', headerShown: false, animation: 'slide_from_bottom' }} />
              <Stack.Screen name="mini-app" options={{ presentation: 'fullScreenModal', headerShown: false, animation: 'slide_from_bottom' }} />
              <Stack.Screen name="notifications" />
              <Stack.Screen name="settings/index" />
              <Stack.Screen name="settings/appearance" />
              <Stack.Screen name="settings/widget" />
              <Stack.Screen name="settings/storage" />
              <Stack.Screen name="settings/device-key" />
              <Stack.Screen name="settings/privacy" />
              <Stack.Screen name="settings/admin" />
              <Stack.Screen name="settings/fonts" />
              <Stack.Screen name="settings/mini-apps" />
              <Stack.Screen name="settings/chat-settings" />
            </Stack>
          </View>
          <BrowserBottomBand />
        </View>
      </AuthNavigationGuard>
    </ThemeProvider>
    </KeyboardProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#141414' },
  rootColumn: { flex: 1 },
  stackWrapper: { flex: 1 },
});
