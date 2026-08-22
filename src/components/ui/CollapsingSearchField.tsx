import React from 'react';
import { View, TextInput, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Reanimated, { useAnimatedStyle, interpolate, Extrapolation, SharedValue } from 'react-native-reanimated';

/**
 * The app's search field, with a Telegram-style squash on scroll.
 *
 * Extracted from `app/(tabs)/messages.tsx`, which is where it was designed and where the
 * design notes below were written. It now has exactly one definition, imported by the chat
 * list and by the Search tab, because "the search field should behave the same as the one in
 * the chat list" is only guaranteed if it IS the same component. Two copies drift.
 *
 * ── HOW THE COLLAPSE AVOIDS THE OSCILLATION IT USED TO HAVE ───────────────────
 *
 * Two earlier attempts failed, and the reasons are worth keeping written down:
 *
 *  1. Animating the zone's own HEIGHT on a scroll THRESHOLD. Collapsing changed the
 *     layout, the layout changed the scroll offset, the new offset re-evaluated the
 *     threshold, and the threshold changed the height again — a feedback loop, felt
 *     as "I scroll a little and it tries to close then snaps back open". Tuning the
 *     threshold only moves the oscillation.
 *  2. Putting the field in the list's `ListHeaderComponent` so it scrolled away
 *     naturally. That cannot oscillate, but it puts the field BELOW the category
 *     chips, which is the wrong order.
 *
 * What is here now keeps the right order (field above everything) and cannot oscillate,
 * because of one invariant: **the layout never changes.**
 *
 *  • The zone is a fixed `SEARCH_ZONE_HEIGHT` box. Always.
 *  • `progress` is a CONTINUOUS function of the scroll offset (not a threshold),
 *    computed on the UI thread by an `useAnimatedScrollHandler` worklet. No JS
 *    state, so no re-render can be triggered by scrolling.
 *  • The squash and the upward slide of everything below are TRANSFORMS plus a
 *    height change *inside* the fixed box. Transforms do not participate in layout,
 *    so the scroll offset can never be perturbed by the animation — which removes
 *    the feedback edge entirely rather than damping it.
 *
 * Because the offset drives the visual state directly and monotonically, a 2-pixel
 * scroll produces 2 pixels of squash: it tracks the finger.
 *
 * NOTE ON OPACITY: fading is safe here specifically because this component renders
 * no `GlassView` — an opacity of 0 anywhere above a glass surface kills the glass
 * (expo/expo#41024), which is why every other hide in this app is a translate.
 *
 * Memoized on primitives + stable callbacks so typing in it never re-renders the
 * rows below; `progress` is a shared value, so it is stable by nature.
 */

/** Height of the pill itself. */
export const SEARCH_FIELD_HEIGHT = 44;

/** Height of the fixed box the pill lives in — pill + the gap to whatever follows. */
export const SEARCH_ZONE_HEIGHT = SEARCH_FIELD_HEIGHT + 8;

export const CollapsingSearchField = React.memo(function CollapsingSearchField({
  value,
  onChangeText,
  placeholder,
  theme,
  progress,
  onClear,
  autoFocus,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  theme: any;
  progress: SharedValue<number>;
  /** When provided, a clear button appears once there is text. */
  onClear?: () => void;
  autoFocus?: boolean;
}) {
  // Height squash + fade, both inside the fixed-height zone.
  const pillStyle = useAnimatedStyle(() => ({
    height: SEARCH_FIELD_HEIGHT * (1 - progress.value),
    opacity: interpolate(progress.value, [0, 0.65], [1, 0], Extrapolation.CLAMP),
  }));

  return (
    <View style={{ height: SEARCH_ZONE_HEIGHT, paddingHorizontal: theme.spacing.base }}>
      <Reanimated.View
        style={[
          {
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: theme.colors.background.elevated,
            borderRadius: theme.borderRadius.pill,
            paddingHorizontal: theme.spacing.base,
            borderWidth: 1,
            borderColor: theme.colors.border.light,
            overflow: 'hidden',
          },
          pillStyle,
        ]}
      >
        <Feather name="search" size={16} color={theme.colors.text.tertiary} />
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.text.tertiary}
          autoFocus={autoFocus}
          style={{
            flex: 1,
            marginLeft: theme.spacing.sm,
            fontSize: theme.typography.sizes.base,
            fontFamily: theme.fontFamily.regular,
            color: theme.colors.text.primary,
            // No vertical padding: the pill owns the height, and padding here would
            // fight the squash.
            paddingVertical: 0,
          }}
        />
        {onClear && value.length > 0 ? (
          <Pressable onPress={onClear} hitSlop={10} accessibilityRole="button">
            <Feather name="x" size={16} color={theme.colors.text.tertiary} />
          </Pressable>
        ) : null}
      </Reanimated.View>
    </View>
  );
});
