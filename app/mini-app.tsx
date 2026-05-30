import React, { useRef, useState } from 'react';
import { View, Pressable } from 'react-native';
import { WebView } from 'react-native-webview';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../src/theme';
import { Text } from '../src/components/ui';
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

  const displayName = name || (() => { try { return new URL(decodedUrl).hostname.replace('www.', ''); } catch { return 'App'; } })();

  const handleMinimize = () => {
    useBrowserStore.getState().setMinimized(currentUrl || decodedUrl, `${emoji || '🎮'} ${displayName}`);
    router.back();
  };

  const handleClose = () => {
    useBrowserStore.getState().clearMinimized();
    router.back();
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      {/* Full-screen WebView */}
      <WebView
        ref={webViewRef}
        source={{ uri: decodedUrl }}
        style={{ flex: 1 }}
        onNavigationStateChange={(navState) => setCurrentUrl(navState.url)}
        allowsBackForwardNavigationGestures
        javaScriptEnabled
        domStorageEnabled
        bounces={true}
        scrollEnabled={true}
        decelerationRate="normal"
        allowsInlineMediaPlayback
      />

      {/* Floating buttons with blurred background */}
      <View style={{ position: 'absolute', top: insets.top + 8, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between' }}>
        {/* Minimize (left) */}
        <Pressable onPress={handleMinimize} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <Feather name="minus" size={16} color="#FFFFFF" />
          <Text style={{ fontSize: 11, color: '#FFFFFF', fontWeight: '600' }}>Свернуть</Text>
        </Pressable>
        {/* Close (right) */}
        <Pressable onPress={handleClose} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <Text style={{ fontSize: 11, color: '#FFFFFF', fontWeight: '600' }}>Закрыть</Text>
          <Feather name="x" size={16} color="#FFFFFF" />
        </Pressable>
      </View>
    </View>
  );
}
