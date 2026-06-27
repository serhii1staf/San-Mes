import React, { useState } from 'react';
import { View, Pressable, Modal, Dimensions, ActivityIndicator } from 'react-native';
import { ModalStatusBar } from './ModalStatusBar';
import { Feather } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import YoutubePlayer from 'react-native-youtube-iframe';
import { CachedImage } from './CachedImage';

// Full-screen in-app media viewer.
//   - YouTube → official YouTube IFrame Player API via react-native-youtube-iframe
//     (reliable, avoids embed errors 150/152/153).
//   - Vimeo → embedded WebView player.
//   - Images → full-screen viewer.
// Video streams from the provider — zero load on our server / database.

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// --- Vimeo WebView hardening (module-scope pure helpers, NOT hooks) ---
// Allowed origins for the embedded Vimeo player WebView.
const VIMEO_ORIGIN_WHITELIST = ['https://*.vimeo.com', 'https://vimeo.com'];

// Vimeo video ids are digits only. Return a safe numeric id or '' when invalid.
function getSafeVimeoId(videoId: unknown): string {
  return /^\d+$/.test(String(videoId)) ? String(videoId) : '';
}

// Only allow navigation to Vimeo (or about:blank) inside the player WebView so
// the embedded page can't be used to navigate elsewhere.
function isAllowedVimeoNavigation(url: string): boolean {
  if (!url || url === 'about:blank') return true;
  return /^https:\/\/([a-z0-9-]+\.)*vimeo\.com(\/|$|\?|#)/i.test(url);
}

export type MediaViewerSource =
  | { kind: 'youtube'; videoId: string }
  | { kind: 'vimeo'; videoId: string }
  | { kind: 'image'; uri: string };

interface MediaViewerModalProps {
  visible: boolean;
  source: MediaViewerSource | null;
  onClose: () => void;
}

export function MediaViewerModal({ visible, source, onClose }: MediaViewerModalProps) {
  if (!source) return null;
  const isVideo = source.kind === 'youtube' || source.kind === 'vimeo';
  const playerW = SCREEN_W;
  const playerH = Math.round(SCREEN_W * (9 / 16));

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent supportedOrientations={['portrait', 'landscape']}>
      <ModalStatusBar />
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
            {source.kind === 'youtube' ? (
              <YoutubePlayer height={playerH} width={playerW} play videoId={source.videoId} webViewProps={{ allowsInlineMediaPlayback: true }} />
            ) : (
              <View style={{ width: playerW, height: playerH, backgroundColor: '#000' }}>
                {getSafeVimeoId(source.videoId) ? (
                  <WebView
                    source={{ uri: `https://player.vimeo.com/video/${getSafeVimeoId(source.videoId)}?autoplay=1&playsinline=1` }}
                    style={{ flex: 1, backgroundColor: '#000' }}
                    allowsInlineMediaPlayback
                    mediaPlaybackRequiresUserAction={false}
                    javaScriptEnabled
                    allowsFullscreenVideo
                    originWhitelist={VIMEO_ORIGIN_WHITELIST}
                    onShouldStartLoadWithRequest={(req) => isAllowedVimeoNavigation(req.url)}
                    startInLoadingState
                    renderLoading={() => (
                      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' }}>
                        <ActivityIndicator color="#FFFFFF" />
                      </View>
                    )}
                  />
                ) : (
                  <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' }}>
                    <ActivityIndicator color="#FFFFFF" />
                  </View>
                )}
              </View>
            )}
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

// Inline (in-card) player used by LinkPreview. Auto-fills the given width with
// a 16:9 height. YouTube uses the official IFrame API for reliability.
export function InlineVideoPlayer({ source, width }: { source: MediaViewerSource; width: number }) {
  const height = Math.round(width * (9 / 16));
  if (source.kind === 'youtube') {
    return (
      <View style={{ width: '100%', backgroundColor: '#000' }}>
        <YoutubePlayer height={height} width={width} play videoId={source.videoId} webViewProps={{ allowsInlineMediaPlayback: true }} />
      </View>
    );
  }
  if (source.kind === 'vimeo') {
    const safeVimeoId = getSafeVimeoId(source.videoId);
    return (
      <View style={{ width: '100%', height, backgroundColor: '#000' }}>
        {safeVimeoId ? (
          <WebView
            source={{ uri: `https://player.vimeo.com/video/${safeVimeoId}?autoplay=1&playsinline=1` }}
            style={{ flex: 1, backgroundColor: '#000' }}
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            javaScriptEnabled
            allowsFullscreenVideo
            originWhitelist={VIMEO_ORIGIN_WHITELIST}
            onShouldStartLoadWithRequest={(req) => isAllowedVimeoNavigation(req.url)}
          />
        ) : null}
      </View>
    );
  }
  return null;
}
