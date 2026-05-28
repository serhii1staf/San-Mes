import React, { useEffect, useState, useRef } from 'react';
import { View, StyleSheet, Animated, Text as RNText, Image as RNImage, AppState } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { ThemeProvider, useTheme } from '../src/theme';
import { fontAssets } from '../src/theme/fonts';
import { useAuthStore } from '../src/store';
import { initDatabase } from '../src/lib/database';
import { useEntityStore } from '../src/lib/entityStore';
import { fullSync, startSyncLoop, stopSyncLoop } from '../src/lib/syncEngine';

SplashScreen.preventAutoHideAsync().catch(() => {});

// Module-level: initialize database and hydrate entity store before any component renders
try {
  const dbReady = initDatabase();
  if (dbReady) {
    useEntityStore.getState().hydrate();
  }
} catch (e) {
  // Ensure the app never crashes during initialization
  console.warn('[Layout] Module-level init failed:', e);
}

/**
 * Manages the sync loop lifecycle based on app state and user authentication.
 * Starts sync when the app is active and user is authenticated,
 * stops sync when the app goes to background/inactive or user logs out.
 */
function useSyncLifecycle(userId: string | undefined) {
  useEffect(() => {
    if (!userId) return;

    // Initial full sync then start the loop
    fullSync(userId).then(() => {
      startSyncLoop();
    });

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        startSyncLoop();
      } else {
        // 'background' or 'inactive'
        stopSyncLoop();
      }
    });

    return () => {
      stopSyncLoop();
      subscription.remove();
    };
  }, [userId]);
}

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
  const { user } = useAuthStore();

  // Sync lifecycle: start/stop sync loop based on auth and app state
  useSyncLifecycle(user?.id);

  // Safety timeout: if fonts take more than 3 seconds, proceed without them
  useEffect(() => {
    const timer = setTimeout(() => setFontTimeout(true), 3000);
    return () => clearTimeout(timer);
  }, []);

  // Safety timeout: force entityStore isHydrated after 2 seconds if it hasn't been set
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!useEntityStore.getState().isHydrated) {
        useEntityStore.setState({ isHydrated: true });
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  const ready = (fontsLoaded || fontError !== null || fontTimeout) && isHydrated;

  useEffect(() => {
    if (ready) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [ready]);

  // Force hasHydrated after timeout in case persist middleware fails
  useEffect(() => {
    const timer = setTimeout(() => {
      const state = useAuthStore.getState();
      if (!state.hasHydrated) {
        useAuthStore.setState({ hasHydrated: true });
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  if (!ready) {
    return <CustomSplash />;
  }

  return (
    <ThemeProvider>
      <AuthNavigationGuard>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="chat/[id]" />
          <Stack.Screen
            name="profile/edit"
            options={{
              presentation: 'transparentModal',
              animation: 'fade',
              headerShown: false,
              contentStyle: { backgroundColor: 'transparent' },
            }}
          />
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
