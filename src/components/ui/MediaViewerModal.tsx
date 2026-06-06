import React from 'react';
import { View, Pressable, Modal, StatusBar, Dimensions, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { CachedImage } from './CachedImage';

// In-app media viewer (Discord/Telegram style):
//   - YouTube/Vimeo videos play INLINE inside the app via an embedded player
//     (the video streams from the provider — zero load on our server / DB).
//   - Images open as a full-screen zoomable-ish image viewer.
// Opens as a lightweight modal so the user never leaves the app.

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

function youtubeEmbedHtml(videoId: string): string {
  // Autoplay, inline, no related videos at end. The player + stream come from
  // YouTube directly — our backend is not involved at all.
  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<style>html,body{margin:0;background:#000;height:100%;overflow:hidden}.w{position:absolute;inset:0}iframe{width:100%;height:100%;border:0}</style></head>
<body><div class="w"><iframe src="https://www.youtube.com/embed/${videoId}?autoplay=1&playsinline=1&rel=0&modestbranding=1" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div></body></html>`;
}

function vimeoEmbedHtml(videoId: string): string {
  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<style>html,body{margin:0;background:#000;height:100%;overflow:hidden}iframe{position:absolute;inset:0;width:100%;height:100%;border:0}</style></head>
<body><iframe src="https://player.vimeo.com/video/${videoId}?autoplay=1&playsinline=1" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe></body></html>`;
}

export function MediaViewerModal({ visible, source, onClose }: MediaViewerModalProps) {
  if (!source) return null;

  const isVideo = source.kind === 'youtube' || source.kind === 'vimeo';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent supportedOrientations={['portrait', 'landscape']}>
      <StatusBar hidden />
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.96)' }}>
        {/* Close button */}
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
                source={{ html: source.kind === 'youtube' ? youtubeEmbedHtml(source.videoId) : vimeoEmbedHtml(source.videoId) }}
                style={{ flex: 1, backgroundColor: '#000' }}
                allowsInlineMediaPlayback
                mediaPlaybackRequiresUserAction={false}
                javaScriptEnabled
                domStorageEnabled
                allowsFullscreenVideo
                startInLoadingState
                renderLoading={() => (
                  <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' }}>
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
