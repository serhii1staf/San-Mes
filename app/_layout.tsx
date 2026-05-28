import React, { useEffect, useState, useRef } from 'react';
import { View, StyleSheet, Animated, Text as RNText, Image as RNImage } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { ThemeProvider, useTheme } from '../src/theme';
import { fontAssets } from '../src/theme/fonts';
import { useAuthStore, useEntityStore } from '../src/store';

SplashScreen.preventAutoHideAsync().catch(() => {});

function AuthNavigationGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, hasHydrated } = useAuthStore();
  const segments = useSegments();
  const router = useRouter();
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setShowSplash(false), 800);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!hasHydrated || showSplash) return;
    const inAuthGroup = segments[0] === '(auth)';
    if (!isAuthenticated && !inAuthGroup) {
      router.replace('/(auth)/register');
    } else if (isAuthenticated && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [isAuthenticated, segments, hasHydrated, showSplash]);

  if (!hasHydrated || showSplash) {
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
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Animated.View style={{ transform: [{ translateX: logoAnim }], opacity: opacityAnim }}>
          <RNImage source={require('../assets/icon.png')} style={{ width: 44, height: 44, borderRadius: 12 }} />
        </Animated.View>
        <Animated.View style={{ transform: [{ translateX: textAnim }], opacity: opacityAnim }}>
          <RNText style={{ fontSize: 28, fontWeight: '700', color: theme.colors.text.primary }}>San</RNText>
          {user?.displayName && (
            <RNText style={{ fontSize: 13, color: theme.colors.text.tertiary, marginTop: 2 }}>
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
  const isHydrated = useEntityStore((s) => s.isHydrated);
  const { isAuthenticated, user } = useAuthStore();

  useEffect(() => {
    const timer = setTimeout(() => setFontTimeout(true), 3000);
    return () => clearTimeout(timer);
  }, []);

  const ready = fontsLoaded || fontError !== null || fontTimeout;

  useEffect(() => {
    if (ready) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [ready]);

  // Auth store safety timeout (existing)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!useAuthStore.getState().hasHydrated) {
        useAuthStore.setState({ hasHydrated: true });
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  // Hydrate entity store on mount
  useEffect(() => {
    useEntityStore.getState().hydrate();
  }, []);

  // Safety timeout: force isHydrated after 2 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!useEntityStore.getState().isHydrated) {
        useEntityStore.setState({ isHydrated: true });
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  // Load ALL data once when user is authenticated — no per-screen syncs needed
  useEffect(() => {
    if (isAuthenticated && user?.id) {
      import('../src/services/syncService').then(({ syncFeed, syncUserPosts, syncProfiles }) => {
        // Load feed, user posts, and profiles in parallel — one time
        Promise.all([
          syncFeed(user.id),
          syncUserPosts(user.id),
          syncProfiles(),
        ]).catch(() => {});
      });
    }
  }, [isAuthenticated, user?.id]);

  if (!ready || !isHydrated) return null;

  return (
    <ThemeProvider>
      <AuthNavigationGuard>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="chat/[id]" />
          <Stack.Screen name="profile/edit" options={{ presentation: 'transparentModal', animation: 'fade', headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="profile/[id]" />
          <Stack.Screen name="comments/[id]" />
          <Stack.Screen name="browser" options={{ presentation: 'modal', headerShown: false, animation: 'slide_from_bottom' }} />
          <Stack.Screen name="notifications" />
          <Stack.Screen name="settings/index" />
          <Stack.Screen name="settings/appearance" />
          <Stack.Screen name="settings/storage" />
          <Stack.Screen name="settings/device-key" />
          <Stack.Screen name="settings/privacy" />
        </Stack>
      </AuthNavigationGuard>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFF8F0',
  },
});
