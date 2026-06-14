/**
 * Mini-app preview backdrop picker — fullscreen modal for choosing the
 * WebP image rendered behind every `MiniAppPreviewCard`.
 *
 * Layout mirrors `app/settings/pixel-icons.tsx` exactly (the geometry
 * the user explicitly asked us to copy):
 *
 * - Floating gradient header with a 28-px top inset, X / title /
 *   Apply on a three-region row.
 * - Below it, a 2-column grid of demo cards. Each demo is a small
 *   16:9-ish tile that previews what the chosen WebP looks like
 *   behind the standard preview-card content (emoji + name + button).
 * - First tile is "No background" — selected when the persisted id
 *   is `null` so users can clear a prior choice without scrolling.
 * - Selection is local until the user taps Apply; X cancels.
 */

import React, { useState, useCallback, useMemo } from 'react';
import { View, Pressable, StyleSheet, ScrollView, Text as RNText } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { triggerHaptic } from '../../src/utils/haptics';
import { useSettingsStore } from '../../src/store/settingsStore';
import { useT } from '../../src/i18n/store';
import {
  MINI_APP_PREVIEWS,
  getMiniAppPreviewSource,
} from '../../src/components/mini-app-previews/registry';

const NUM_COLUMNS = 2;
// Gap is consumed via marginHorizontal on each tile (see styles.tile),
// so the grid stays a flat row without gap-prop polyfills.
const TILE_HORIZONTAL_GAP = 8;
const GRID_PADDING = 14;

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
  // every bundled preview. Rendering as a plain ScrollView is fine —
  // we only ever have 7 tiles total.
  const tiles = useMemo<({ kind: 'none' } | { kind: 'preview'; id: string })[]>(
    () => [
      { kind: 'none' },
      ...MINI_APP_PREVIEWS.map((p) => ({ kind: 'preview' as const, id: p.id })),
    ],
    [],
  );

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background.primary }]}>
      {/* Grid sits underneath the floating gradient header so the cards
          fade in/out behind the chrome on scroll, matching pixel-icons. */}
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: GRID_PADDING,
          paddingTop: 78,
          paddingBottom: insets.bottom + 24,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.grid}>
          {tiles.map((tile) => {
            const isNone = tile.kind === 'none';
            const id = isNone ? null : tile.id;
            const isSelected = selectedId === id;
            const source = isNone ? null : getMiniAppPreviewSource(tile.id);
            return (
              <Pressable
                key={isNone ? '__none__' : tile.id}
                onPress={() => onPick(id)}
                style={[
                  styles.tile,
                  {
                    backgroundColor: theme.colors.background.elevated,
                    borderColor: isSelected
                      ? theme.colors.accent.primary
                      : theme.colors.border.light,
                    borderWidth: isSelected ? 2 : StyleSheet.hairlineWidth,
                  },
                ]}
              >
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
                      style={[
                        StyleSheet.absoluteFill,
                        {
                          backgroundColor: theme.isDark
                            ? 'rgba(0,0,0,0.35)'
                            : 'rgba(255,255,255,0.55)',
                        },
                      ]}
                    />
                  </>
                ) : null}

                {/* Demo content — same shape as MiniAppPreviewCard so the
                    user can read the contrast at a glance. Kept compact
                    for the 2-up grid. */}
                <View style={styles.demoRow} pointerEvents="none">
                  <View
                    style={[
                      styles.demoEmojiBubble,
                      {
                        backgroundColor: theme.isDark
                          ? 'rgba(255,255,255,0.18)'
                          : 'rgba(0,0,0,0.08)',
                      },
                    ]}
                  >
                    <RNText style={styles.demoEmoji} allowFontScaling={false}>
                      🌟
                    </RNText>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      variant="caption"
                      weight="semibold"
                      numberOfLines={1}
                      style={{ fontSize: 13 }}
                    >
                      {t('mini_app_preview.demo_name')}
                    </Text>
                    <Text
                      variant="caption"
                      color={theme.colors.text.tertiary}
                      numberOfLines={1}
                      style={{ fontSize: 11, marginTop: 1 }}
                    >
                      {t('mini_app_preview.demo_desc')}
                    </Text>
                  </View>
                </View>

                <View
                  style={[
                    styles.demoButton,
                    {
                      backgroundColor: theme.colors.accent.primary + '20',
                    },
                  ]}
                  pointerEvents="none"
                >
                  <Text
                    variant="caption"
                    weight="semibold"
                    color={theme.colors.accent.primary}
                    style={{ fontSize: 11 }}
                  >
                    {t('mini_app.preview.open')}
                  </Text>
                </View>

                {/* "No background" label sits in the empty state's
                    bottom strip so the tile is obviously a real choice
                    rather than an accidental empty card. */}
                {isNone ? (
                  <View
                    pointerEvents="none"
                    style={[
                      styles.noneBadge,
                      { borderColor: theme.colors.border.light },
                    ]}
                  >
                    <Feather name="slash" size={11} color={theme.colors.text.tertiary} />
                    <Text
                      variant="caption"
                      color={theme.colors.text.tertiary}
                      style={{ fontSize: 10, marginLeft: 4 }}
                    >
                      {t('mini_app_preview.none')}
                    </Text>
                  </View>
                ) : null}

                {isSelected ? (
                  <View
                    pointerEvents="none"
                    style={[
                      styles.checkBadge,
                      { backgroundColor: theme.colors.accent.primary },
                    ]}
                  >
                    <Feather name="check" size={12} color="#FFFFFF" />
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
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
            <Text variant="body" weight="bold">
              {t('mini_app_preview.title')}
            </Text>
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
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    // Negative horizontal margin cancels the per-tile margin so the
    // outer ScrollView padding stays visually correct.
    marginHorizontal: -TILE_HORIZONTAL_GAP / 2,
  },
  tile: {
    // Two columns with horizontal gaps that compose to TILE_HORIZONTAL_GAP
    // total spacing per row. Fixed aspect ratio gives every backdrop the
    // same generous canvas without runtime measurement.
    width: `${100 / NUM_COLUMNS}%`,
    aspectRatio: 16 / 11,
    marginBottom: TILE_HORIZONTAL_GAP,
    borderRadius: 16,
    overflow: 'hidden',
    padding: 12,
    justifyContent: 'space-between',
  },
  demoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  demoEmojiBubble: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  demoEmoji: { fontSize: 18 },
  demoButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  noneBadge: {
    position: 'absolute',
    left: 10,
    bottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
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
