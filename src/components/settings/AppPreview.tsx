/**
 * The app in miniature, for the top of Settings → Appearance: the chat list as it opens (header,
 * search field, category chips, three chats) with the floating tab bar, drawn in the current theme,
 * mode, accent and interface font.
 *
 * That screen used to show a chat preview, which belongs to the chat look screens (background,
 * bubble colour, corners, text size); the theme, the light/dark mode and the interface font change
 * the whole app, so the preview shows the app. Plain views and text: no glass, no images, no list.
 */
import React, { memo } from 'react';
import { StyleSheet, View, type TextStyle } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../theme';
import { Text } from '../ui/Text';
import { useAuthStore } from '../../store';
import { useT } from '../../i18n/store';

const ROWS: { emoji: string; name: string; message: string; time?: string; timeKey?: string; unread?: number }[] = [
  { emoji: '🌸', name: 'appearance.preview_user', message: 'appearance.preview_message', time: '12:40', unread: 2 },
  { emoji: '🎧', name: 'appearance.preview.name2', message: 'appearance.preview.msg2', time: '11:05' },
  { emoji: '✨', name: 'appearance.preview.name3', message: 'appearance.preview.msg3', timeKey: 'appearance.preview.yesterday' },
];

export const AppPreview = memo(function AppPreview({ height = 268 }: { height?: number }) {
  const theme = useTheme();
  const t = useT();
  const myEmoji = useAuthStore((s) => s.user?.emoji) || '😊';
  const c = theme.colors;
  const scale = theme.fontScale;
  // Sizes as the real screen's, a little smaller, and following the interface text size.
  const fs = (size: number): TextStyle => ({ fontSize: size * scale, lineHeight: Math.round(size * scale * 1.25) });
  const hairline = theme.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.10)';
  const barFill = theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.72)';
  const selection = theme.isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.07)';
  const bg = c.background.primary;

  return (
    <View
      style={[styles.root, { height, backgroundColor: bg }]}
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <View style={styles.header}>
        <View style={[styles.pill, { borderColor: hairline }]}>
          <Text weight="semibold" style={fs(11)}>{t('messages.edit')}</Text>
        </View>
        <View style={styles.titleRow}>
          <View style={[styles.titleAvatar, { backgroundColor: c.accent.primary + '33' }]}>
            <Text style={styles.titleEmoji}>{myEmoji}</Text>
          </View>
          <Text weight="bold" style={fs(17)}>{t('messages.title')}</Text>
        </View>
        <View style={[styles.round, { borderColor: hairline }]}>
          <Feather name="edit-2" size={11} color={c.text.primary} />
        </View>
      </View>

      <View style={[styles.search, { backgroundColor: c.background.elevated, borderColor: hairline }]}>
        <Feather name="search" size={11} color={c.text.tertiary} />
        <Text color={c.text.tertiary} numberOfLines={1} style={fs(11)}>{t('messages.search_placeholder')}</Text>
      </View>

      <View style={styles.chips}>
        <View style={[styles.chip, { backgroundColor: c.accent.primary + '26' }]}>
          <Text weight="semibold" color={c.accent.primary} style={fs(10.5)}>{t('messages.tab.chats')}</Text>
        </View>
        <View style={styles.chip}>
          <Text color={c.text.secondary} style={fs(10.5)}>{t('messages.tab.apps')}</Text>
        </View>
        <View style={styles.chip}>
          <Text color={c.text.secondary} style={fs(10.5)}>{t('messages.tab.archive')}</Text>
        </View>
      </View>

      {ROWS.map((r, i) => (
        <View key={r.name} style={styles.row}>
          <View style={[styles.avatar, { backgroundColor: c.background.elevated }]}>
            <Text style={styles.avatarEmoji}>{r.emoji}</Text>
          </View>
          <View
            style={[
              styles.rowText,
              i < ROWS.length - 1 ? { borderBottomColor: hairline, borderBottomWidth: StyleSheet.hairlineWidth } : null,
            ]}
          >
            <View style={styles.rowLine}>
              <Text weight="semibold" numberOfLines={1} style={{ ...fs(12.5), flexShrink: 1 }}>{t(r.name)}</Text>
              <Text color={c.text.tertiary} style={fs(9.5)}>{r.timeKey ? t(r.timeKey) : r.time}</Text>
            </View>
            <View style={styles.rowLine}>
              <Text color={c.text.secondary} numberOfLines={1} style={{ ...fs(11), flexShrink: 1 }}>{t(r.message)}</Text>
              {r.unread ? (
                <View style={[styles.badge, { backgroundColor: c.accent.primary }]}>
                  <Text weight="bold" color="#FFFFFF" style={fs(9)}>{String(r.unread)}</Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>
      ))}

      {/* The bar floats over the list, over the same kind of fade the real one sits on. */}
      <LinearGradient colors={[bg + '00', bg]} style={styles.fade} />
      <View style={styles.barRow}>
        <View style={[styles.bar, { borderColor: hairline, backgroundColor: barFill }]}>
          <View style={styles.barSlot}>
            <Ionicons name="search" size={15} color={c.text.secondary} />
          </View>
          <View style={[styles.barSlot, styles.barActive, { backgroundColor: selection }]}>
            <Ionicons name="chatbubble" size={15} color={c.accent.primary} />
          </View>
        </View>
        <View style={[styles.capsule, { borderColor: hairline, backgroundColor: barFill }]}>
          <Text style={styles.capsuleEmoji}>{myEmoji}</Text>
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  root: { overflow: 'hidden', paddingTop: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12 },
  pill: { height: 24, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  titleAvatar: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  titleEmoji: { fontSize: 11, lineHeight: 14 },
  round: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  search: {
    marginTop: 9,
    marginHorizontal: 12,
    height: 26,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
  },
  chips: { flexDirection: 'row', gap: 4, marginTop: 8, paddingHorizontal: 10 },
  chip: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 11 },
  row: { flexDirection: 'row', alignItems: 'center', paddingLeft: 12, marginTop: 6 },
  avatar: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  avatarEmoji: { fontSize: 17, lineHeight: 21 },
  rowText: { flex: 1, marginLeft: 10, paddingRight: 12, paddingBottom: 6, gap: 1 },
  rowLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  badge: { minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 56 },
  barRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 10,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  bar: { flexDirection: 'row', height: 36, borderRadius: 18, borderWidth: 1, padding: 2, gap: 2 },
  barSlot: { width: 50, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  barActive: {},
  capsule: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  capsuleEmoji: { fontSize: 16, lineHeight: 20 },
});
