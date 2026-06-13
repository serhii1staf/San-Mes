/**
 * ThemeIconCarousel — horizontally-scrollable picker shown under an
 * applied AI-theme action bubble. Lets the user one-shot pick a
 * pixel-icon that "matches" the theme they just had San-AI apply,
 * which is then written to `useSettingsStore.homeHeaderIcon` (the
 * most prominent placement — it sits next to the "San" title on the
 * home feed).
 *
 * Persistence model (the carousel is "dumb" wrt persistence — the
 * parent owns it):
 *  - The owning `ParsedAction.appliedIconId` field encodes the user's
 *    decision and is saved with the chat history. Three states:
 *      * `undefined` → fresh, render carousel + "want icon?" prompt.
 *      * `string`    → render compact "Icon applied · <title> · Undo".
 *      * `null`      → user explicitly declined; render "No icon · Pick
 *        again". Tapping "Pick again" lifts the field back to undefined
 *        through `onActionUpdate`, which re-expands the carousel.
 *  - Mutations bubble up via `onActionUpdate(messageId, type, patch)`
 *    so the chat screen can splice the new action object into its
 *    `messages` array and re-call `saveChatHistory` exactly once per
 *    user interaction (no churn, no debounce).
 *
 * Tap-apply animation (single shared-value timeline, 340 ms cubic
 * bezier, all on the UI thread):
 *  - Phase 1 (progress 0 → 0.40): selected icon scales 1 → 1.4; other
 *    items fade to 0.3.
 *  - Phase 2 (progress 0.40 → 0.85): selected icon flies up 18 px and
 *    fades to 0; carousel container `maxHeight` interpolates from a
 *    measured value (set by `onLayout` on first paint) down to 0.
 *  - Phase 3 (progress 0.85 → 1.00): confirmation row fades in.
 *  Reverse direction (re-pick): same shared value driven from 1 → 0.
 *
 * Performance:
 *  - Wrapped in `React.memo` so unrelated MessageBubble re-renders
 *    (typing indicator, scroll updates) don't re-walk the carousel.
 *  - Each carousel item is its own memoized `CarouselItem` so a
 *    single pick only re-styles two rows (the new + the previous).
 *  - FlatList tuned for the 12-item list: `initialNumToRender=4`,
 *    `maxToRenderPerBatch=3`, `windowSize=4`.
 *  - All animations run on the UI thread via Reanimated worklets
 *    (single shared value drives every interpolated style).
 *  - No BlurView, no native modules — JS-only / OTA-deployable.
 */

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Pressable, FlatList, type LayoutChangeEvent } from 'react-native';
import Reanimated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { Text } from '../ui';
import { useT } from '../../i18n/store';
import { useTheme } from '../../theme';
import { useSettingsStore } from '../../store/settingsStore';
import { triggerHaptic } from '../../utils/haptics';
import { PixelIcon } from './PixelIcon';
import { PIXEL_ICON_BY_ID } from './registry';
import type { PixelIcon as PixelIconType } from './registry';
import type { ParsedAction } from '../../services/aiService';
import { iconsForThemeColor } from './themeMatch';

interface Props {
  /** Hex accent color of the just-applied theme. Drives icon matching
   *  and the halo color of the picked item. */
  hex: string;
  /** Persisted user decision — see file header. */
  appliedIconId: string | null | undefined;
  /** Owning chat-message id; identifies which message in the screen's
   *  list owns this carousel so the `onActionUpdate` patch lands on the
   *  right action object. */
  messageId: string;
  /** Action type the carousel is bound to (`theme` or `custom_theme`).
   *  The screen-level handler matches against this to find the action. */
  actionType: ParsedAction['type'];
  /** Bubble a partial patch back to the screen so it can splice the new
   *  action into `messages` and re-save the chat history. */
  onActionUpdate: (
    messageId: string,
    type: ParsedAction['type'],
    patch: Partial<ParsedAction>,
  ) => void;
}

interface ItemProps {
  icon: PixelIconType;
  isPicked: boolean;
  /** When `true`, ANY pick has happened — the timeline is running
   *  forward. Non-picked items fade and the picked one flies. */
  hasAppliedPick: boolean;
  onPick: (id: string) => void;
  accentColor: string;
  progress: SharedValue<number>;
}

const ITEM_SIZE = 64;
const ICON_SIZE = 56;
const ANIM_DURATION = 340;
// Standard "ease-out" cubic bezier — feels tactile without being slow.
const cubicEase = Easing.bezier(0.4, 0, 0.2, 1);

const CarouselItem = memo(function CarouselItem({
  icon,
  isPicked,
  hasAppliedPick,
  onPick,
  accentColor,
  progress,
}: ItemProps) {
  // Press feedback uses its own spring so it doesn't tug at the
  // global apply-timeline. Settles fast (240 stiffness) for tactility.
  const pressScale = useSharedValue(1);

  const itemStyle = useAnimatedStyle(() => {
    if (hasAppliedPick && isPicked) {
      // Picked item — Phase 1 scales up, Phase 2 lifts and fades.
      const scale = interpolate(
        progress.value,
        [0, 0.4, 1],
        [1, 1.4, 1.4],
        Extrapolation.CLAMP,
      );
      const translateY = interpolate(
        progress.value,
        [0.4, 0.85],
        [0, -18],
        Extrapolation.CLAMP,
      );
      const opacity = interpolate(
        progress.value,
        [0.4, 0.85],
        [1, 0],
        Extrapolation.CLAMP,
      );
      return {
        opacity,
        transform: [{ scale: scale * pressScale.value }, { translateY }],
      };
    }
    // Non-picked: dim during Phase 1.
    const opacity = interpolate(
      progress.value,
      [0, 0.4],
      [1, hasAppliedPick ? 0.3 : 1],
      Extrapolation.CLAMP,
    );
    return {
      opacity,
      transform: [{ scale: pressScale.value }],
    };
  });

  const onPressIn = useCallback(() => {
    pressScale.value = withSpring(0.94, { damping: 14, stiffness: 240 });
  }, [pressScale]);
  const onPressOut = useCallback(() => {
    pressScale.value = withSpring(1, { damping: 14, stiffness: 220 });
  }, [pressScale]);

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

function ThemeIconCarouselBase({
  hex,
  appliedIconId,
  messageId,
  actionType,
  onActionUpdate,
}: Props) {
  const t = useT();
  const theme = useTheme();
  const setHomeHeaderIcon = useSettingsStore(s => s.setHomeHeaderIcon);

  // The icon list is deterministic on hex (see themeMatch.ts) so this
  // walks PIXEL_ICONS once per mount.
  const icons = useMemo(() => iconsForThemeColor(hex), [hex]);

  // Single shared value driving every animation phase. 0 = open
  // carousel, 1 = collapsed + confirmation row visible.
  const initialProgress = appliedIconId !== undefined ? 1 : 0;
  const progress = useSharedValue(initialProgress);

  // First-mount flag: if the user reopens the chat with `appliedIconId`
  // already set, we want the carousel collapsed instantly — no replay
  // of the apply animation. After the first commit we let the
  // shared-value animate on subsequent prop changes.
  const isFirstSync = useRef(true);
  useEffect(() => {
    if (isFirstSync.current) {
      isFirstSync.current = false;
      progress.value = appliedIconId !== undefined ? 1 : 0;
      return;
    }
    if (appliedIconId !== undefined) {
      progress.value = withTiming(1, { duration: ANIM_DURATION, easing: cubicEase });
    } else {
      progress.value = withTiming(0, { duration: ANIM_DURATION, easing: cubicEase });
    }
  }, [appliedIconId, progress]);

  // Measured natural height of the carousel on first paint. Used to
  // interpolate `maxHeight` smoothly from real → 0 instead of guessing
  // a magic number that mismatches the device's font metrics.
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null);
  const onCarouselLayout = useCallback(
    (e: LayoutChangeEvent) => {
      // Only capture the first measurement — re-measures during the
      // collapse animation would feed a value of 0 back into the
      // interpolator and break the reverse direction.
      if (measuredHeight == null) {
        const h = e.nativeEvent.layout.height;
        if (h > 0) setMeasuredHeight(h);
      }
    },
    [measuredHeight],
  );

  // The exact shared-value-driven container shrink. We use a fallback
  // of 140 px (close to the actual measured value on iPhone 12+) until
  // the first onLayout completes.
  const carouselWrapperStyle = useAnimatedStyle(() => {
    const ceiling = measuredHeight ?? 140;
    const collapse = interpolate(
      progress.value,
      [0.4, 0.85],
      [1, 0],
      Extrapolation.CLAMP,
    );
    const opacity = interpolate(
      progress.value,
      [0, 0.4, 0.85],
      [1, 0.85, 0],
      Extrapolation.CLAMP,
    );
    return { opacity, maxHeight: collapse * ceiling };
  });

  // Confirmation row: fades in during Phase 3, also gets its own
  // maxHeight interpolation so it doesn't reserve vertical space when
  // the carousel is open.
  const confirmRowStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      progress.value,
      [0.85, 1],
      [0, 1],
      Extrapolation.CLAMP,
    );
    const max = interpolate(progress.value, [0.85, 1], [0, 36], Extrapolation.CLAMP);
    return { opacity, maxHeight: max };
  });

  const onPick = useCallback(
    (id: string) => {
      // No-op if a pick is already active — protects against rapid
      // double-tap during the in-flight animation.
      if (appliedIconId === id) return;
      triggerHaptic('light');
      // 1) Apply globally so the home-header swaps right away.
      setHomeHeaderIcon(id);
      // 2) Persist on the action so the bubble survives unmount/remount.
      //    The shared-value animation runs in parallel from the prop
      //    change useEffect — we don't drive it here.
      onActionUpdate(messageId, actionType, { appliedIconId: id });
    },
    [appliedIconId, messageId, actionType, onActionUpdate, setHomeHeaderIcon],
  );

  const onUndo = useCallback(() => {
    triggerHaptic('light');
    setHomeHeaderIcon(null);
    // null = "intentionally chose no icon" — the bubble doesn't reopen
    // the carousel on a future remount.
    onActionUpdate(messageId, actionType, { appliedIconId: null });
  }, [actionType, messageId, onActionUpdate, setHomeHeaderIcon]);

  const onRepick = useCallback(() => {
    triggerHaptic('light');
    // Reset to undefined so the carousel reopens. The screen-level
    // patch handler interprets `appliedIconId: undefined` (when the key
    // is present) as a deletion to keep the persisted JSON clean.
    onActionUpdate(messageId, actionType, { appliedIconId: undefined });
  }, [actionType, messageId, onActionUpdate]);

  const renderItem = useCallback(
    ({ item }: { item: PixelIconType }) => (
      <CarouselItem
        icon={item}
        isPicked={typeof appliedIconId === 'string' && item.id === appliedIconId}
        hasAppliedPick={appliedIconId !== undefined}
        onPick={onPick}
        accentColor={hex}
        progress={progress}
      />
    ),
    [appliedIconId, onPick, hex, progress],
  );

  const keyExtractor = useCallback((it: PixelIconType) => it.id, []);

  if (icons.length === 0) return null;

  // What does the confirmation row show right now?
  const pickedIcon =
    typeof appliedIconId === 'string' ? PIXEL_ICON_BY_ID[appliedIconId] : null;

  return (
    <View style={{ marginTop: 8, alignSelf: 'stretch' }}>
      {/* Confirmation row — natural height grows from 0 as progress
          crosses the Phase 3 threshold. Two flavours:
            - `appliedIconId` is a string → "Icon applied · <title> · Undo"
            - `appliedIconId` is null     → "No icon · Pick again"
          Always rendered (animated maxHeight handles visibility) so the
          reverse-direction "Pick again" tap stays smooth. */}
      <Reanimated.View style={[{ overflow: 'hidden' }, confirmRowStyle]}>
        {pickedIcon ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              marginBottom: 6,
              paddingHorizontal: 4,
            }}
          >
            <PixelIcon id={pickedIcon.id} size={20} />
            <Text variant="caption" style={{ fontSize: 11, flexShrink: 1 }} numberOfLines={1}>
              {t('appearance.ai.icon_applied')}
              {pickedIcon.title ? ` · ${pickedIcon.title}` : ''}
            </Text>
            <Pressable onPress={onUndo} hitSlop={8} accessibilityRole="button">
              <Text variant="caption" color={hex} style={{ fontSize: 11, fontWeight: '600' }}>
                {t('appearance.ai.undo')}
              </Text>
            </Pressable>
          </View>
        ) : (
          // appliedIconId === null OR (briefly) undefined during reverse
          // animation. Tapping "Pick again" lifts back to undefined.
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              marginBottom: 6,
              paddingHorizontal: 4,
            }}
          >
            <Text
              variant="caption"
              color={theme.colors.text.tertiary}
              style={{ fontSize: 11, flexShrink: 1 }}
              numberOfLines={1}
            >
              {t('appearance.ai.no_icon')}
            </Text>
            <Pressable onPress={onRepick} hitSlop={8} accessibilityRole="button">
              <Text variant="caption" color={hex} style={{ fontSize: 11, fontWeight: '600' }}>
                {t('appearance.ai.repick')}
              </Text>
            </Pressable>
          </View>
        )}
      </Reanimated.View>

      {/* The carousel proper — natural height drops to 0 during Phase 2.
          We measure once via onLayout to drive a smooth interpolation
          rather than animating to a hard-coded ceiling. */}
      <Reanimated.View
        style={[{ overflow: 'hidden' }, carouselWrapperStyle]}
        onLayout={onCarouselLayout}
      >
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
 * Memoized — re-renders only when the key inputs change. The parent
 * MessageBubble passes a stable string for `hex` / `messageId` /
 * `actionType` / `onActionUpdate`; only `appliedIconId` flips on user
 * interaction.
 */
export const ThemeIconCarousel = memo(ThemeIconCarouselBase);
