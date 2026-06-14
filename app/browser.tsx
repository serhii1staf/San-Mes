import React, { useState, useRef, useEffect } from 'react';
import { View, Pressable, ActivityIndicator, ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../src/theme';
import { Text } from '../src/components/ui';
import { useBrowserStore } from '../src/store/browserStore';

export default function BrowserScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { url } = useLocalSearchParams<{ url: string }>();
  const [isLoading, setIsLoading] = useState(true);
  const [currentUrl, setCurrentUrl] = useState(url || '');
  const [canGoBack, setCanGoBack] = useState(false);
  const webViewRef = useRef<WebView>(null);
  const closedManually = useRef(false);
  // Field-level selectors — destructuring re-rendered the whole browser
  // screen on every unrelated browser-store change.
  const setMinimized = useBrowserStore((s) => s.setMinimized);
  const clearMinimized = useBrowserStore((s) => s.clearMinimized);

  // Clear minimized state when browser opens (user tapped the mini-bar)
  useEffect(() => {
    clearMinimized();
  }, []);

  // When modal is dismissed via swipe (not X button), minimize to bar
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', () => {
      if (!closedManually.current) {
        // Swipe dismiss — save to minimized state
        setMinimized(currentUrl || decodedUrl, displayDomain);
      }
    });
    return unsubscribe;
  }, [navigation, currentUrl]);

  const handleClose = () => {
    closedManually.current = true;
    clearMinimized();
    router.back();
  };

  const decodedUrl = (() => {
    try {
      const decoded = decodeURIComponent(url || '');
      // Validate it's a proper URL
      if (decoded.startsWith('http://') || decoded.startsWith('https://')) return decoded;
      return `https://${decoded}`;
    } catch {
      return url || 'https://google.com';
    }
  })();

  // Extract domain for display
  const displayDomain = (() => {
    try {
      return new URL(decodedUrl).hostname.replace('www.', '');
    } catch {
      return decodedUrl;
    }
  })();

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
      {/* Header bar */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingTop: insets.top,
          paddingBottom: 10,
          paddingHorizontal: 12,
          backgroundColor: theme.colors.background.elevated,
          borderBottomWidth: 0.5,
          borderBottomColor: theme.colors.border.light,
        }}
      >
        {/* Close button */}
        <Pressable onPress={handleClose} style={{ padding: 8 }}>
          <Feather name="x" size={22} color={theme.colors.text.primary} />
        </Pressable>

        {/* Back button */}
        <Pressable
          onPress={() => webViewRef.current?.goBack()}
          style={{ padding: 8, opacity: canGoBack ? 1 : 0.3 }}
          disabled={!canGoBack}
        >
          <Feather name="chevron-left" size={22} color={theme.colors.text.primary} />
        </Pressable>

        {/* URL bar */}
        <View
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: theme.colors.background.secondary,
            borderRadius: 10,
            paddingHorizontal: 12,
            paddingVertical: 8,
            marginHorizontal: 8,
          }}
        >
          <Feather name="lock" size={12} color={theme.colors.text.tertiary} style={{ marginRight: 6 }} />
          <Text variant="caption" color={theme.colors.text.secondary} numberOfLines={1} style={{ flex: 1 }}>
            {displayDomain}
          </Text>
          {isLoading && <ActivityIndicator size="small" color={theme.colors.accent.primary} style={{ marginLeft: 6 }} />}
        </View>

        {/* Reload */}
        <Pressable onPress={() => webViewRef.current?.reload()} style={{ padding: 8 }}>
          <Feather name="refresh-cw" size={18} color={theme.colors.text.secondary} />
        </Pressable>
      </View>

      {/* WebView */}
      <WebView
        ref={webViewRef}
        source={{ uri: decodedUrl }}
        style={{ flex: 1 }}
        onLoadStart={() => setIsLoading(true)}
        onLoadEnd={() => setIsLoading(false)}
        onNavigationStateChange={(navState) => {
          setCanGoBack(navState.canGoBack);
          setCurrentUrl(navState.url);
        }}
        allowsBackForwardNavigationGestures
        javaScriptEnabled
        domStorageEnabled
      />
    </View>
  );
}
