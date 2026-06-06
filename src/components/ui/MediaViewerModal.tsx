import React from 'react';
import { View, Pressable, Modal, StatusBar, Dimensions, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { CachedImage } from './CachedImage';

// Full-screen in-app media viewer.
//   - YouTube/Vimeo play inline. We use an HTML document with `baseUrl` set to
//     the provider origin, which gives the embedded iframe a real https origin
//     and avoids YouTube embed errors 150/153.
//   - Images open as a full-screen viewer.
// Video streams from the provider — zero load on our server / database.

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

export type MediaViewerSource =
  | { kind: 'youtube'; videoId: string }
  | { kind: 'vimeo'; videoId: string }
  | { kind: 'image'; uri: string };

// Build a responsive full-bleed iframe player. baseUrl (set on the WebView
// source) provides the document origin.
export function playerHtml(source: MediaViewerSource): string {
  let src = '';
  if (source.kind === 'youtube') {
    src = `https://www.youtube.com/embed/${source.videoId}?autoplay=1&playsinline=1&rel=0&modestbranding=1&fs=1`;
  } else if (source.kind === 'vimeo') {
    src = `https://player.vimeo.com/video/${source.videoId}?autoplay=1&playsinline=1`;
  }
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:100%;height:100%;background:#000;overflow:hidden}
  .wrap{position:fixed;inset:0}
  iframe{position:absolute;top:0;left:0;width:100%;height:100%;border:0}
</style></head>
<body><div class="wrap">
<iframe src="${src}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen frameborder="0"></iframe>
</div></body></html>`;
}

export function baseUrlFor(source: MediaViewerSource): string {
  return source.kind === 'vimeo' ? 'https://player.vimeo.com' : 'https://www.youtube.com';
}

interface MediaViewerModalProps {
  visible: boolean;
  source: MediaViewerSource | null;
  onClose: () => void;
}

export function MediaViewerModal({ visible, source, onClose }: MediaViewerModalProps) {
  if (!source) return null;
  const isVideo = source.kind === 'youtube' || source.kind === 'vimeo';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent supportedOrientations={['portrait', 'landscape']}>
      <StatusBar hidden />
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.97)' }}>
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
                source={{ html: playerHtml(source), baseUrl: baseUrlFor(source) }}
                style={{ flex: 1, backgroundColor: '#000' }}
                allowsInlineMediaPlayback
                mediaPlaybackRequiresUserAction={false}
                javaScriptEnabled
                domStorageEnabled
                allowsFullscreenVideo
                originWhitelist={['*']}
                scrollEnabled={false}
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
