/**
 * The profile emoji picker («Изменить эмодзи»).
 *
 * ── WHY IT OPENED WITH A JOLT ───────────────────────────────────────────────
 *
 * Reported: the sheet "appears too abruptly, maybe with lag". It mounted everything at once: seven
 * categories × 32 emoji = 224 `Pressable` cells plus their text, inside a plain `ScrollView`, in the
 * same commit that presents the Modal. The sheet's rise is a 300 ms UI-thread animation, but it can
 * only start once that commit has landed and the native views exist, so the first part of the rise
 * was spent mounting cells and the sheet appeared to skip straight to the middle of its motion. On a
 * weak phone that is a visible jump.
 *
 * Now it is a virtualised list of ROWS (a category header, or seven emoji), with fixed row heights so
 * nothing is measured. The first commit holds what fits on screen, about a fifth of the cells, and
 * the rest mounts as it scrolls into view. Cells are memoised, so picking one re-renders two cells
 * (the old and the new selection), not the grid.
 */
import React, { memo, useCallback, useMemo } from 'react';
import { Dimensions, FlatList, Pressable, StyleSheet, Text as RNText, View, type ListRenderItem } from 'react-native';
import { useTheme } from '../../theme';
import { Text } from '../ui/Text';
import { SlideUpSheet } from '../ui/SlideUpSheet';
import { emojiTextStyle } from '../ui/emojiText';
import { useT } from '../../i18n/store';

export const MOOD_CATEGORIES: { titleKey: string; emojis: string[] }[] = [
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
    titleKey: 'emoji.cat.nature',
    emojis: [
      '🌸', '🌺', '🌻', '🌹', '🌷', '💐', '🍀', '🌿',
      '🍃', '🍂', '🍁', '🌾', '🌵', '🎋', '🪷', '🌊',
      '☀️', '🌙', '⭐', '🌈', '☁️', '⚡', '❄️', '🔥',
      '🍄', '🪨', '💎', '🪐', '🌍', '🌋', '🏔️', '🌅',
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
      '💝', '💖', '💗', '💓', '💕', '❤️‍🔥', '🖤', '💜',
      '💙', '💚', '💛', '🧡', '❤️', '🤍', '🩷', '🩵',
      '☮️', '✝️', '☯️', '♾️', '🏳️‍🌈', '🎀', '👑', '🦴',
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

const COLS = 7;
const GAP = 6;
const SIDE_PAD = 16;
/** The sheet floats 8 pt from each screen edge (SlideUpSheet `INSET_X`). */
const SHEET_INSET = 8;
const HEADER_H = 36;

type Row =
  | { key: string; kind: 'header'; titleKey: string }
  | { key: string; kind: 'emojis'; emojis: string[] };

const ROWS: Row[] = (() => {
  const out: Row[] = [];
  for (const cat of MOOD_CATEGORIES) {
    out.push({ key: `h:${cat.titleKey}`, kind: 'header', titleKey: cat.titleKey });
    for (let i = 0; i < cat.emojis.length; i += COLS) {
      out.push({ key: `r:${cat.titleKey}:${i}`, kind: 'emojis', emojis: cat.emojis.slice(i, i + COLS) });
    }
  }
  return out;
})();

const EmojiCell = memo(function EmojiCell({
  emoji,
  size,
  active,
  activeBg,
  activeBorder,
  idleBg,
  onPick,
}: {
  emoji: string;
  size: number;
  active: boolean;
  activeBg: string;
  activeBorder: string;
  idleBg: string;
  onPick: (emoji: string) => void;
}) {
  return (
    <Pressable
      onPress={() => onPick(emoji)}
      accessibilityRole="button"
      accessibilityLabel={emoji}
      style={({ pressed }) => [
        {
          width: size,
          height: size,
          borderRadius: Math.round(size * 0.3),
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: active ? activeBg : idleBg,
          borderWidth: active ? 2 : 0,
          borderColor: activeBorder,
          transform: [{ scale: pressed ? 0.9 : 1 }],
        },
      ]}
    >
      <RNText style={cellText(size)} allowFontScaling={false}>
        {emoji}
      </RNText>
    </Pressable>
  );
});

const cellTextCache = new Map<number, ReturnType<typeof emojiTextStyle>>();
function cellText(size: number) {
  const px = Math.round(size * 0.56);
  let s = cellTextCache.get(px);
  if (!s) {
    s = emojiTextStyle(px);
    cellTextCache.set(px, s);
  }
  return s;
}

/**
 * Colours for a host screen that does not follow the app theme. Sign-up is always dark, and the old
 * picker it used (`EmojiPickerModal`) neither matched that screen nor this sheet.
 */
export interface EmojiSheetPalette {
  card: string;
  grabber: string;
  title: string;
  header: string;
  cellIdle: string;
  cellActive: string;
  /** Selection ring and the preview's ring. */
  accent: string;
  previewBg: string;
}

export function EmojiPickerSheet({
  visible,
  selected,
  onPick,
  onClose,
  palette,
}: {
  visible: boolean;
  selected: string;
  onPick: (emoji: string) => void;
  onClose: () => void;
  palette?: EmojiSheetPalette;
}) {
  const theme = useTheme();
  const t = useT();
  const accent = palette?.accent ?? theme.colors.accent.primary;
  const headerColor = palette?.header ?? theme.colors.text.secondary;

  // Seven cells across whatever width the floating sheet has; the rounding remainder goes into the
  // side padding so the grid sits centred while short rows still start at the left.
  const { cell, sidePad } = useMemo(() => {
    const sheetW = Dimensions.get('window').width - SHEET_INSET * 2;
    const c = Math.floor((sheetW - SIDE_PAD * 2 - GAP * (COLS - 1)) / COLS);
    return { cell: c, sidePad: (sheetW - (c * COLS + GAP * (COLS - 1))) / 2 };
  }, []);
  const rowH = cell + GAP;
  const listH = Math.round(Math.min(Dimensions.get('window').height * 0.45, HEADER_H + rowH * 7));

  const idleBg = palette?.cellIdle ?? (theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)');
  const activeBg = palette?.cellActive ?? accent + '30';

  const renderItem = useCallback<ListRenderItem<Row>>(
    ({ item }) => {
      if (item.kind === 'header') {
        return (
          <View style={styles.header}>
            <Text variant="caption" weight="semibold" color={headerColor}>
              {t(item.titleKey)}
            </Text>
          </View>
        );
      }
      return (
        <View style={[styles.row, { height: rowH }]}>
          {item.emojis.map((e) => (
            <EmojiCell
              key={e}
              emoji={e}
              size={cell}
              active={e === selected}
              activeBg={activeBg}
              activeBorder={accent}
              idleBg={idleBg}
              onPick={onPick}
            />
          ))}
        </View>
      );
    },
    [accent, activeBg, cell, headerColor, idleBg, onPick, rowH, selected, t],
  );

  // Fixed heights, so the list never measures a row and can jump straight to any offset.
  const getItemLayout = useCallback(
    (_: ArrayLike<Row> | null | undefined, index: number) => {
      let offset = 0;
      for (let i = 0; i < index; i++) offset += ROWS[i].kind === 'header' ? HEADER_H : rowH;
      return { length: ROWS[index].kind === 'header' ? HEADER_H : rowH, offset, index };
    },
    [rowH],
  );

  return (
    <SlideUpSheet visible={visible} onClose={onClose} cardColor={palette?.card} grabberColor={palette?.grabber}>
      <Text variant="body" weight="semibold" align="center" color={palette?.title} style={styles.title}>
        {t('edit_profile.emoji_title')}
      </Text>
      <View style={[styles.preview, { borderColor: accent, backgroundColor: palette?.previewBg ?? accent + '15' }]}>
        <RNText style={styles.previewText} allowFontScaling={false}>
          {selected}
        </RNText>
      </View>
      <FlatList
        data={ROWS}
        keyExtractor={(r) => r.key}
        renderItem={renderItem}
        getItemLayout={getItemLayout}
        extraData={selected}
        style={{ height: listH }}
        contentContainerStyle={[styles.listContent, { paddingHorizontal: sidePad }]}
        showsVerticalScrollIndicator={false}
        initialNumToRender={9}
        maxToRenderPerBatch={8}
        windowSize={5}
        // Native clipping of off-screen rows; on iOS it can blank rows inside a Modal mid-scroll.
        removeClippedSubviews={false}
      />
    </SlideUpSheet>
  );
}

const styles = StyleSheet.create({
  title: { paddingVertical: 8 },
  preview: {
    alignSelf: 'center',
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    marginBottom: 10,
  },
  previewText: emojiTextStyle(36),
  listContent: { paddingBottom: 8 },
  header: { height: HEADER_H, justifyContent: 'flex-end', paddingBottom: 8, paddingHorizontal: 2 },
  row: { flexDirection: 'row', gap: GAP },
});
