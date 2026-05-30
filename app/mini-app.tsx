import React, { useRef, useState } from 'react';
import { View, Pressable } from 'react-native';
import { WebView } from 'react-native-webview';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../src/theme';
import { useBrowserStore } from '../src/store/browserStore';

export default function MiniAppScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { url, name, emoji } = useLocalSearchParams<{ url: string; name: string; emoji: string }>();
  const webViewRef = useRef<WebView>(null);
  const [currentUrl, setCurrentUrl] = useState(url || '');

  const decodedUrl = (() => {
    try {
      const decoded = decodeURIComponent(url || '');
      if (decoded.startsWith('http')) return decoded;
      return `https://${decoded}`;
    } catch {
      return url || 'https://google.com';
    }
  })();

  const displayDomain = (() => {
    try { return new URL(decodedUrl).hostname.replace('www.', ''); } catch { return decodedUrl; }
  })();

  const handleMinimize = () => {
    // Save to minimized state (like browser mini-bar)
    useBrowserStore.getState().setMinimized(currentUrl || decodedUrl, `${emoji || '🎮'} ${name || displayDomain}`);
    router.back();
  };

  const handleClose = () => {
    useBrowserStore.getState().clearMinimized();
    router.back();
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
      {/* Floating buttons over WebView */}
      <View style={{ position: 'absolute', top: insets.top + 8, left: 16, right: 16, zIndex: 100, flexDirection: 'row', justifyContent: 'space-between' }}>
        {/* Minimize (left) */}
        <Pressable onPress={handleMinimize} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' }}>
          <Feather name="minus" size={18} color="#FFFFFF" />
        </Pressable>
        {/* Close (right) */}
        <Pressable onPress={handleClose} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' }}>
          <Feather name="x" size={18} color="#FFFFFF" />
        </Pressable>
      </View>

      {/* Full-screen WebView */}
      <WebView
        ref={webViewRef}
        source={{ uri: decodedUrl }}
        style={{ flex: 1 }}
        onNavigationStateChange={(navState) => setCurrentUrl(navState.url)}
        allowsBackForwardNavigationGestures
        javaScriptEnabled
        domStorageEnabled
      />
    </View>
  );
}
