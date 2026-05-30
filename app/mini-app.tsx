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
  const [currentUrl, setCurrentUrl] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  // Decode URL properly — handle double encoding and trim whitespace
  const decodedUrl = (() => {
    let raw = (url || '').trim();
    // Decode until no more encoding
    for (let i = 0; i < 3; i++) {
      try {
        const decoded = decodeURIComponent(raw);
        if (decoded === raw) break;
        raw = decoded;
      } catch { break; }
    }
    raw = raw.trim();
    if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
    if (raw.includes('.')) return `https://${raw}`;
    return `https://${raw}`;
  })();

  const displayName = name || 'App';
  const appEmoji = emoji || '📱';

  const handleMinimize = () => {
    // Store the ACTUAL current URL (not encoded) for reopening
    useBrowserStore.getState().setMinimized(currentUrl || decodedUrl, displayName, true, appEmoji);
    router.back();
  };

  const handleClose = () => {
    useBrowserStore.getState().clearMinimized();
    router.back();
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      {/* Loading overlay on black bg to prevent white flash */}
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
        onError={() => setIsLoading(false)}
        onHttpError={() => setIsLoading(false)}
        renderError={(_errorDomain, _errorCode, errorDesc) => (
          <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
            <Text style={{ fontSize: 16, color: '#FFFFFF', fontWeight: '600', marginBottom: 8 }}>Не удалось загрузить</Text>
            <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', textAlign: 'center' }}>{errorDesc}</Text>
            <Pressable onPress={() => webViewRef.current?.reload()} style={{ marginTop: 16, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.1)' }}>
              <Text style={{ fontSize: 12, color: '#FFFFFF' }}>Повторить</Text>
            </Pressable>
          </View>
        )}
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
        setSupportMultipleWindows={false}
        userAgent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
      />

      {/* Blur buttons — compact, rounded */}
      <View style={{ position: 'absolute', top: insets.top + 8, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between' }}>
        <Pressable onPress={handleMinimize} style={{ borderRadius: 14, overflow: 'hidden' }}>
          <BlurView intensity={80} tint="dark" style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6 }}>
            <Feather name="chevron-down" size={12} color="#FFFFFF" />
            <Text style={{ fontSize: 10, color: '#FFFFFF', fontWeight: '500' }}>Свернуть</Text>
          </BlurView>
        </Pressable>
        <Pressable onPress={handleClose} style={{ borderRadius: 14, overflow: 'hidden' }}>
          <BlurView intensity={80} tint="dark" style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6 }}>
            <Text style={{ fontSize: 10, color: '#FFFFFF', fontWeight: '500' }}>Закрыть</Text>
            <Feather name="x" size={12} color="#FFFFFF" />
          </BlurView>
        </Pressable>
      </View>
    </View>
  );
}
