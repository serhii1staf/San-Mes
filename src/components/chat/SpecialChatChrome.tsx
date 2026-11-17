/**
 * Header and empty state shared by the built-in chats (San AI, Музыка).
 *
 * Both screens used to draw their own 34 pt chevron circle and a title pushed off-centre by a
 * hard-coded spacer, while the user chat and the post thread use the labelled back pill. This puts
 * the special chats on the same geometry as `app/chat/[id].tsx`: pill on the left (36 tall,
 * radius 18, liquid glass where available, elevated capsule otherwise), title in the middle, the
 * chat's own icon on the right in a column as wide as the pill, so the title is centred on the
 * screen.
 *
 * The header wrapper and its gradient pass touches through (`box-none` / `none`): only the pill is
 * interactive, so the strip under the status bar no longer swallows taps on the transcript.
 */
import React, { memo, useCallback, useState } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { headerScrimHeights, SCRIM_LOCATIONS, topScrimColors } from '../../theme/scrim';
import { useT } from '../../i18n/store';
import { triggerHaptic } from '../../utils/haptics';
import { Text } from '../ui/Text';
import { NativeGlassView, useLiquidGlassActive } from '../ui/LiquidGlass';
import { VerifiedBadge } from '../ui/VerifiedBadge';

type IconName = React.ComponentProps<typeof MaterialIcons>['name'];

/** Top inset the transcript needs so its first row clears the header (same value as the user chat). */
export function useSpecialChatHeaderHeight(): number {
  const insets = useSafeAreaInsets();
  return headerScrimHeights(insets.top, 8).content;
}

export const SpecialChatHeader = memo(function SpecialChatHeader({
  title,
  subtitle,
  icon,
  verified = true,
}: {
  title: string;
  subtitle?: string;
  icon: IconName;
  verified?: boolean;
}) {
  const theme = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const glassActive = useLiquidGlassActive();
  const { gradient } = headerScrimHeights(insets.top, 8);
  const [pillWidth, setPillWidth] = useState(0);
  const onPillLayout = useCallback((e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    setPillWidth((prev) => (prev === w ? prev : w));
  }, []);
  const goBack = useCallback(() => {
    triggerHaptic('light');
    router.back();
  }, []);

  const label = (
    <>
      <MaterialIcons name="chevron-left" size={22} color={theme.colors.text.primary} />
      <Text variant="caption" weight="semibold" numberOfLines={1} color={theme.colors.text.primary} style={styles.backLabel}>
        {t('common.back')}
      </Text>
    </>
  );

  return (
    <View style={[styles.wrapper, { height: gradient }]} pointerEvents="box-none">
      <LinearGradient
        colors={topScrimColors(theme.isDark, theme.colors.background.primary)}
        locations={SCRIM_LOCATIONS}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View style={[styles.row, { paddingTop: insets.top }]} pointerEvents="box-none">
        {glassActive ? (
          <Pressable onPress={goBack} hitSlop={8} onLayout={onPillLayout} style={styles.pillPress} accessibilityRole="button" accessibilityLabel={t('common.back')}>
            <NativeGlassView glassStyle="regular" isInteractive colorScheme={theme.isDark ? 'dark' : 'light'} style={styles.pillGlass}>
              {label}
            </NativeGlassView>
          </Pressable>
        ) : (
          <Pressable
            onPress={goBack}
            hitSlop={8}
            onLayout={onPillLayout}
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            style={({ pressed }) => [
              styles.pill,
              { backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light },
              pressed ? { opacity: 0.8 } : null,
            ]}
          >
            {label}
          </Pressable>
        )}

        <View style={styles.titleWrap} pointerEvents="none">
          <View style={styles.titleRow}>
            <Text variant="body" weight="bold" numberOfLines={1} style={styles.title}>{title}</Text>
            {verified ? <VerifiedBadge size={13} /> : null}
          </View>
          {subtitle ? (
            <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1} style={styles.subtitle}>
              {subtitle}
            </Text>
          ) : null}
        </View>

        <View style={[styles.side, { width: Math.max(36, pillWidth) }]} pointerEvents="none">
          <View style={[styles.avatar, { backgroundColor: theme.colors.accent.primary + '24', borderColor: theme.colors.accent.primary + '40' }]}>
            <MaterialIcons name={icon} size={19} color={theme.colors.accent.primary} />
          </View>
        </View>
      </View>
    </View>
  );
});

export interface SpecialChatSuggestion {
  key: string;
  label: string;
  onPress: () => void;
}

/**
 * Empty transcript: the chat's icon on a tinted tile, its name, one line on what it does, and a few
 * tappable starters so a first visit has something to do besides an empty field.
 *
 * Rendered as an inverted FlatList's `ListEmptyComponent`. VirtualizedList clones that element
 * with the list's own inversion style (`_renderEmptyComponent`), so the root view takes `style`
 * and must NOT add a `scaleY: -1` of its own. The old hand-written one overrode the list's
 * `scale: -1` on Android and left the text mirrored left-to-right.
 */
export const SpecialChatEmpty = memo(function SpecialChatEmpty({
  icon,
  title,
  hint,
  suggestions,
  style,
  onLayout,
}: {
  icon: IconName;
  title: string;
  hint: string;
  suggestions?: SpecialChatSuggestion[];
  /** Injected by VirtualizedList (the inversion transform); must reach the root view. */
  style?: StyleProp<ViewStyle>;
  /** Injected by VirtualizedList to measure the empty cell. */
  onLayout?: (e: LayoutChangeEvent) => void;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.empty, style]} onLayout={onLayout}>
      <View style={[styles.emptyTile, { backgroundColor: theme.colors.accent.primary + '1F' }]}>
        <MaterialIcons name={icon} size={34} color={theme.colors.accent.primary} />
      </View>
      <View style={[styles.titleRow, { marginTop: 16 }]}>
        <Text variant="h3" weight="bold">{title}</Text>
        <VerifiedBadge size={15} />
      </View>
      <Text variant="caption" color={theme.colors.text.secondary} align="center" style={styles.emptyHint}>
        {hint}
      </Text>
      {suggestions && suggestions.length > 0 ? (
        <View style={styles.chips}>
          {suggestions.map((s) => (
            <Pressable
              key={s.key}
              onPress={() => { triggerHaptic('light'); s.onPress(); }}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.chip,
                { backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light },
                pressed ? { opacity: 0.75 } : null,
              ]}
            >
              <Text variant="caption" weight="semibold" color={theme.colors.text.primary} numberOfLines={1}>
                {s.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrapper: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 8, gap: 10 },
  pillPress: { borderRadius: 18 },
  pill: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', height: 36, borderRadius: 18, borderWidth: 1, paddingLeft: 6, paddingRight: 14, gap: 2 },
  pillGlass: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', height: 36, borderRadius: 18, paddingLeft: 8, paddingRight: 16, gap: 2 },
  backLabel: { marginLeft: -2, flexShrink: 0 },
  titleWrap: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '100%' },
  title: { flexShrink: 1 },
  subtitle: { fontSize: 11, marginTop: 1 },
  side: { flexShrink: 0, alignItems: 'flex-end', justifyContent: 'center' },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingVertical: 40 },
  emptyTile: { width: 76, height: 76, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  emptyHint: { marginTop: 8, lineHeight: 19, fontSize: 13.5, maxWidth: 300 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 22 },
  chip: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingVertical: 9, maxWidth: '100%' },
});
