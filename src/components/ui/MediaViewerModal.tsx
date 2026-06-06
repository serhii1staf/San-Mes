import React from 'react';
import { View, Pressable, Modal, StatusBar, Dimensions, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { CachedImage } from './CachedImage';

// Full-screen in-app media viewer.
//   - YouTube/Vimeo play inline via the provider's embed page (loaded by URL so
//     the iframe has a real https origin — avoids YouTube embed error 150/153).
//   - Images open as a full-screen viewer.
// Video streams from the provider — zero load on our server / database.

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

export type MediaViewerSource =
  | { kind: 'youtube'; videoId: string }
  | { kind: 'vimeo'; videoId: string }
  | { kind: 'image'; uri: string };

interface MediaViewerModalProps {
  visible: boolean;
  source: MediaViewerSource | null;
  onClose: () => void;
}

export function embedUrlFor(source: MediaViewerSource): string {
  if (source.kind === 'youtube') {
    // Load by URL with a real origin → fixes embed errors 150/153.
    return `https://www.youtube-nocookie.com/embed/${source.videoId}?autoplay=1&playsinline=1&rel=0&modestbranding=1&fs=1&origin=https://san-m-app.com`;
  }
  if (source.kind === 'vimeo') {
    return `https://player.vimeo.com/video/${source.videoId}?autoplay=1&playsinline=1`;
  }
  return '';
}

export function MediaViewerModal({ visible, source, onClose }: MediaViewerModalProps) {
  if (!source) return null;
  const isVideo = source.kind === 'youtube' || source.kind === 'vimeo';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent supportedOrientations={['portrait', 'landscape']}>
      <StatusBar hidden />
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.96)' }}>
        <Pressable
          onPress={onClose}
          style={{ position: 'absolute', top: 50, right: 18, zIndex: 10, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' }}
          hitSlop={10}
        >
          <Feather name="x" size={22} color="#FFFFFF" />
        </Pressable>

        {isVideo ? (
          <View style={{ flex: 1, justifyContent: 'center' }}>
            <View style={{ width: SCREEN_W, height: SCREEN_W * (9 / 16), backgroundColor: '#000' }}>
              <WebView
                source={{ uri: embedUrlFor(source) }}
                style={{ flex: 1, backgroundColor: '#000' }}
                allowsInlineMediaPlayback
                mediaPlaybackRequiresUserAction={false}
                javaScriptEnabled
                domStorageEnabled
                allowsFullscreenVideo
                originWhitelist={['*']}
                startInLoadingState
                renderLoading={() => (
                  <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' }}>
                    <ActivityIndicator color="#FFFFFF" />
                  </View>
                )}
              />
            </View>
          </View>
        ) : (
          <Pressable style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }} onPress={onClose}>
            <CachedImage uri={source.uri} style={{ width: SCREEN_W, height: SCREEN_H * 0.8 }} resizeMode="contain" />
          </Pressable>
        )}
      </View>
    </Modal>
  );
}
