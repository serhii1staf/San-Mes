/**
 * Telegram-style fullscreen "Chat background" preview modal.
 *
 * Live preview at the top against the candidate background, then a
 * horizontally-scrolling list of choices: "no background", a handful of
 * bundled gradient presets, and a "from gallery" tile that uses
 * expo-image-picker (ALREADY in the bundle, no new native module).
 *
 * Pending state lives locally — Apply commits it to chatSettingsStore;
 * Cancel / X exits with no change.
 *
 * Why solid-gradient presets instead of bundled image assets: the spec
 * forbids new packages and zip packs are gitignored. Synthesising the
 * presets at render time keeps the bundle size flat and gives us full
 * theme-aware control. Choose-from-gallery still lets users pick anything.
 */

import React, { useState, useMemo } from 'react';
import {
  View,
  Pressable,
  StyleSheet,
  Text as RNText,
  ScrollView,
  Dimensions,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '../../src/theme';
import { ShrinkingModalTitle } from '../../src/components/ui';
import { useLiquidGlassActive, NativeGlassView, GlassBg } from '../../src/components/ui/LiquidGlass';
import { ChatPreviewBubbles } from '../../src/components/ui/ChatPreviewBubbles';
import { buildPresetGradientUri } from '../../src/components/ui/ChatBackgroundLayer';
import {
  useChatSettingsStore,
  GLOBAL_CHAT_SETTINGS_KEY,
} from '../../src/store/chatSettingsStore';
import { showToast } from '../../src/store/toastStore';
import { triggerHaptic } from '../../src/utils/haptics';
import { useT } from '../../src/i18n/store';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const PREVIEW_HEIGHT = Math.round(SCREEN_HEIGHT * 0.55);

// Bundled gradient presets. Each preset gets a stable `preset:gradient:`
// pseudo-URI so we can persist them in chatSettingsStore.backgroundImage
// (a string URI) without changing the store schema. ChatBackgroundLayer
// detects the prefix and renders LinearGradient instead of an Image — both
// the preview here and the live chat screen use that helper, so what you
// see in this modal is exactly what the chat will look like.
const PRESETS: { id: string; from: string; to: string }[] = [
  { id: 'sunrise', from: '#FFD194', to: '#D1913C' },
  { id: 'lavender', from: '#A18CD1', to: '#FBC2EB' },
  { id: 'mint', from: '#84FAB0', to: '#8FD3F4' },
  { id: 'ocean', from: '#5EE7DF', to: '#B490CA' },
  { id: 'sunset', from: '#FF9A8B', to: '#FF6A88' },
  { id: 'graphite', from: '#434343', to: '#000000' },
];

export default function ChatBackgroundScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const glassActive = useLiquidGlassActive();
  const { id } = useLocalSearchParams<{ id: string }>();
  const chatId = id || GLOBAL_CHAT_SETTINGS_KEY;

  const getSettings = useChatSettingsStore((s) => s.getSettings);
  const updateSettings = useChatSettingsStore((s) => s.updateSettings);
  const applied = useMemo(() => getSettings(chatId), [chatId, getSettings]);

  // pending = candidate URI (or undefined for "no background"). Initialised
  // from the currently-applied wallpaper so re-opening the screen lands you
  // on the right tile.
  const [pending, setPending] = useState<string | undefined>(applied.backgroundImage);

  const onCancel = () => {
    triggerHaptic('selection');
    router.back();
  };

  const onApply = () => {
    triggerHaptic('medium');
    if (pending !== applied.backgroundImage) {
      updateSettings(chatId, { backgroundImage: pending });
      showToast(pending ? t('chat_settings.toast.bg_set') : t('chat_settings.toast.bg_removed'), 'check');
    }
    router.back();
  };

  const onPickGallery = async () => {
    triggerHaptic('selection');
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.8,
      });
      if (!result.canceled && result.assets[0]) {
        setPending(result.assets[0].uri);
      }
    } catch {
      // Gallery permission denied or another picker failure — keep the
      // current pending state, no toast (the OS already shows its own UI).
    }
  };

  const onPickPreset = (uri: string | undefined) => {
    triggerHaptic('selection');
    setPending(uri);
  };

  const bgPrimary = theme.colors.background.primary;
  const bgElevated = theme.colors.background.elevated;
  const accent = theme.colors.accent.primary;
  const textPrimary = theme.colors.text.primary;
  const textTertiary = theme.colors.text.tertiary;
  const borderLight = theme.colors.border.light;

  return (
    <View style={[styles.root, { backgroundColor: bgPrimary }]}>
      <ChatPreviewBubbles
        height={PREVIEW_HEIGHT}
        fontSize={applied.fontSize}
        fontFamily={applied.fontFamily === 'mono' ? 'monospace' : applied.fontFamily === 'serif' ? 'serif' : undefined}
        bubbleRadius={applied.bubbleRadius}
        backgroundImage={pending}
        topPadding={insets.top + 60}
      />

      {/* ── Floating header pills ───────────────────────────────────── */}
      <View style={[styles.headerRow, { top: 28 }]} pointerEvents="box-none">
        <Pressable onPress={onCancel} hitSlop={10} style={glassActive ? [styles.headerPill, { overflow: 'visible' }] : styles.headerPill}>
          {glassActive ? (
            <NativeGlassView glassStyle="regular" isInteractive colorScheme="dark" style={[styles.headerPillInner, { borderRadius: 18 }]}>
              <Feather name="x" size={18} color="#FFFFFF" />
            </NativeGlassView>
          ) : (
            <BlurView intensity={80} tint="dark" style={styles.headerPillInner}>
              <Feather name="x" size={18} color="#FFFFFF" />
            </BlurView>
          )}
        </Pressable>
        <View style={styles.headerTitleAbs} pointerEvents="box-none">
          <ShrinkingModalTitle>
            <View style={styles.headerTitlePill}>
              {glassActive ? (
                <View style={[styles.headerTitleInner, { borderRadius: 18, overflow: 'hidden' }]}>
                  <GlassBg borderRadius={18} colorScheme="dark" />
                  <RNText style={styles.headerTitleText} allowFontScaling={false} numberOfLines={1} ellipsizeMode="tail">
                    {t('chat_settings.background')}
                  </RNText>
                </View>
              ) : (
                <BlurView intensity={80} tint="dark" style={styles.headerTitleInner}>
                  <RNText style={styles.headerTitleText} allowFontScaling={false} numberOfLines={1} ellipsizeMode="tail">
                    {t('chat_settings.background')}
                  </RNText>
                </BlurView>
              )}
            </View>
          </ShrinkingModalTitle>
        </View>
        <Pressable onPress={onApply} hitSlop={10} style={glassActive ? [styles.headerPill, { overflow: 'visible' }] : styles.headerPill}>
          {glassActive ? (
            <NativeGlassView glassStyle="regular" isInteractive colorScheme="dark" style={[styles.headerPillInner, { paddingHorizontal: 14, borderRadius: 18 }]}>
              <RNText style={styles.headerApplyText} allowFontScaling={false}>
                {t('common.apply')}
              </RNText>
            </NativeGlassView>
          ) : (
            <BlurView intensity={80} tint="dark" style={[styles.headerPillInner, { paddingHorizontal: 14 }]}>
              <RNText style={styles.headerApplyText} allowFontScaling={false}>
                {t('common.apply')}
              </RNText>
            </BlurView>
          )}
        </Pressable>
      </View>

      {/* ── Controls + footer ───────────────────────────────────────── */}
      <View style={[styles.controlsWrap, { paddingBottom: insets.bottom + 16 }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tilesRow}
        >
          {/* "No background" tile — explicitly clears the wallpaper */}
          <BgTile
            label={t('chat_settings.bg_none')}
            active={!pending}
            onPress={() => onPickPreset(undefined)}
            accent={accent}
            borderLight={borderLight}
            bgElevated={bgElevated}
            textPrimary={textPrimary}
          >
            <View style={[styles.tileFill, { backgroundColor: bgElevated, alignItems: 'center', justifyContent: 'center' }]}>
              <Feather name="slash" size={20} color={textTertiary} />
            </View>
          </BgTile>

          {/* Bundled gradient presets */}
          {PRESETS.map((p, i) => {
            const uri = buildPresetGradientUri(p.from, p.to);
            const active = pending === uri;
            return (
              <BgTile
                key={p.id}
                label={t('chat_settings.bg_preset', undefined, { n: String(i + 1) })}
                active={active}
                onPress={() => onPickPreset(uri)}
                accent={accent}
                borderLight={borderLight}
                bgElevated={bgElevated}
                textPrimary={textPrimary}
              >
                <LinearGradient
                  colors={[p.from, p.to]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.tileFill}
                />
              </BgTile>
            );
          })}

          {/* "From gallery" — relies on expo-image-picker which is already
              in the bundle (used elsewhere for posts / chat / banner). */}
          <BgTile
            label={t('chat_settings.bg_pick_gallery')}
            active={false}
            onPress={onPickGallery}
            accent={accent}
            borderLight={borderLight}
            bgElevated={bgElevated}
            textPrimary={textPrimary}
          >
            <View style={[styles.tileFill, { backgroundColor: accent + '15', alignItems: 'center', justifyContent: 'center' }]}>
              <Feather name="image" size={22} color={accent} />
            </View>
          </BgTile>
        </ScrollView>

        <View style={styles.footerRow}>
          <Pressable
            onPress={onCancel}
            style={[styles.footerBtn, { backgroundColor: bgElevated, borderColor: borderLight }]}
          >
            <RNText allowFontScaling={false} style={[styles.footerBtnText, { color: textPrimary }]}>
              {t('common.cancel')}
            </RNText>
          </Pressable>
          <Pressable
            onPress={onApply}
            style={[styles.footerBtn, { backgroundColor: accent, borderColor: accent }]}
          >
            <RNText allowFontScaling={false} style={[styles.footerBtnText, { color: '#FFFFFF' }]}>
              {t('common.apply')}
            </RNText>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// Single horizontal tile in the background picker. Wraps content in a
// rounded card with an accent ring when active — matches the row "active
// accent ring" pattern from the new card layout.
function BgTile({
  label,
  active,
  onPress,
  children,
  accent,
  borderLight,
  bgElevated,
  textPrimary,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  children: React.ReactNode;
  accent: string;
  borderLight: string;
  bgElevated: string;
  textPrimary: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.tile,
        {
          backgroundColor: bgElevated,
          borderColor: active ? accent : borderLight,
          borderWidth: active ? 2 : 0.5,
        },
      ]}
    >
      <View style={styles.tileInner}>{children}</View>
      <RNText
        allowFontScaling={false}
        style={[styles.tileLabel, { color: active ? accent : textPrimary }]}
        numberOfLines={1}
      >
        {label}
      </RNText>
    </Pressable>
  );
}

const TILE_WIDTH = 88;
const TILE_HEIGHT = 120;

const styles = StyleSheet.create({
  root: { flex: 1 },
  headerRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    zIndex: 100,
  },
  headerPill: { borderRadius: 18, overflow: 'hidden' },
  headerPillInner: {
    height: 36,
    minWidth: 36,
    paddingHorizontal: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  headerTitleAbs: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 60,
  },
  headerTitlePill: { borderRadius: 18, overflow: 'hidden', maxWidth: '100%' },
  headerTitleInner: {
    height: 36,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  headerApplyText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },

  controlsWrap: {
    flex: 1,
    paddingTop: 16,
    gap: 16,
    justifyContent: 'flex-start',
  },
  tilesRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 10,
    alignItems: 'center',
  },
  tile: {
    width: TILE_WIDTH,
    height: TILE_HEIGHT,
    borderRadius: 14,
    overflow: 'hidden',
    paddingBottom: 6,
    alignItems: 'center',
  },
  tileInner: {
    width: '100%',
    height: TILE_HEIGHT - 24,
    overflow: 'hidden',
  },
  tileFill: { width: '100%', height: '100%' },
  tileLabel: {
    fontSize: 11,
    paddingHorizontal: 6,
    paddingTop: 4,
    fontWeight: '500',
  },
  footerRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 'auto',
    paddingHorizontal: 16,
  },
  footerBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0.5,
  },
  footerBtnText: { fontSize: 15, fontWeight: '600' },
});
