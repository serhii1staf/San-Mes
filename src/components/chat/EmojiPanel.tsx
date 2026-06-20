import React, { memo, useCallback } from 'react';
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
  /** Active theme object (passed in to avoid an extra context read on mount). */
  theme: any;
}

function EmojiPanelComponent({ height, onSelect, theme }: EmojiPanelProps) {
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
    [onSelect, t, theme],
  );

  return (
    <View
      style={[
        styles.container,
        {
          height,
          backgroundColor: glassActive ? 'transparent' : theme.colors.background.elevated,
        },
      ]}
    >
      {glassActive ? (
        <GlassBg
          borderRadius={18}
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
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="always"
        initialNumToRender={3}
        windowSize={5}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    overflow: 'hidden',
  },
  listContent: { paddingVertical: 10, paddingHorizontal: 12 },
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
