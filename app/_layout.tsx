import React, { useEffect, useState, useRef } from 'react';
import { View, StyleSheet, Animated, Text as RNText, Image as RNImage } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { ThemeProvider, useTheme } from '../src/theme';
import { fontAssets } from '../src/theme/fonts';
import { useAuthStore } from '../src/store';
import { BrowserMiniBar } from '../src/components/ui/BrowserMiniBar';
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
  const { isAuthenticated, hasHydrated } = useAuthStore();
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
        router.replace('/(auth)/register');
        setIsLoggingOut(false);
      }, 50);
    } else if (isAuthenticated && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [isAuthenticated, segments, hasHydrated, showSplash]);

  if (!hasHydrated || showSplash || isLoggingOut) {
    return <CustomSplash />;
  }
  return <>{children}</>;
}

function CustomSplash() {
  const theme = useTheme();
  const { user } = useAuthStore();
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
          {user?.displayName && (
            <RNText numberOfLines={1} style={{ fontSize: 13, color: theme.colors.text.tertiary, marginTop: 2 }}>
              Привет, {user.displayName}
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
    if (ready) {
      SplashScreen.hideAsync().catch(() => {});
      initRateLimits();
      cacheCleanup();
      // Scope the cache to the logged-in account BEFORE hydrating, so each account
      // loads only its own cached feed/conversations/etc. (Telegram-style isolation).
      const currentUser = useAuthStore.getState().user;
      setCacheAccount(currentUser?.id);
      setThrottleAccount(currentUser?.id);
      // Reload cached data (feed, conversations, profiles) into memory so chats/posts
      // survive an app restart even before any network sync runs.
      useEntityStore.getState().hydrate();
      useConnectivityStore.getState().start();
    }
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
        <Toast />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="chat/[id]" />
          <Stack.Screen name="chat/ai" />
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
      </AuthNavigationGuard>
    </ThemeProvider>
    </KeyboardProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#141414' },
});
