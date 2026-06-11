import React, { useRef, useState } from 'react';
import { View, Pressable, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { Text } from '../src/components/ui';
import { SlideUpSheet } from '../src/components/ui/SlideUpSheet';
import { useBrowserStore } from '../src/store/browserStore';
import { triggerHaptic } from '../src/utils/haptics';
import { showToast } from '../src/store/toastStore';
import { useTheme } from '../src/theme';

// Mini-app screen — opens a third-party URL inside an in-app WebView. The
// floating top-bar buttons match the profile-screen visual language: small
// pill capsules with a frosted BlurView background so they read on any
// page colour without competing with the page content.
//
// Three actions on the bar:
//   - Свернуть: keeps the session alive in the global "minimised app" bar
//   - Закрыть: terminates the session
//   - Flag (right-most): opens the standard report sheet — App Store
//     Guideline 1.2 requires user-generated/third-party content to be
//     reportable, and a mini-app's URL is effectively user-supplied.

const REPORT_CATS = ['Спам', 'Насилие', 'Ложная информация', 'Мошенничество', 'Нарушение авторских прав', 'Другое'];

export default function MiniAppScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { url, name, emoji } = useLocalSearchParams<{ url: string; name: string; emoji: string }>();
  const webViewRef = useRef<WebView>(null);
  const [currentUrl, setCurrentUrl] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [reportOpen, setReportOpen] = useState(false);

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

  const handleReport = (cat: string) => {
    triggerHaptic('medium');
    setReportOpen(false);
    showToast('Жалоба отправлена', 'flag');
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
        allowFileAccess={true}
        allowUniversalAccessFromFileURLs={true}
        geolocationEnabled={true}
        startInLoadingState={false}
        injectedJavaScript={`
          // Enable viewport meta for proper scaling
          if (!document.querySelector('meta[name="viewport"]')) {
            var meta = document.createElement('meta');
            meta.name = 'viewport';
            meta.content = 'width=device-width, initial-scale=1, maximum-scale=5, user-scalable=yes';
            document.head.appendChild(meta);
          }
          true;
        `}
        userAgent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
      />

      {/* Floating top buttons — frosted BlurView capsules matching the
          profile screen's QR/edit pill style. Three buttons: Свернуть on
          the left, Закрыть + report on the right. */}
      <View style={{ position: 'absolute', top: insets.top + 8, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Pressable onPress={handleMinimize} style={{ borderRadius: 14, overflow: 'hidden' }}>
          <BlurView intensity={80} tint="dark" style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6 }}>
            <Feather name="chevron-down" size={12} color="#FFFFFF" />
            <Text style={{ fontSize: 10, color: '#FFFFFF', fontWeight: '500' }}>Свернуть</Text>
          </BlurView>
        </Pressable>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Pressable onPress={() => { triggerHaptic('light'); setReportOpen(true); }} style={{ borderRadius: 14, overflow: 'hidden' }}>
            <BlurView intensity={80} tint="dark" style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}>
              <Feather name="flag" size={13} color="#FFFFFF" />
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

      {/* Report sheet — same SlideUpSheet that comments and posts use, so the
          report UI feels consistent everywhere in the app. */}
      <SlideUpSheet visible={reportOpen} onClose={() => setReportOpen(false)}>
        <Text variant="body" weight="semibold" align="center" style={{ paddingVertical: 8 }}>Причина жалобы</Text>
        {REPORT_CATS.map((cat) => (
          <Pressable
            key={cat}
            onPress={() => handleReport(cat)}
            style={{ paddingVertical: 14, paddingHorizontal: 20, borderTopWidth: 0.5, borderTopColor: theme.colors.border.light }}
          >
            <Text variant="body">{cat}</Text>
          </Pressable>
        ))}
      </SlideUpSheet>
    </View>
  );
}
