import React, { memo, useCallback, useMemo } from 'react';
import { View, Pressable, FlatList, Text as RNText, StyleSheet } from 'react-native';
import { useT } from '../../i18n/store';
import { useLiquidGlassActive, GlassBg } from '../ui/LiquidGlass';

// ── Inline emoji panel ─────────────────────────────────────────────────────
//
// Presentational, scrollable emoji grid that the chat screen docks into the
// space the keyboard vacates. Purely additive: it never touches the composer's
// swallow/glass-merge logic — the parent renders it as a bottom-anchored
// sibling and feeds it the last real keyboard height so it lines up exactly
// where the keyboard was.
//
// Performance: a FlatList over the 7 categories (each row renders its own
// fixed emoji set), native-driven scrolling only, no per-frame JS. Tapping a
// cell just calls `onSelect` — the panel stays open for multi-pick.

// Category emoji sets — extended from `app/profile/edit.tsx`'s MOOD_CATEGORIES
// and `EmojiPickerModal` so the panel matches the rest of the app's vocabulary.
const CATEGORIES: { titleKey: string; emojis: string[] }[] = [
  {
    titleKey: 'emoji.cat.mood',
    emojis: [
      '😊', '😄', '😁', '🥰', '😍', '🤩', '😎', '🥳',
      '😇', '🤗', '😌', '😏', '🤔', '😴', '🥱', '😢',
      '😭', '😤', '🤬', '😱', '🤯', '😵‍💫', '🫠', '🥺',
      '😈', '👻', '💀', '🤡', '😷', '🤒', '🤕', '🤑',
    ],
  },
  {
    titleKey: 'emoji.cat.animals',
    emojis: [
      '🦊', '🐱', '🐶', '🐺', '🦁', '🐯', '🐼', '🐨',
      '🐸', '🐙', '🦋', '🐝', '🐞', '🦄', '🐰', '🐻',
      '🦈', '🐬', '🐳', '🦉', '🦅', '🐦', '🦜', '🐧',
      '🐢', '🦎', '🐍', '🦔', '🐹', '🐿️', '🦩', '🐾',
    ],
  },
  {
    titleKey: 'emoji.cat.food',
    emojis: [
      '🍕', '🍔', '🍟', '🌮', '🍣', '🍜', '🍩', '🍪',
      '🎂', '🍰', '🧁', '🍫', '🍬', '🍭', '🍿', '🥤',
      '☕', '🍵', '🧋', '🍺', '🍷', '🥂', '🍹', '🧃',
      '🍎', '🍓', '🍑', '🥑', '🌽', '🥕', '🍉', '🥥',
    ],
  },
  {
    titleKey: 'emoji.cat.activities',
    emojis: [
      '🎮', '🎯', '🎲', '🎸', '🎵', '🎤', '🎬', '🎨',
      '🎭', '🎪', '🎢', '🏀', '⚽', '🏈', '🎾', '🏓',
      '🎳', '🛹', '🏄', '🚴', '🏋️', '🧘', '💃', '🕺',
      '🎧', '📷', '🎥', '💻', '📚', '✍️', '🎓', '🔬',
    ],
  },
  {
    titleKey: 'emoji.cat.symbols',
    emojis: [
      '✨', '💫', '⚡', '💥', '🫧', '🧿', '🪬', '🔮',
      '☮️', '✝️', '☯️', '♾️', '🏳️‍🌈', '🎀', '👑', '🦴',
      '⭐', '🌟', '💯', '✅', '❌', '❓', '❗', '💤',
      '🎉', '🎊', '🎈', '🎁', '🔥', '🌈', '☀️', '🌙',
    ],
  },
  {
    titleKey: 'emoji.cat.hearts',
    emojis: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍',
      '🤎', '🩷', '🩵', '🩶', '💖', '💗', '💓', '💕',
      '💞', '💘', '💝', '❤️‍🔥', '❤️‍🩹', '💔', '💟', '♥️',
      '💌', '💋', '😍', '🥰', '😘', '🫶', '🤗', '💐',
    ],
  },
  {
    titleKey: 'emoji.cat.objects',
    emojis: [
      '🚀', '✈️', '🛸', '🏎️', '🚗', '🛵', '⛵', '🚂',
      '🏠', '🏰', '⛩️', '🗼', '🎡', '🌉', '💡', '🔑',
      '🗝️', '💰', '💸', '🎁', '🎈', '🎊', '🎉', '🪩',
      '🛡️', '⚔️', '🏹', '🪄', '🧲', '💊', '🩹', '🧸',
    ],
  },
];

export interface EmojiPanelProps {
  /** Panel height in px (≈ last real keyboard height) supplied by the parent. */
  height: number;
  /** Fired when an emoji cell is tapped. Panel stays open for multi-pick. */
  onSelect: (emoji: string) => void;
  /** Fired when an emoji cell is LONG-pressed — opens the preview popup. */
  onLongPress?: (emoji: string) => void;
  /** Active theme object (passed in to avoid an extra context read on mount). */
  theme: any;
  /** Bottom safe-area inset — added as list content padding so the last row
   *  clears the home indicator while the panel itself bleeds to the screen
   *  bottom edge. */
  bottomInset?: number;
  /** When embedded inside the shared MediaPanel surface, render without the
   *  own rounded background / glass (the parent provides the surface). */
  bare?: boolean;
}

function EmojiPanelComponent({ height, onSelect, onLongPress, theme, bottomInset = 0, bare = false }: EmojiPanelProps) {
  const t = useT();
  const glassActive = useLiquidGlassActive();

  const renderCategory = useCallback(
    ({ item }: { item: { titleKey: string; emojis: string[] } }) => (
      <View style={styles.category}>
        <RNText style={[styles.catTitle, { color: theme.colors.text.tertiary }]}>
          {t(item.titleKey, item.titleKey.split('.').pop())}
        </RNText>
        <View style={styles.grid}>
          {item.emojis.map((e, i) => (
            <Pressable
              key={e + i}
              onPress={() => onSelect(e)}
              onLongPress={onLongPress ? () => onLongPress(e) : undefined}
              delayLongPress={280}
              hitSlop={2}
              style={styles.cell}
            >
              <RNText style={styles.cellText} allowFontScaling={false}>
                {e}
              </RNText>
            </Pressable>
          ))}
        </View>
      </View>
    ),
    [onSelect, onLongPress, t, theme],
  );

  // Content padding: base + the bottom safe-area inset so the final emoji row
  // sits above the home indicator even though the panel extends to the very
  // bottom edge of the screen.
  const contentStyle = useMemo(
    () => [styles.listContent, { paddingBottom: 10 + bottomInset }],
    [bottomInset],
  );

  return (
    <View
      style={
        bare
          ? styles.bareContainer
          : [
              styles.container,
              {
                height,
                backgroundColor: glassActive ? 'transparent' : theme.colors.background.elevated,
              },
            ]
      }
    >
      {!bare && glassActive ? (
        <GlassBg
          borderRadius={28}
          glassStyle="regular"
          interactive={false}
          colorScheme={theme.isDark ? 'dark' : 'light'}
          tintColor={theme.isDark ? 'rgba(26,26,31,0.55)' : 'rgba(255,255,255,0.55)'}
        />
      ) : null}
      <FlatList
        data={CATEGORIES}
        keyExtractor={(it) => it.titleKey}
        renderItem={renderCategory}
        style={styles.list}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={contentStyle}
        keyboardShouldPersistTaps="always"
        initialNumToRender={3}
        windowSize={5}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    // Round only the TOP corners — the panel bleeds to the screen's side and
    // bottom edges, so bottom corners are flush (no triangular gaps showing
    // the chat behind them).
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: 'hidden',
  },
  bareContainer: { flex: 1 },
  list: { flex: 1 },
  listContent: { paddingVertical: 10, paddingHorizontal: 14 },
  category: { marginBottom: 14 },
  catTitle: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    marginLeft: 4,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '12.5%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  cellText: { fontSize: 28 },
});

export const EmojiPanel = memo(EmojiPanelComponent);
