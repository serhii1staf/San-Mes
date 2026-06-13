/**
 * Pixel icons browser — fullscreen modal for previewing the bundled set
 * of 70 AI-generated pixel-art characters across 7 themed packs.
 *
 * Two modes:
 *
 * 1. Preview-only (no `?purpose=…` query param). Tapping an icon just
 *    surfaces its title in the bottom bar — for browsing the catalogue.
 *
 * 2. Picker (`?purpose=home-header | post-emoji | chat-reply`). The
 *    header swaps the icon-count chip for an Apply button, and the
 *    grid grows a leading "None / Clear" tile so the user can remove
 *    a previously-chosen icon. Apply writes to the right store and
 *    pops the screen.
 *
 * The screen owns nothing else — every consumer (home header, post
 * emoji pattern, chat reply) reads the persisted id from its own
 * store and renders via `PixelIcon` / `PixelIconPattern`.
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
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { triggerHaptic } from '../../src/utils/haptics';
import {
  PIXEL_ICONS,
  PIXEL_PACKS,
  type PixelIcon,
} from '../../src/components/pixel-icons/registry';
import { useSettingsStore } from '../../src/store/settingsStore';
import { useProfileAppearanceStore } from '../../src/store/profileAppearanceStore';
import { useChatSettingsStore } from '../../src/store/chatSettingsStore';
import { pixelToken, parseDecoration } from '../../src/components/pixel-icons/decoration';
import { useT } from '../../src/i18n/store';

const NUM_COLUMNS = 4;

// Discriminator on the `?purpose=` query param. Anything else (or
// missing) means preview-only — the screen behaves like the original
// catalogue browser.
type Purpose = 'home-header' | 'post-emoji' | 'chat-reply' | null;

function parsePurpose(raw: string | string[] | undefined): Purpose {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === 'home-header' || v === 'post-emoji' || v === 'chat-reply') return v;
  return null;
}

// Flat-list row types — interleaving section headers and rows of N icons
// gives us trivial virtualization without paying SectionList's overhead.
type GridRow =
  | { kind: 'header'; packId: string; label: string }
  | { kind: 'icons'; items: (PixelIcon | { __none: true })[] };

function buildGridRows(showNoneTile: boolean): GridRow[] {
  const rows: GridRow[] = [];
  const orderedPacks = [...PIXEL_PACKS].sort((a, b) => a.order - b.order);

  // First pack — prepend the "None / Clear" sentinel so the user can
  // remove a previously-chosen icon without scrolling. Only injected
  // when the screen is in picker mode.
  let firstPack = true;

  for (const pack of orderedPacks) {
    const items = PIXEL_ICONS.filter((ic) => ic.pack === pack.id);
    if (items.length === 0) continue;
    rows.push({ kind: 'header', packId: pack.id, label: pack.label });

    // Compose the row source — in picker mode, the very first row of
    // the very first pack starts with the None tile, then the regular
    // icons. Subsequent rows / packs are unaffected.
    const sourceItems: (PixelIcon | { __none: true })[] =
      firstPack && showNoneTile ? [{ __none: true }, ...items] : [...items];
    firstPack = false;

    for (let i = 0; i < sourceItems.length; i += NUM_COLUMNS) {
      rows.push({ kind: 'icons', items: sourceItems.slice(i, i + NUM_COLUMNS) });
    }
  }
  return rows;
}

export default function PixelIconsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();

  // The query string drives the entire mode of this screen — preview
  // vs picker, plus the chatId binding for the chat-reply purpose.
  const params = useLocalSearchParams<{ purpose?: string; chatId?: string }>();
  const purpose = parsePurpose(params.purpose);
  const chatIdParam = Array.isArray(params.chatId) ? params.chatId[0] : params.chatId;
  const isPicker = purpose !== null;

  // Seed the selection with whatever the user already has saved for
  // this purpose, so the picker opens highlighting their current
  // choice (and the None tile when nothing is set).
  const initialSelectedId = useMemo<string | null>(() => {
    if (!isPicker) return null;
    if (purpose === 'home-header') {
      return useSettingsStore.getState().homeHeaderIcon;
    }
    if (purpose === 'post-emoji') {
      const decoded = parseDecoration(useProfileAppearanceStore.getState().postEmoji);
      return decoded.kind === 'pixel' ? decoded.id : null;
    }
    if (purpose === 'chat-reply' && chatIdParam) {
      const settings = useChatSettingsStore.getState().getSettings(chatIdParam);
      return settings.replyPixelIcon ?? null;
    }
    return null;
  }, [isPicker, purpose, chatIdParam]);

  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);

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

  const rows = useMemo(() => buildGridRows(isPicker), [isPicker]);

  const onPickIcon = useCallback((id: string | null) => {
    triggerHaptic('light');
    setSelectedId(id);
  }, []);

  const onApply = useCallback(() => {
    triggerHaptic('light');
    if (purpose === 'home-header') {
      // Selected id may be `null` (user picked the None tile) — both
      // branches are valid writes for the home-header surface.
      useSettingsStore.getState().setHomeHeaderIcon(selectedId);
    } else if (purpose === 'post-emoji') {
      // The store schema is a single string; encode the new selection
      // with the explicit prefix convention. Empty string = off.
      const next = selectedId ? pixelToken(selectedId) : '';
      useProfileAppearanceStore.getState().setPostEmoji(next);
    } else if (purpose === 'chat-reply' && chatIdParam) {
      // Per-chat field on the chatSettings store. `undefined` clears it
      // so subsequent reads fall through to the global / default merge.
      useChatSettingsStore.getState().updateSettings(chatIdParam, {
        replyPixelIcon: selectedId ?? undefined,
      });
    }
    router.back();
  }, [purpose, chatIdParam, selectedId]);

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
      const padded: ((PixelIcon | { __none: true }) | null)[] = [...item.items];
      while (padded.length < NUM_COLUMNS) padded.push(null);
      return (
        <View style={styles.iconRow}>
          {padded.map((cell, i) => {
            if (!cell) {
              return <View key={`empty-${i}`} style={styles.cell} pointerEvents="none" />;
            }
            // None / Clear tile — only present in picker mode. Selected
            // when `selectedId` is null so the user can clearly see
            // they're about to remove the icon.
            if ('__none' in cell) {
              const isSelected = selectedId === null;
              return (
                <Pressable
                  key="__none__"
                  onPress={() => onPickIcon(null)}
                  style={[
                    styles.cell,
                    {
                      borderWidth: 1.5,
                      borderColor: isSelected
                        ? theme.colors.accent.primary
                        : theme.colors.border.light,
                      backgroundColor: isSelected
                        ? theme.colors.accent.primary + '14'
                        : 'transparent',
                    },
                  ]}
                >
                  <Feather
                    name="slash"
                    size={26}
                    color={isSelected ? theme.colors.accent.primary : theme.colors.text.tertiary}
                  />
                </Pressable>
              );
            }
            const ic = cell;
            return (
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
            );
          })}
        </View>
      );
    },
    [
      onPickIcon,
      selectedId,
      theme.colors.accent.primary,
      theme.colors.border.light,
      theme.colors.text.tertiary,
    ],
  );

  const keyExtractor = useCallback((item: GridRow, idx: number) => {
    if (item.kind === 'header') return `h:${item.packId}`;
    const first = item.items[0];
    const firstKey = first ? ('__none' in first ? '__none' : first.id) : '';
    return `r:${idx}:${firstKey}`;
  }, []);

  const selectedIcon = selectedId ? PIXEL_ICONS.find((ic) => ic.id === selectedId) : null;

  return (
    <View
      style={[styles.root, { backgroundColor: theme.colors.background.primary }]}
    >
      {/* Grid is the BASE layer — it fills the screen including under the
          gradient fade header, so content visibly slides up under the
          translucent shell when scrolled. */}
      {gridReady ? (
        <FlatList
          data={rows}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={{
            paddingHorizontal: 14,
            // First row sits below the gradient header (82 px tall fixed).
            paddingTop: 78,
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
        <View style={[styles.loaderWrap, { paddingTop: 78 }]}>
          <ActivityIndicator size="small" color={theme.colors.text.tertiary} />
        </View>
      )}

      {/* Floating gradient header. Padding settled at 28 px after a long
          oscillation cycle (14 too low, 6 too high, 22 still slightly
          high). 28 sits clearly below the modal drag-handle without
          diving toward the middle of the sheet. */}
      <View
        style={[
          styles.headerWrapper,
          { height: 82 },
        ]}
        pointerEvents="box-none"
      >
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
        <View
          style={[
            styles.headerContent,
            { paddingTop: 28 },
          ]}
          pointerEvents="auto"
        >
          {/* Three-region row — left action / centred title / right action.
              Each side region is `flex: 1` so the title sits dead-centre
              regardless of label width, AND the right action stays pinned
              to the trailing edge (Apply was drifting toward the centre
              before because the right region had no `alignItems: 'flex-end'`). */}
          <View style={[styles.headerSideContainer, { justifyContent: 'flex-start' }]}>
            <Pressable onPress={() => router.back()} hitSlop={12}>
              <Feather name="x" size={22} color={theme.colors.text.primary} />
            </Pressable>
          </View>
          <View style={styles.headerCenter}>
            <Text variant="body" weight="bold">{t('pixel_icons.title', 'Pixel icons')}</Text>
          </View>
          <View style={[styles.headerSideContainer, { justifyContent: 'flex-end' }]}>
            {isPicker ? (
              <Pressable onPress={onApply} hitSlop={12}>
                <Text variant="body" weight="semibold" color={theme.colors.accent.primary}>
                  {t('common.apply')}
                </Text>
              </Pressable>
            ) : (
              <Text variant="caption" color={theme.colors.text.tertiary}>
                {PIXEL_ICONS.length}
              </Text>
            )}
          </View>
        </View>
      </View>

      {/* Selected-icon footer. Renders just the human-readable title of
          whichever icon the user tapped last — the registry id used to
          live here too but it was only useful for debugging. */}
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
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  // Floating gradient header sits absolutely on top of the grid so content
  // visibly scrolls under it (Telegram-style fade). Z-index keeps it above
  // the FlatList, while the gradient itself blends to transparent at the
  // bottom edge so there's no hard cut where chrome ends and content
  // starts.
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
  // Legacy `header` style kept for backwards-compatibility callers.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    minHeight: 44,
  },
  headerSide: {
    // Equal-width tap targets on each side so the absolute-centered title
    // never visually drifts based on the action label's length.
    minWidth: 60,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerSideLeft: { justifyContent: 'flex-start' },
  headerSideRight: { justifyContent: 'flex-end' },
  // New simpler centering: equal flex regions left/right + centered text.
  headerSideContainer: {
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
  headerTitleWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 14,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'flex-start',
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
