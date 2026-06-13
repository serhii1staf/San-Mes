/**
 * Pixel icons browser — fullscreen modal for previewing the bundled set
 * of 70 AI-generated pixel-art characters across 7 themed packs.
 *
 * For now this is a preview-only screen: tap any icon and the bottom bar
 * surfaces its title. There's no persistence yet — once we wire pixel
 * icons into a concrete surface (post emoji decoration, chat avatar,
 * etc.) we'll add the apply path. The screen is intentionally lightweight
 * so the user can flip through the catalogue and tell me which packs are
 * worth keeping before we scale up the asset pipeline.
 *
 * Performance considerations:
 * - The grid is a single FlatList with `numColumns={4}` over a flat list
 *   that interleaves SECTION rows with icon rows, so virtualization is
 *   straightforward and we never fork into nested SectionList overhead.
 * - Each icon is a `require()`'d local PNG (256x256 max, ~80–110 KB),
 *   pre-bundled at build time — no remote fetch, no decode-from-bytes
 *   cost on first show. Metro tree-shakes anything we never `require()`.
 * - The grid is gated past `runAfterInteractions` so the modal slide-in
 *   animation completes at 60 fps before 70 native Image views start
 *   mounting. Previously this was the dominant source of long tasks on
 *   any screen with a lot of icons (see `settings/appearance.tsx`).
 * - All visible state is local; the screen subscribes to nothing.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Pressable,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  InteractionManager,
} from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { triggerHaptic } from '../../src/utils/haptics';
import {
  PIXEL_ICONS,
  PIXEL_PACKS,
  type PixelIcon,
} from '../../src/components/pixel-icons/registry';

const NUM_COLUMNS = 4;

// Flat-list row types — interleaving section headers and rows of N icons
// gives us trivial virtualization without paying SectionList's overhead.
type GridRow =
  | { kind: 'header'; packId: string; label: string }
  | { kind: 'icons'; items: PixelIcon[] };

function buildGridRows(): GridRow[] {
  const rows: GridRow[] = [];
  const orderedPacks = [...PIXEL_PACKS].sort((a, b) => a.order - b.order);
  for (const pack of orderedPacks) {
    const items = PIXEL_ICONS.filter((ic) => ic.pack === pack.id);
    if (items.length === 0) continue;
    rows.push({ kind: 'header', packId: pack.id, label: pack.label });
    // Chunk into rows of NUM_COLUMNS so each row renders the same number
    // of cells regardless of pack size — keeps layout predictable in the
    // FlatList and simplifies the renderItem branch.
    for (let i = 0; i < items.length; i += NUM_COLUMNS) {
      rows.push({ kind: 'icons', items: items.slice(i, i + NUM_COLUMNS) });
    }
  }
  return rows;
}

export default function PixelIconsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Defer the grid mount past the modal's slide-in transition. 70 native
  // Image views landing on the same RAF as the slide animation drops the
  // open-screen framerate below 60 on weak devices. Showing a spinner
  // while the transition completes is invisible to the user (the modal
  // is still visually empty during the slide anyway).
  const [gridReady, setGridReady] = useState(false);
  useEffect(() => {
    const handle = InteractionManager.runAfterInteractions(() => setGridReady(true));
    return () => handle.cancel();
  }, []);

  const rows = useMemo(buildGridRows, []);

  const onPickIcon = useCallback((id: string) => {
    triggerHaptic('light');
    setSelectedId(id);
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: GridRow }) => {
      if (item.kind === 'header') {
        return (
          <View style={styles.sectionHeader}>
            <Text variant="caption" weight="bold" color={theme.colors.text.tertiary} style={styles.sectionLabel}>
              {item.label.toUpperCase()}
            </Text>
          </View>
        );
      }
      // Pad the row to NUM_COLUMNS so the icons in a partial last row
      // align to the left rather than spreading edge-to-edge.
      const padded = [...item.items];
      while (padded.length < NUM_COLUMNS) padded.push(null as any);
      return (
        <View style={styles.iconRow}>
          {padded.map((ic, i) =>
            ic ? (
              <Pressable
                key={ic.id}
                onPress={() => onPickIcon(ic.id)}
                style={[
                  styles.cell,
                  // Selected = soft accent halo. Otherwise transparent — the
                  // icons themselves carry their own silhouette so a filled
                  // tile would only mute them.
                  selectedId === ic.id && {
                    backgroundColor: theme.colors.accent.primary + '14',
                    borderColor: theme.colors.accent.primary,
                    borderWidth: 1.5,
                  },
                ]}
              >
                <Image
                  source={ic.source}
                  style={styles.iconImage}
                  contentFit="contain"
                  cachePolicy="memory-disk"
                  transition={0}
                />
              </Pressable>
            ) : (
              <View key={`empty-${i}`} style={styles.cell} pointerEvents="none" />
            ),
          )}
        </View>
      );
    },
    [onPickIcon, selectedId, theme.colors.accent.primary, theme.colors.background.elevated, theme.colors.border.light, theme.colors.text.tertiary],
  );

  const keyExtractor = useCallback((item: GridRow, idx: number) => {
    if (item.kind === 'header') return `h:${item.packId}`;
    return `r:${idx}:${item.items[0]?.id ?? ''}`;
  }, []);

  const selectedIcon = selectedId ? PIXEL_ICONS.find((ic) => ic.id === selectedId) : null;

  return (
    <View
      style={[styles.root, { backgroundColor: theme.colors.background.primary, paddingTop: insets.top }]}
    >
      {/* Header row — close button + title. Stays static during scroll. */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="x" size={22} color={theme.colors.text.primary} />
        </Pressable>
        <Text variant="body" weight="bold">Pixel icons</Text>
        <Text variant="caption" color={theme.colors.text.tertiary}>
          {PIXEL_ICONS.length}
        </Text>
      </View>

      {gridReady ? (
        <FlatList
          data={rows}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={{
            paddingHorizontal: 14,
            paddingTop: 8,
            paddingBottom: insets.bottom + 90,
          }}
          showsVerticalScrollIndicator={false}
          // Tight virtualization — 4 rows of 4 icons fit on a typical screen,
          // initial 5 rows covers the visible area + a buffer without paying
          // for everything at once. Subsequent batches stream in cheaply.
          initialNumToRender={5}
          maxToRenderPerBatch={4}
          windowSize={6}
          removeClippedSubviews={true}
        />
      ) : (
        <View style={styles.loaderWrap}>
          <ActivityIndicator size="small" color={theme.colors.text.tertiary} />
        </View>
      )}

      {/* Selected-icon footer. Renders the title of whatever icon the user
          tapped last. Empty by default so the modal opens looking calm. */}
      {selectedIcon ? (
        <View
          style={[
            styles.footer,
            {
              paddingBottom: insets.bottom + 12,
              backgroundColor: theme.colors.background.elevated,
              borderTopColor: theme.colors.border.light,
            },
          ]}
        >
          <Image
            source={selectedIcon.source}
            style={styles.footerThumb}
            contentFit="contain"
            cachePolicy="memory-disk"
            transition={0}
          />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text variant="body" weight="semibold" numberOfLines={1}>
              {selectedIcon.title}
            </Text>
            <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1}>
              {selectedIcon.id}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  loaderWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  sectionHeader: { paddingTop: 14, paddingBottom: 6, paddingHorizontal: 4 },
  sectionLabel: { fontSize: 11, letterSpacing: 0.6 },
  iconRow: { flexDirection: 'row', marginBottom: 8 },
  cell: {
    flex: 1,
    aspectRatio: 1,
    marginHorizontal: 4,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  iconImage: { width: '85%', height: '85%' },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerThumb: { width: 56, height: 56 },
});
