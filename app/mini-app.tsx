import React, { useRef, useState } from 'react';
import { View, Pressable, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { Text } from '../src/components/ui';
import { useBrowserStore } from '../src/store/browserStore';

export default function MiniAppScreen() {
  const insets = useSafeAreaInsets();
  const { url, name, emoji } = useLocalSearchParams<{ url: string; name: string; emoji: string }>();
  const webViewRef = useRef<WebView>(null);
  const [currentUrl, setCurrentUrl] = useState(url || '');
  const [isLoading, setIsLoading] = useState(true);

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
  const displayDomain = (() => { try { return new URL(decodedUrl).hostname.replace('www.', ''); } catch { return ''; } })();

  const handleMinimize = () => {
    useBrowserStore.getState().setMinimized(currentUrl || decodedUrl, displayDomain, true);
    router.back();
  };

  const handleClose = () => {
    useBrowserStore.getState().clearMinimized();
    router.back();
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      {/* Loading indicator on black bg (no white flash) */}
      {isLoading && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000', zIndex: 50, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color="#FFFFFF" />
        </View>
      )}

      {/* Full-screen WebView */}
      <WebView
        ref={webViewRef}
        source={{ uri: decodedUrl }}
        style={{ flex: 1, backgroundColor: '#000' }}
        onLoadStart={() => setIsLoading(true)}
        onLoadEnd={() => setIsLoading(false)}
        onNavigationStateChange={(navState) => setCurrentUrl(navState.url)}
        allowsBackForwardNavigationGestures
        javaScriptEnabled
        domStorageEnabled
        bounces={true}
        scrollEnabled={true}
        decelerationRate="normal"
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        allowsFullscreenVideo
        sharedCookiesEnabled={true}
        thirdPartyCookiesEnabled={true}
        cacheEnabled={true}
        javaScriptCanOpenWindowsAutomatically={true}
        mixedContentMode="always"
        originWhitelist={['*']}
        userAgent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
      />

      {/* Blur buttons */}
      <View style={{ position: 'absolute', top: insets.top + 8, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between' }}>
        <Pressable onPress={handleMinimize} style={{ borderRadius: 14, overflow: 'hidden' }}>
          <BlurView intensity={60} tint="dark" style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6 }}>
            <Feather name="chevron-down" size={12} color="#FFFFFF" />
            <Text style={{ fontSize: 10, color: '#FFFFFF', fontWeight: '500' }}>Свернуть</Text>
          </BlurView>
        </Pressable>
        <Pressable onPress={handleClose} style={{ borderRadius: 14, overflow: 'hidden' }}>
          <BlurView intensity={60} tint="dark" style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6 }}>
            <Text style={{ fontSize: 10, color: '#FFFFFF', fontWeight: '500' }}>Закрыть</Text>
            <Feather name="x" size={12} color="#FFFFFF" />
          </BlurView>
        </Pressable>
      </View>
    </View>
  );
}
