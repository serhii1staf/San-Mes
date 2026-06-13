/**
 * ThemeIconCarousel — horizontally-scrollable picker shown under an
 * applied AI-theme action bubble. Lets the user one-shot pick a
 * pixel-icon that "matches" the theme they just had San-AI apply,
 * which is then written to `useSettingsStore.homeHeaderIcon` (the
 * most prominent placement — it sits next to the "San" title on the
 * home feed).
 *
 * UX:
 *  1. Mounts ONLY when an applied theme/custom_theme action exists
 *     in the message bubble (gated by the parent — see ai.tsx).
 *  2. Header chip + horizontal FlatList of 6–12 PixelIcons matched
 *     to the theme's hex via `iconsForThemeColor`. A small "swipe to
 *     choose" hint sits under the list.
 *  3. Tap an icon → light haptic, soft accent halo + scale 1.08 on
 *     the chosen item, persist via `setHomeHeaderIcon`, animate the
 *     carousel out (height/opacity → 0 over 280ms), reveal a
 *     confirmation row "Icon applied · <title> · Undo".
 *  4. Tap Undo → revert (`setHomeHeaderIcon(null)`), animate the
 *     carousel back in, clear the picked-id.
 *
 * Performance:
 *  - Wrapped in `React.memo` so unrelated MessageBubble re-renders
 *    (typing indicator, scroll updates) don't re-walk the carousel.
 *  - Each carousel item is its own memoized `CarouselItem` so a
 *    single pick only re-styles two rows (the new + the previous).
 *  - FlatList tuned for the 12-item list: `initialNumToRender=4`,
 *    `maxToRenderPerBatch=3`, `windowSize=4`.
 *  - All animations run on the UI thread via Reanimated worklets.
 *  - No BlurView, no native modules — JS-only / OTA-deployable.
 */

import React, { memo, useCallback, useEffect, useState } from 'react';
import { View, Pressable, FlatList } from 'react-native';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
} from 'react-native-reanimated';
import { Text } from '../ui';
import { useT } from '../../i18n/store';
import { useTheme } from '../../theme';
import { useSettingsStore } from '../../store/settingsStore';
import { triggerHaptic } from '../../utils/haptics';
import { PixelIcon } from './PixelIcon';
import { PIXEL_ICON_BY_ID } from './registry';
import type { PixelIcon as PixelIconType } from './registry';
import { iconsForThemeColor } from './themeMatch';

interface Props {
  /** Hex accent color of the just-applied theme. Drives icon matching
   *  and the halo color of the picked item. */
  hex: string;
}

interface ItemProps {
  icon: PixelIconType;
  isPicked: boolean;
  onPick: (id: string) => void;
  accentColor: string;
}

const ITEM_SIZE = 64;
const ICON_SIZE = 56;

const CarouselItem = memo(function CarouselItem({ icon, isPicked, onPick, accentColor }: ItemProps) {
  // Per-item scale shared value — settles to 1.08 when picked, 1
  // otherwise. Press-in dips to 0.94 for a tactile "press" feel.
  const scale = useSharedValue(1);
  useEffect(() => {
    scale.value = withSpring(isPicked ? 1.08 : 1, { damping: 14, stiffness: 220 });
  }, [isPicked, scale]);

  const itemStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const onPressIn = useCallback(() => {
    scale.value = withSpring(0.94, { damping: 14, stiffness: 240 });
  }, [scale]);
  const onPressOut = useCallback(() => {
    scale.value = withSpring(isPicked ? 1.08 : 1, { damping: 14, stiffness: 220 });
  }, [isPicked, scale]);

  return (
    <Pressable
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      onPress={() => onPick(icon.id)}
      hitSlop={4}
      style={{ marginRight: 10 }}
      accessibilityRole="button"
      accessibilityLabel={icon.title}
    >
      <Reanimated.View
        style={[
          {
            width: ITEM_SIZE,
            height: ITEM_SIZE,
            borderRadius: 16,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: isPicked ? 2 : 0,
            borderColor: isPicked ? accentColor : 'transparent',
            backgroundColor: isPicked ? accentColor + '22' : 'rgba(255,255,255,0.06)',
          },
          itemStyle,
        ]}
      >
        <PixelIcon id={icon.id} size={ICON_SIZE} />
      </Reanimated.View>
    </Pressable>
  );
});

function ThemeIconCarouselBase({ hex }: Props) {
  const t = useT();
  const theme = useTheme();
  const setHomeHeaderIcon = useSettingsStore(s => s.setHomeHeaderIcon);

  // Per-bubble local state — does NOT persist across re-renders of the
  // surrounding MessageBubble. The same theme being applied later in a
  // new turn mounts a fresh carousel.
  const [pickedId, setPickedId] = useState<string | null>(null);

  // Memoized — `iconsForThemeColor` is deterministic on hex, so this
  // walks PIXEL_ICONS once per mount.
  const icons = React.useMemo(() => iconsForThemeColor(hex), [hex]);

  // Animation value: 0 = open, 1 = collapsed. Drives both opacity
  // and `maxHeight` so the surrounding bubble naturally tightens up
  // when the user picks an icon.
  const collapse = useSharedValue(0);
  const carouselStyle = useAnimatedStyle(() => ({
    opacity: 1 - collapse.value,
    maxHeight: (1 - collapse.value) * 130,
  }));

  const onPick = useCallback(
    (id: string) => {
      triggerHaptic('light');
      setPickedId(id);
      setHomeHeaderIcon(id);
      collapse.value = withTiming(1, { duration: 280 });
    },
    [setHomeHeaderIcon, collapse],
  );

  const onUndo = useCallback(() => {
    triggerHaptic('light');
    setHomeHeaderIcon(null);
    setPickedId(null);
    collapse.value = withTiming(0, { duration: 260 });
  }, [setHomeHeaderIcon, collapse]);

  const renderItem = useCallback(
    ({ item }: { item: PixelIconType }) => (
      <CarouselItem
        icon={item}
        isPicked={item.id === pickedId}
        onPick={onPick}
        accentColor={hex}
      />
    ),
    [pickedId, onPick, hex],
  );

  const keyExtractor = useCallback((it: PixelIconType) => it.id, []);

  if (icons.length === 0) return null;

  return (
    <View style={{ marginTop: 8, alignSelf: 'stretch' }}>
      {/* Confirmation row — visible only after a pick. Sits above the
          (collapsed) carousel so the layout doesn't jump when the user
          undoes their choice. */}
      {pickedId ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6, paddingHorizontal: 4 }}>
          <PixelIcon id={pickedId} size={20} />
          <Text variant="caption" style={{ fontSize: 11, flexShrink: 1 }} numberOfLines={1}>
            {t('appearance.ai.icon_applied')}
            {PIXEL_ICON_BY_ID[pickedId]?.title ? ` · ${PIXEL_ICON_BY_ID[pickedId].title}` : ''}
          </Text>
          <Pressable onPress={onUndo} hitSlop={8} accessibilityRole="button">
            <Text variant="caption" color={hex} style={{ fontSize: 11, fontWeight: '600' }}>
              {t('appearance.ai.undo')}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {/* The carousel proper. Stays mounted across pick/undo so an
          `overflow: hidden` + animated `maxHeight` is enough to make
          it visually appear/disappear without re-walking the FlatList. */}
      <Reanimated.View style={[{ overflow: 'hidden' }, carouselStyle]}>
        <View
          style={{
            alignSelf: 'flex-start',
            paddingHorizontal: 10,
            paddingVertical: 4,
            backgroundColor: hex + '20',
            borderRadius: 10,
            marginBottom: 6,
          }}
        >
          <Text variant="caption" color={hex} style={{ fontSize: 10, fontWeight: '600' }}>
            {t('appearance.ai.want_icon')}
          </Text>
        </View>
        <FlatList
          horizontal
          data={icons}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          showsHorizontalScrollIndicator={false}
          removeClippedSubviews
          initialNumToRender={4}
          maxToRenderPerBatch={3}
          windowSize={4}
          contentContainerStyle={{ paddingRight: 8, paddingVertical: 2 }}
          // The list itself doesn't need to fill width — it's intrinsic.
          style={{ flexGrow: 0 }}
        />
        <Text
          variant="caption"
          color={theme.colors.text.tertiary}
          style={{ fontSize: 9, marginTop: 4, paddingHorizontal: 4 }}
        >
          {t('appearance.ai.swipe_hint')}
        </Text>
      </Reanimated.View>
    </View>
  );
}

/**
 * Memoized — re-renders only when `hex` changes. The parent
 * MessageBubble passes a stable string for the lifetime of the bubble.
 */
export const ThemeIconCarousel = memo(ThemeIconCarouselBase);
