/**
 * Imported stickers and GIFs — a real screen, not a sheet.
 *
 * ── WHY THIS IS A SCREEN ────────────────────────────────────────────────────
 *
 * Asked for directly: "make a proper, decent window — not a modal window but a full window, where the
 * date and which GIFs I imported are shown, with a header, a back button, dimming top and bottom".
 *
 * The add-a-GIF sheet is the right shape for its job (one field, two buttons, paste and go) and the
 * wrong shape for this one. A library is browsed, scrolled and pruned over minutes; it needs the whole
 * display, a scroll container that owns the screen, and a back affordance rather than a dismiss. Those
 * are the properties of a route, so this is a route.
 *
 * ── WHAT IT SHOWS THAT THE PICKER CANNOT ───────────────────────────────────
 *
 * The GIF picker is a flat grid ordered newest-first with no structure, so a pack of forty stickers and
 * a single pasted GIF look identical and there is no way to tell which import something came from. Here
 * the same items are grouped by the DAY they were imported and labelled with the pack they came from, so
 * a pack can be recognised and removed as the unit it was added as.
 *
 * Legacy entries have no `addedAt` (the field is new) and are collected under an "unknown date" group
 * rather than being sorted into 1970.
 */

import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { View, Pressable, StyleSheet, FlatList, Alert, Dimensions, InteractionManager } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SCRIM_LOCATIONS, surfaceScrimHeight, topSurfaceScrimColors, bottomSurfaceScrimColors } from '../../src/theme/scrim';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { CachedImage } from '../../src/components/ui/CachedImage';
import { triggerHaptic } from '../../src/utils/haptics';
import { showToast } from '../../src/store/toastStore';
import { useCustomGifs, type CustomGif } from '../../src/store/customGifsStore';
import { removeRecentGif } from '../../src/services/recentGif';
import { useT } from '../../src/i18n/store';
import { openUrl } from '../../src/utils/openUrl';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const NUM_COLUMNS = 4;
const H_PAD = 16;
const CELL_GAP = 8;
const CELL = Math.floor((SCREEN_WIDTH - H_PAD * 2 - CELL_GAP * (NUM_COLUMNS - 1)) / NUM_COLUMNS);

// Header band height. Named because BOTH the chrome and the list's top padding derive from it -
// they were two independent literals, so lowering the title used to leave the list scrolling under
// the wrong offset.
const HEADER_H = 64;

/** Stable empty array so the pre-ready render cannot hand FlatList a fresh identity each pass. */
const EMPTY_ROWS: Row[] = [];

/**
 * One flattened list row. Interleaving group headers with rows of cells keeps this a single FlatList —
 * a SectionList with `numColumns` cannot lay out a grid inside a section without nesting, and nesting a
 * grid per section is what makes long sticker libraries stutter.
 */
type Row =
  | { kind: 'header'; key: string; label: string; packs: string; ids: string[]; count: number }
  | { kind: 'cells'; key: string; items: CustomGif[] };

/** Midnight of the day a timestamp falls on, so items import-adjacent in time group together. */
function dayKey(ts?: number): string {
  if (!ts) return 'unknown';
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function buildRows(items: CustomGif[], unknownLabel: string, locale: string): Row[] {
  // Preserve the store's newest-first order within each group; only the GROUPS need sorting.
  const groups = new Map<string, CustomGif[]>();
  for (const it of items) {
    const k = dayKey(it.addedAt);
    const bucket = groups.get(k);
    if (bucket) bucket.push(it);
    else groups.set(k, [it]);
  }
  // Newest day first; the undated group last, since it is the oldest by definition (the field did not
  // exist when those were written).
  const keys = Array.from(groups.keys()).sort((a, b) => {
    if (a === 'unknown') return 1;
    if (b === 'unknown') return -1;
    const ta = groups.get(a)![0].addedAt || 0;
    const tb = groups.get(b)![0].addedAt || 0;
    return tb - ta;
  });

  const rows: Row[] = [];
  for (const k of keys) {
    const bucket = groups.get(k)!;
    const ts = bucket[0].addedAt;
    let label = unknownLabel;
    if (ts) {
      try {
        label = new Date(ts).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
      } catch {
        label = new Date(ts).toDateString();
      }
    }
    // Which packs this day's import came from. A pasted one-off has no pack name and contributes
    // nothing, so a day of only pasted GIFs shows just its date.
    const packs = Array.from(new Set(bucket.map((b) => b.packName).filter(Boolean))) as string[];
    rows.push({
      kind: 'header',
      key: 'h:' + k,
      label,
      packs: packs.join(', '),
      ids: bucket.map((b) => b.id),
      count: bucket.length,
    });
    for (let i = 0; i < bucket.length; i += NUM_COLUMNS) {
      rows.push({ kind: 'cells', key: 'c:' + k + ':' + i, items: bucket.slice(i, i + NUM_COLUMNS) });
    }
  }
  return rows;
}

export default function ImportedStickersScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const items = useCustomGifs((s) => s.items);
  const remove = useCustomGifs((s) => s.remove);
  const removeMany = useCustomGifs((s) => s.removeMany);
  const [selected, setSelected] = useState<string | null>(null);

  // ── THE FIRST PAINT CARRIES THE CHROME, NOT THE LIBRARY ───────────────────
  //
  // The other half of the reported freeze. `buildRows` groups every stored sticker and formats one date
  // per group through `toLocaleDateString` — and the FIRST `Intl` call on Hermes pays ICU
  // initialisation, which is far more expensive than any of the grouping. All of that ran during the
  // screen's first render, i.e. on the frame the navigator was trying to animate.
  //
  // `InteractionManager` is the pattern this codebase already uses for exactly this on the messages tab
  // and the chat screen: the transition runs first, the list arrives a frame later. The header, the
  // scrims and the intro text are all available immediately, so the screen is never blank — it simply
  // fills in. `ready` also gives the empty state something honest to wait on, so an empty library does
  // not flash "nothing imported" before the real rows appear.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const handle = InteractionManager.runAfterInteractions(() => setReady(true));
    return () => handle.cancel();
  }, []);

  const rows = useMemo(
    () => (ready ? buildRows(items, t('stickers.date_unknown'), t('locale.tag')) : EMPTY_ROWS),
    [ready, items, t],
  );

  // Deleting has to clear BOTH lists. `recent_gif` keeps a full copy of anything that has been sent, and
  // cleaning only the store is what made a delete look like the sticker had moved to another slot. This
  // screen is not a chat, so there is no recents React state to update here — the MMKV purge is enough,
  // and the picker re-derives membership from the store on every render anyway.
  const forget = useCallback((id: string) => {
    remove(id);
    try { removeRecentGif(id); } catch {}
  }, [remove]);

  const confirmOne = useCallback((item: CustomGif) => {
    triggerHaptic('medium');
    Alert.alert(
      t('stickers.delete_one_title'),
      t('stickers.delete_one_msg'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => {
            forget(item.id);
            setSelected(null);
            showToast(t('stickers.deleted'), 'trash-2');
          },
        },
      ],
    );
  }, [forget, t]);

  const confirmGroup = useCallback((ids: string[], label: string) => {
    triggerHaptic('medium');
    Alert.alert(
      t('stickers.delete_group_title'),
      t('stickers.delete_group_msg', undefined, { count: String(ids.length), date: label }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => {
            // One store write and one disk write for the whole group. Calling `remove` in a loop would
            // be N state updates and N MMKV serializations of a shrinking array, in one tick, for
            // something the user experiences as a single action.
            removeMany(ids);
            for (const id of ids) { try { removeRecentGif(id); } catch {} }
            setSelected(null);
            showToast(t('stickers.deleted'), 'trash-2');
          },
        },
      ],
    );
  }, [removeMany, t]);

  const renderRow = useCallback(({ item: row }: { item: Row }) => {
    if (row.kind === 'header') {
      return (
        <View style={styles.groupHeader}>
          <View style={styles.groupHeaderText}>
            <Text variant="body" weight="semibold" numberOfLines={1}>{row.label}</Text>
            <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1}>
              {row.packs
                ? t('stickers.group_meta_pack', undefined, { count: String(row.count), packs: row.packs })
                : t('stickers.group_meta', undefined, { count: String(row.count) })}
            </Text>
          </View>
          <Pressable
            onPress={() => confirmGroup(row.ids, row.label)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('stickers.delete_group_title')}
            style={styles.groupDelete}
          >
            <Feather name="trash-2" size={16} color="#FF3B30" />
          </Pressable>
        </View>
      );
    }
    return (
      <View style={styles.cellRow}>
        {row.items.map((it) => {
          const isSel = selected === it.id;
          return (
            <Pressable
              key={it.id}
              onPress={() => { triggerHaptic('light'); setSelected(isSel ? null : it.id); }}
              style={[
                styles.cell,
                { backgroundColor: theme.colors.background.secondary },
                isSel && { borderWidth: 2, borderColor: theme.colors.accent.primary },
              ]}
            >
              {/* `noProxy` and `stillUrl`, matching the picker grid exactly. Two reasons, and the second
                  is the one that bites: a different URL is a different expo-image cache key, so asking
                  for a proxied variant here would re-download every sticker the picker had already
                  decoded. A still frame also means one decode per cell instead of an animating grid. */}
              {/* `paced` is not optional here, it is the whole reason this grid does not stall.
   
                  A snapshot of this screen measured `pendingDecodes` at 36 with load durations climbing
                  290 → 331 → 442 → 448 → 533 → 542 → 599 ms. A monotonic climb across concurrent
                  requests is a QUEUE: every cell started its decode the moment it mounted, so the last
                  one waited for all the others, and two long tasks of 291 ms and 121 ms landed on the
                  frames the navigator was animating.
   
                  The GIF panel had already been fixed for exactly this. This screen was written after it
                  and still stormed, because pacing used to require extracting the cell into a component
                  to hold a hook. It is a prop on the image now precisely so that cannot happen again —
                  see the note on `paced`. */}
              <CachedImage
                uri={it.stillUrl || it.previewUrl}
                style={styles.cellImg}
                resizeMode="contain"
                priority="low"
                autoplay={false}
                noProxy
                paced
              />
              {isSel ? (
                <View style={styles.cellActions}>
                  <Pressable onPress={() => confirmOne(it)} hitSlop={6} style={styles.cellAction}>
                    <Feather name="trash-2" size={14} color="#FFFFFF" />
                  </Pressable>
                </View>
              ) : null}
            </Pressable>
          );
        })}
        {/* Keep the last row left-aligned instead of stretching its cells. */}
        {row.items.length < NUM_COLUMNS
          ? Array.from({ length: NUM_COLUMNS - row.items.length }).map((_, i) => (
              <View key={'pad' + i} style={styles.cellPad} />
            ))
          : null}
      </View>
    );
  }, [selected, theme, confirmOne, confirmGroup, t]);

  const selectedItem = selected ? items.find((i) => i.id === selected) : undefined;

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background.primary }]}>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        renderItem={renderRow}
        contentContainerStyle={{
          paddingTop: insets.top + HEADER_H + 10,
          paddingBottom: insets.bottom + 96,
          paddingHorizontal: H_PAD,
        }}
        showsVerticalScrollIndicator={false}
        // A sticker library is dense but every cell is a tiny cached still, so the window can be
        // generous without the mount cost that made the post lists need tight numbers.
        initialNumToRender={6}
        maxToRenderPerBatch={4}
        windowSize={7}
        removeClippedSubviews
        ListHeaderComponent={
          <View style={styles.intro}>
            {/* The instructions the add-sheet used to hide behind its three-dots. They belong with the
                library rather than with the input: someone pasting a link already knows what they are
                doing, and someone opening this screen is the one asking what can be imported. */}
            <Text variant="caption" color={theme.colors.text.tertiary} style={styles.introText}>
              {t('stickers.intro')}
            </Text>
          </View>
        }
        ListEmptyComponent={
          !ready ? null : (
          <View style={styles.empty}>
            <Feather name="image" size={30} color={theme.colors.text.tertiary} />
            <Text variant="body" color={theme.colors.text.secondary} align="center" style={styles.emptyTitle}>
              {t('stickers.empty_title')}
            </Text>
            <Text variant="caption" color={theme.colors.text.tertiary} align="center">
              {t('stickers.empty_msg')}
            </Text>
          </View>
          )
        }
      />

      {/* ── THE SHARED CURVE, NOT SIX INLINE STOPS ───────────────────────────────
   
          These were hand-rolled here: first three linear stops, then six. `src/theme/scrim.ts` warns in
          so many words that inline per-screen stops are what let the scrims drift apart, and this screen
          was the drift.
   
          It now uses the shared surface ramp, which is a SEVENTEEN-stop `smoothstep × gamma` curve tuned
          to have no slope discontinuity anywhere — the eye picks up a slope change in a smooth field
          (Mach banding) and reads it as a line, which is what a small number of linear stops always
          produces. So this is not only consistent with the chat now, it is softer here than what it
          replaces.
   
          Still ONE `LinearGradient` per edge and no blur. A blur over this band would re-composite the
          scrolling grid beneath it every frame, costing far more than the hard edge ever did.
          `pointerEvents="none"` on the gradients so only the buttons above them catch touches. */}
      <View style={[styles.topChrome, { height: surfaceScrimHeight(insets.top + HEADER_H) }]} pointerEvents="box-none">
        <LinearGradient
          colors={topSurfaceScrimColors(theme.colors.background.primary)}
          locations={SCRIM_LOCATIONS}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        {/* ── LOWER, AND THE COUNT IS NO LONGER CLIPPED ─────────────────────────
   
            Two reports, two different causes.
   
            Sitting too high: the row was `paddingTop: insets.top` with a fixed `height: 58`, so the title
            began at the very first pixel below the safe area and the whole block was pinned against the
            notch. There is a breathing gap under the inset now, and the row's height comes from its
            content instead of a constant that the content had to fit inside.
   
            The count clipping: the row is `height: 58` and the block inside it is two stacked lines of
            text. Two lines of body + caption plus their line-height does not fit in 58 at the default
            font scale, let alone an enlarged one, so the second line was cut off by the row — this was a
            HEIGHT clip, not the width problem it looks like. Removing the fixed height fixes it at every
            font size, which is why no width was touched and no `numberOfLines` was raised.
   
            `flexShrink: 1` on the text block rather than a width: the block yields to the back button
            instead of both fighting over a hard-coded split, so a long translated title ellipsizes and a
            short one takes only what it needs. */}
        <View style={[styles.headerRow, { paddingTop: insets.top + 10 }]}>
          <Pressable
            onPress={() => { triggerHaptic('light'); router.back(); }}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            style={styles.backBtn}
          >
            <Feather name="chevron-left" size={24} color={theme.colors.text.primary} />
          </Pressable>
          <View style={styles.titleWrap}>
            <Text variant="body" weight="bold" numberOfLines={1}>{t('stickers.title')}</Text>
            {/* No `numberOfLines` at all. It is a short count string that must never be truncated, and
                capping it at one line is what turns a tight box into a clipped one. */}
            <Text variant="caption" color={theme.colors.text.tertiary}>
              {t('stickers.subtitle', undefined, { count: String(items.length) })}
            </Text>
          </View>
        </View>
      </View>

      {/* Bottom scrim, mirrored. Also hosts the pack action for the selected sticker, which is why it is
          `box-none` rather than `none`. */}
      <View style={[styles.bottomChrome, { height: surfaceScrimHeight(insets.bottom + 56) }]} pointerEvents="box-none">
        <LinearGradient
          colors={bottomSurfaceScrimColors(theme.colors.background.primary)}
          locations={SCRIM_LOCATIONS}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        {selectedItem?.packName ? (
          <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 10 }]}>
            <Pressable
              onPress={() => {
                const name = selectedItem.packName as string;
                triggerHaptic('light');
                void openUrl(`https://t.me/addstickers/${encodeURIComponent(name)}`);
              }}
              style={[styles.packBtn, { backgroundColor: theme.colors.accent.primary }]}
            >
              <Feather name="grid" size={15} color="#FFFFFF" />
              <Text variant="caption" weight="semibold" color="#FFFFFF" numberOfLines={1}>
                {t('stickers.view_pack', undefined, { pack: selectedItem.packName })}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topChrome: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  bottomChrome: { position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10, justifyContent: 'flex-end' },
  // No `height`. It was 58, and two stacked lines of text plus their line-height do not fit inside that
  // at the default font scale — which is what clipped the count. Height comes from the content now, so
  // it is correct at every accessibility text size. `alignItems: flex-start` keeps the chevron level with
  // the title rather than centred against a two-line block.
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 8, paddingBottom: 6 },
  backBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  // `flexShrink` rather than `flex: 1`: the block takes what it needs and yields to the button, instead
  // of claiming all remaining width and forcing its children to ellipsize inside it.
  titleWrap: { flexShrink: 1, marginLeft: 2, paddingTop: 6 },
  intro: { paddingBottom: 14 },
  introText: { lineHeight: 18 },
  groupHeader: { flexDirection: 'row', alignItems: 'center', paddingTop: 14, paddingBottom: 8 },
  groupHeaderText: { flex: 1, marginRight: 10 },
  groupDelete: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FF3B3010' },
  cellRow: { flexDirection: 'row', gap: CELL_GAP, marginBottom: CELL_GAP },
  cell: { width: CELL, height: CELL, borderRadius: 12, overflow: 'hidden' },
  cellPad: { width: CELL, height: CELL },
  cellImg: { width: '100%', height: '100%' },
  cellActions: { position: 'absolute', right: 4, bottom: 4, flexDirection: 'row', gap: 4 },
  cellAction: { width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(255,59,48,0.92)', alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', paddingTop: 70, gap: 8 },
  emptyTitle: { marginTop: 6 },
  bottomBar: { paddingHorizontal: H_PAD },
  packBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, height: 44, borderRadius: 14, paddingHorizontal: 16 },
});
