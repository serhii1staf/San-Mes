/**
 * Mini-app preview backdrop picker — fullscreen modal for choosing the
 * WebP image rendered behind every `MiniAppPreviewCard`.
 *
 * Layout: single-column stack of FULL-WIDTH demo cards, each rendered at
 * the exact same dimensions as the real share-link preview (the user
 * explicitly asked for this — the previous 2-up grid felt cramped and
 * didn't represent how the card actually looks in chats / comments).
 *
 * Each row renders a near-pixel copy of `MiniAppPreviewCard`'s body
 * (emoji bubble + name + description + Open chip) using a static
 * "Demo" payload. Tapping a row selects that backdrop locally; the
 * choice commits to `useSettingsStore.miniAppPreviewBg` only when the
 * user taps Apply in the floating header.
 *
 * The geometry of the floating header (paddingTop: 28, gradient fade)
 * mirrors `app/settings/pixel-icons.tsx` per the existing convention.
 */

import React, { useState, useCallback, useMemo } from 'react';
import { View, Pressable, StyleSheet, ScrollView, Text as RNText, Platform } from 'react-native';
import { Image } from 'expo-image';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { ShrinkingModalTitle } from '../../src/components/ui';
import { triggerHaptic } from '../../src/utils/haptics';
import { useSettingsStore } from '../../src/store/settingsStore';
import { useT } from '../../src/i18n/store';
import {
  MINI_APP_PREVIEWS,
  getMiniAppPreviewSource,
} from '../../src/components/mini-app-previews/registry';

// Single demo payload — used for every row so contrast comparison is
// fair. Mirrors the typical real-world card a user would see.
const DEMO_EMOJI = '🌟';

export default function MiniAppPreviewScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();

  // Seed selection with whatever the user has saved so the picker
  // opens with their current choice highlighted.
  const initialSelectedId = useMemo<string | null>(
    () => useSettingsStore.getState().miniAppPreviewBg,
    [],
  );
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);

  const onPick = useCallback((id: string | null) => {
    triggerHaptic('light');
    setSelectedId(id);
  }, []);

  const onApply = useCallback(() => {
    triggerHaptic('light');
    useSettingsStore.getState().setMiniAppPreviewBg(selectedId);
    router.back();
  }, [selectedId]);

  // Build the full ordered list once: a "None" sentinel followed by
  // every bundled preview. ScrollView is fine — only ever 7 rows.
  const tiles = useMemo<({ kind: 'none' } | { kind: 'preview'; id: string })[]>(
    () => [
      { kind: 'none' },
      ...MINI_APP_PREVIEWS.map((p) => ({ kind: 'preview' as const, id: p.id })),
    ],
    [],
  );

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background.primary }]}>
      {/* Stack sits underneath the floating gradient header so cards
          fade in/out behind the chrome on scroll. */}
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 88,
          paddingBottom: insets.bottom + 24,
        }}
        showsVerticalScrollIndicator={false}
      >
        {tiles.map((tile) => {
          const isNone = tile.kind === 'none';
          const id = isNone ? null : tile.id;
          const isSelected = selectedId === id;
          const source = isNone ? null : getMiniAppPreviewSource(tile.id);
          return (
            <DemoRow
              key={isNone ? '__none__' : tile.id}
              source={source}
              isSelected={isSelected}
              isNone={isNone}
              onPress={() => onPick(id)}
              t={t}
              theme={theme}
            />
          );
        })}
      </ScrollView>

      {/* Floating gradient header — same geometry as pixel-icons:
          82-px shell with an inner row sitting at paddingTop: 28. */}
      <View style={[styles.headerWrapper, { height: 82 }]} pointerEvents="box-none">
        <LinearGradient
          colors={[
            theme.colors.background.primary,
            theme.colors.background.primary,
            theme.colors.background.primary + '00',
          ]}
          locations={[0, 0.6, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <View style={[styles.headerContent, { paddingTop: 28 }]} pointerEvents="auto">
          <View style={[styles.headerSide, { justifyContent: 'flex-start' }]}>
            <Pressable onPress={() => router.back()} hitSlop={12}>
              <Feather name="x" size={22} color={theme.colors.text.primary} />
            </Pressable>
          </View>
          <View style={styles.headerCenter}>
            <ShrinkingModalTitle>
              <Text variant="body" weight="bold">
                {t('mini_app_preview.title')}
              </Text>
            </ShrinkingModalTitle>
          </View>
          <View style={[styles.headerSide, { justifyContent: 'flex-end' }]}>
            <Pressable onPress={onApply} hitSlop={12}>
              <Text variant="body" weight="semibold" color={theme.colors.accent.primary}>
                {t('mini_app_preview.apply')}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

// One row in the picker — tappable, full-width, looks exactly like the
// real `MiniAppPreviewCard` rendered in a chat / comment / post.
function DemoRow({
  source,
  isSelected,
  isNone,
  onPress,
  t,
  theme,
}: {
  source: number | null;
  isSelected: boolean;
  isNone: boolean;
  onPress: () => void;
  t: (k: string) => string;
  theme: any;
}) {
  const onBackdrop = !!source;
  const accent = theme.colors.accent.primary;
  const bg = theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.025)';
  const titleColor = onBackdrop ? '#FFFFFF' : theme.colors.text.primary;
  const subColor = onBackdrop ? 'rgba(255,255,255,0.85)' : theme.colors.text.tertiary;
  const overlayColor = theme.isDark ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.55)';

  return (
    <Pressable onPress={onPress} style={styles.rowOuter}>
      {/* Outer wrapper hosts the selection ring without affecting the
          inner card's own border-radius / overflow clipping. */}
      <View
        style={[
          styles.cardWrap,
          {
            borderColor: isSelected ? accent : 'transparent',
          },
        ]}
      >
        <View
          style={[
            styles.card,
            {
              backgroundColor: bg,
              borderLeftWidth: onBackdrop || isNone ? 0 : 2,
              borderLeftColor: onBackdrop || isNone ? 'transparent' : accent,
            },
          ]}
        >
          {/* WebP backdrop + tint, identical to MiniAppPreviewCard. */}
          {source ? (
            <>
              <Image
                source={source}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                cachePolicy="memory-disk"
                transition={0}
                pointerEvents="none"
              />
              <View
                pointerEvents="none"
                style={[StyleSheet.absoluteFill, { backgroundColor: overlayColor }]}
              />
            </>
          ) : null}

          {/* Emoji bubble */}
          <View
            style={[
              styles.emojiBubble,
              {
                backgroundColor: onBackdrop
                  ? 'rgba(255,255,255,0.18)'
                  : theme.isDark
                  ? 'rgba(255,255,255,0.08)'
                  : 'rgba(0,0,0,0.04)',
              },
            ]}
            pointerEvents="none"
          >
            <RNText style={styles.emoji} allowFontScaling={false}>
              {isNone ? '✕' : DEMO_EMOJI}
            </RNText>
          </View>

          {/* Title + description */}
          <View style={{ flex: 1 }}>
            <Text variant="caption" weight="semibold" color={titleColor} numberOfLines={1} style={{ fontSize: 14 }}>
              {isNone ? t('mini_app_preview.none') : t('mini_app_preview.demo_name')}
            </Text>
            <Text variant="caption" color={subColor} numberOfLines={2} style={{ fontSize: 11, lineHeight: 15, marginTop: 2 }}>
              {t('mini_app_preview.demo_desc')}
            </Text>
          </View>

          {/* Open chip — Liquid-Glass on iOS when a backdrop is shown,
              flat tinted otherwise. Mirrors MiniAppPreviewCard exactly. */}
          <View style={styles.openWrap}>
            {onBackdrop && Platform.OS === 'ios' ? (
              <BlurView
                intensity={50}
                tint={theme.isDark ? 'dark' : 'light'}
                style={styles.openBlur}
              >
                <View
                  pointerEvents="none"
                  style={[
                    StyleSheet.absoluteFill,
                    {
                      borderRadius: 14,
                      borderWidth: StyleSheet.hairlineWidth,
                      borderColor: theme.isDark
                        ? 'rgba(255,255,255,0.18)'
                        : 'rgba(0,0,0,0.10)',
                    },
                  ]}
                />
                <Text variant="caption" weight="semibold" color="#FFFFFF" style={{ fontSize: 12 }}>
                  {t('mini_app.preview.open')}
                </Text>
              </BlurView>
            ) : (
              <View
                style={[
                  styles.openFlat,
                  {
                    backgroundColor: onBackdrop
                      ? 'rgba(255,255,255,0.22)'
                      : accent + '15',
                  },
                ]}
              >
                <Text
                  variant="caption"
                  weight="semibold"
                  color={onBackdrop ? '#FFFFFF' : accent}
                  style={{ fontSize: 12 }}
                >
                  {t('mini_app.preview.open')}
                </Text>
              </View>
            )}
          </View>

          {isSelected ? (
            <View
              pointerEvents="none"
              style={[styles.checkBadge, { backgroundColor: accent }]}
            >
              <Feather name="check" size={12} color="#FFFFFF" />
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  headerWrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    minHeight: 44,
  },
  headerSide: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerCenter: {
    flexShrink: 1,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowOuter: { marginBottom: 10 },
  // 2-px ring around the card when selected, transparent otherwise.
  // Padding inside reserves space so the ring doesn't push the card.
  cardWrap: {
    borderRadius: 18,
    borderWidth: 2,
    padding: 0,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 16,
    overflow: 'hidden',
  },
  emojiBubble: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: { fontSize: 26 },
  openWrap: { borderRadius: 14, overflow: 'hidden' },
  openBlur: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  openFlat: {
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  checkBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
