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
    useBrowserStore.getState().setMinimized(currentUrl || decodedUrl, displayName, true);
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
        sharedCookiesEnabled={true}
        thirdPartyCookiesEnabled={true}
        userAgent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
      />

      {/* Floating buttons */}
      <View style={{ position: 'absolute', top: insets.top + 8, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between' }}>
        <Pressable onPress={handleMinimize} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 10, backgroundColor: 'rgba(50,50,50,0.9)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.15)' }}>
          <Feather name="chevron-down" size={12} color="rgba(255,255,255,0.9)" />
          <Text style={{ fontSize: 9, color: 'rgba(255,255,255,0.9)', fontWeight: '500' }}>Свернуть</Text>
        </Pressable>
        <Pressable onPress={handleClose} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 10, backgroundColor: 'rgba(50,50,50,0.9)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.15)' }}>
          <Text style={{ fontSize: 9, color: 'rgba(255,255,255,0.9)', fontWeight: '500' }}>Закрыть</Text>
          <Feather name="x" size={12} color="rgba(255,255,255,0.9)" />
        </Pressable>
      </View>
    </View>
  );
}
