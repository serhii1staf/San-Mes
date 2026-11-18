/**
 * Shared building blocks for settings screens: a grouped section (title + rounded card) and a row
 * with a filled icon tile.
 *
 * Same geometry and tints as the settings root (`app/settings/index.tsx`), so a sub-screen built from
 * these reads as part of the same list rather than as a separate design. The root still carries its
 * own copy of the row; new screens use this one.
 */
import React from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { Text } from '../ui/Text';

/** Full-saturation iOS system colours; `on` is the glyph colour that reads on that fill. */
export const ICON_TINTS = {
  blue: { fg: '#0A84FF', on: '#FFFFFF' },
  red: { fg: '#FF453A', on: '#FFFFFF' },
  orange: { fg: '#FF9F0A', on: '#FFFFFF' },
  yellow: { fg: '#FFD60A', on: '#1C1C1E' },
  green: { fg: '#30D158', on: '#FFFFFF' },
  teal: { fg: '#40C8E0', on: '#FFFFFF' },
  cyan: { fg: '#64D2FF', on: '#1C1C1E' },
  indigo: { fg: '#5E5CE6', on: '#FFFFFF' },
  purple: { fg: '#BF5AF2', on: '#FFFFFF' },
  pink: { fg: '#FF66D9', on: '#FFFFFF' },
  gray: { fg: '#8E8E93', on: '#FFFFFF' },
} as const;
export type IconTint = keyof typeof ICON_TINTS;

export function SettingsSection({
  title,
  footer,
  children,
  style,
}: {
  title?: string;
  /** Small explanatory text under the card, as in iOS grouped lists. */
  footer?: string;
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.section, style]}>
      {title ? (
        <Text variant="caption" weight="semibold" color={theme.colors.text.tertiary} style={styles.sectionTitle}>
          {title.toUpperCase()}
        </Text>
      ) : null}
      <View style={[styles.card, { backgroundColor: theme.colors.background.elevated }]}>{children}</View>
      {footer ? (
        <Text variant="caption" color={theme.colors.text.tertiary} style={styles.footer}>
          {footer}
        </Text>
      ) : null}
    </View>
  );
}

export function SettingsRow({
  icon,
  iconTint,
  label,
  value,
  valueNode,
  onPress,
  showChevron = true,
  rightElement,
  isLast,
  destructive,
  labelLines = 1,
}: {
  icon?: keyof typeof MaterialIcons.glyphMap;
  iconTint?: IconTint;
  label: string;
  value?: string;
  /** Rendered instead of `value` (a colour swatch, an emoji). */
  valueNode?: React.ReactNode;
  onPress?: () => void;
  showChevron?: boolean;
  rightElement?: React.ReactNode;
  isLast?: boolean;
  destructive?: boolean;
  /** How many lines the label may wrap to before it truncates. */
  labelLines?: number;
}) {
  const theme = useTheme();
  const tint = iconTint ? ICON_TINTS[iconTint] : null;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [
        styles.row,
        !isLast ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border.light } : null,
        pressed && onPress ? { backgroundColor: theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' } : null,
      ]}
    >
      {icon && tint ? (
        <View style={[styles.tile, { backgroundColor: tint.fg }]}>
          <MaterialIcons name={icon} size={19} color={tint.on} />
        </View>
      ) : null}
      <Text variant="body" color={destructive ? theme.colors.status.error : undefined} style={{ flex: 1 }} numberOfLines={labelLines}>
        {label}
      </Text>
      {valueNode ? <View style={{ marginRight: 8 }}>{valueNode}</View> : null}
      {value && !valueNode ? (
        <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginRight: 8 }} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {rightElement}
      {showChevron && !rightElement && onPress ? (
        <Feather name="chevron-right" size={18} color={theme.colors.text.tertiary} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 22 },
  sectionTitle: { marginBottom: 8, paddingHorizontal: 16, letterSpacing: 0.4, fontSize: 12 },
  card: { borderRadius: 24, overflow: 'hidden' },
  footer: { marginTop: 8, paddingHorizontal: 16, lineHeight: 17 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 16, minHeight: 52 },
  tile: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginRight: 14 },
});
