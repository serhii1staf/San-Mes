import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { ThemeProvider } from '../src/theme';
import { fontAssets } from '../src/theme/fonts';
import { useAuthStore } from '../src/store';

SplashScreen.preventAutoHideAsync().catch(() => {
  // If preventAutoHideAsync fails (e.g., called too late), ignore the error
});

function AuthNavigationGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, hasHydrated } = useAuthStore();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!hasHydrated) return;

    const inAuthGroup = segments[0] === '(auth)';

    if (!isAuthenticated && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (isAuthenticated && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [isAuthenticated, segments, hasHydrated]);

  if (!hasHydrated) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#E8856C" />
      </View>
    );
  }

  return <>{children}</>;
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(fontAssets);
  const [fontTimeout, setFontTimeout] = useState(false);

  // Safety timeout: if fonts take more than 3 seconds, proceed without them
  useEffect(() => {
    const timer = setTimeout(() => {
      setFontTimeout(true);
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  const ready = fontsLoaded || fontError !== null || fontTimeout;

  useEffect(() => {
    if (ready) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [ready]);

  // Also force hasHydrated after a timeout in case persist middleware fails
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
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#E8856C" />
      </View>
    );
  }

  return (
    <ThemeProvider>
      <AuthNavigationGuard>
        <Stack
          screenOptions={{
            headerShown: false,
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
          <Stack.Screen name="(auth)" options={{ animation: 'fade' }} />
          <Stack.Screen name="chat/[id]" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="profile/edit" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
          <Stack.Screen name="settings/index" options={{ animation: 'slide_from_right' }} />
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
