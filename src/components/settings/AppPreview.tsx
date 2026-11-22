/**
 * The app in miniature, for the top of Settings → Appearance: two phones side by side, the chat list
 * and an open chat, drawn in the current theme, mode, accent and interface font.
 *
 * Reported (Nov 2026): the previous preview was "ужасный". It was the chat list rebuilt at nearly
 * full size inside a 268 pt card, so the floating tab bar sat on top of the last chat and every row
 * was squeezed. Now each screen is laid out at a real phone's size (360 x 720 pt) and the whole
 * phone is scaled down with a transform, the way a screenshot thumbnail is, so the proportions are
 * those of the real screens and nothing has to be squeezed to fit.
 *
 * Plain views and text: no glass, no images, no list, nothing that loads.
 */
import React, { memo } from 'react';
import { StyleSheet, View, useWindowDimensions, type TextStyle } from 'react-native';
import { Feather, Ionicons, MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../theme';
import { Text } from '../ui/Text';
import { useAuthStore } from '../../store';
import { useT } from '../../i18n/store';

/** The phone each screen is laid out on, in points, before scaling. */
const PHONE_W = 360;
const PHONE_H = 720;
const PHONE_RADIUS = 48;
const BEZEL = 7;
const GAP = 18;
const PAD_V = 16;
const PAD_H = 16;

const ROWS: { emoji: string; name: string; message: string; time?: string; timeKey?: string; unread?: number }[] = [
  { emoji: '🌸', name: 'appearance.preview_user', message: 'appearance.preview_message', time: '12:40', unread: 2 },
  { emoji: '🎧', name: 'appearance.preview.name2', message: 'appearance.preview.msg2', time: '11:05' },
  { emoji: '✨', name: 'appearance.preview.name3', message: 'appearance.preview.msg3', timeKey: 'appearance.preview.yesterday' },
  { emoji: '🐱', name: 'appearance.preview.name4', message: 'appearance.preview.msg4', timeKey: 'appearance.preview.yesterday' },
  { emoji: '🎨', name: 'appearance.preview.name5', message: 'appearance.preview.msg5', timeKey: 'appearance.preview.yesterday' },
];

const BUBBLES: { own: boolean; text: string; time: string }[] = [
  { own: false, text: 'appearance.preview_message', time: '12:40' },
  { own: true, text: 'appearance.preview.reply1', time: '12:41' },
  { own: false, text: 'appearance.preview.reply2', time: '12:41' },
  { own: true, text: 'appearance.preview.reply3', time: '12:42' },
];

interface Palette {
  bg: string;
  elevated: string;
  text: string;
  secondary: string;
  tertiary: string;
  accent: string;
  hairline: string;
  fs: (size: number) => TextStyle;
}

function StatusBar({ p }: { p: Palette }) {
  return (
    <View style={styles.status}>
      <Text weight="semibold" color={p.text} style={p.fs(15)}>9:41</Text>
      <View style={styles.statusIcons}>
        <Ionicons name="cellular" size={15} color={p.text} />
        <Ionicons name="wifi" size={15} color={p.text} />
        <Ionicons name="battery-full" size={20} color={p.text} />
      </View>
    </View>
  );
}

function ChatListScreen({ p, myEmoji }: { p: Palette; myEmoji: string }) {
  const t = useT();
  return (
    <>
      <StatusBar p={p} />
      <View style={styles.listHeader}>
        <View style={[styles.pill, { borderColor: p.hairline }]}>
          <Text weight="semibold" color={p.text} style={p.fs(15)}>{t('messages.edit')}</Text>
        </View>
        <View style={styles.titleRow}>
          <View style={[styles.titleAvatar, { backgroundColor: p.accent + '33' }]}>
            <Text style={styles.titleEmoji}>{myEmoji}</Text>
          </View>
          <Text weight="bold" color={p.text} style={p.fs(24)}>{t('messages.title')}</Text>
        </View>
        <View style={[styles.round36, { borderColor: p.hairline }]}>
          <Feather name="edit-2" size={16} color={p.text} />
        </View>
      </View>
      <View style={[styles.search, { backgroundColor: p.elevated, borderColor: p.hairline }]}>
        <Feather name="search" size={17} color={p.tertiary} />
        <Text color={p.tertiary} numberOfLines={1} style={p.fs(16)}>{t('messages.search_placeholder')}</Text>
      </View>
      <View style={styles.chips}>
        <View style={[styles.chip, { backgroundColor: p.accent + '26' }]}>
          <Text weight="semibold" color={p.accent} style={p.fs(15)}>{t('messages.tab.chats')}</Text>
        </View>
        <View style={styles.chip}>
          <Text color={p.secondary} style={p.fs(15)}>{t('messages.tab.apps')}</Text>
        </View>
        <View style={styles.chip}>
          <Text color={p.secondary} style={p.fs(15)}>{t('messages.tab.archive')}</Text>
        </View>
      </View>
      {ROWS.map((r, i) => (
        <View key={r.name} style={styles.row}>
          <View style={[styles.avatar, { backgroundColor: p.elevated }]}>
            <Text style={styles.avatarEmoji}>{r.emoji}</Text>
          </View>
          <View
            style={[
              styles.rowText,
              i < ROWS.length - 1 ? { borderBottomColor: p.hairline, borderBottomWidth: StyleSheet.hairlineWidth * 2 } : null,
            ]}
          >
            <View style={styles.rowLine}>
              <Text weight="semibold" color={p.text} numberOfLines={1} style={{ ...p.fs(17), flexShrink: 1 }}>{t(r.name)}</Text>
              <Text color={p.tertiary} style={p.fs(13)}>{r.timeKey ? t(r.timeKey) : r.time}</Text>
            </View>
            <View style={styles.rowLine}>
              <Text color={p.secondary} numberOfLines={1} style={{ ...p.fs(15), flexShrink: 1 }}>{t(r.message)}</Text>
              {r.unread ? (
                <View style={[styles.badge, { backgroundColor: p.accent }]}>
                  <Text weight="bold" color="#FFFFFF" style={p.fs(12)}>{String(r.unread)}</Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>
      ))}
      {/* The floating tab bar, over the same kind of fade the real one sits on. */}
      <LinearGradient colors={[p.bg + '00', p.bg]} style={styles.bottomFade} />
      <View style={styles.tabBarRow}>
        <View style={[styles.tabBar, { borderColor: p.hairline, backgroundColor: p.elevated }]}>
          <View style={styles.tabSlot}>
            <Ionicons name="search" size={24} color={p.secondary} />
          </View>
          <View style={[styles.tabSlot, { backgroundColor: p.accent + '22' }]}>
            <Ionicons name="chatbubble" size={23} color={p.accent} />
          </View>
        </View>
        <View style={[styles.tabCapsule, { borderColor: p.hairline, backgroundColor: p.elevated }]}>
          <Text style={styles.tabEmoji}>{myEmoji}</Text>
        </View>
      </View>
    </>
  );
}

function ChatScreen({ p }: { p: Palette }) {
  const t = useT();
  return (
    <>
      {/* A faint wash of the accent, standing in for a chat background. */}
      <LinearGradient colors={[p.accent + '1F', p.bg + '00']} style={StyleSheet.absoluteFill} />
      <StatusBar p={p} />
      <View style={styles.chatHeader}>
        <View style={[styles.round44, { backgroundColor: p.elevated, borderColor: p.hairline }]}>
          <MaterialIcons name="chevron-left" size={30} color={p.text} />
        </View>
        <View style={[styles.namePill, { backgroundColor: p.elevated, borderColor: p.hairline }]}>
          <Text weight="semibold" color={p.text} numberOfLines={1} style={p.fs(15)}>{t('appearance.preview_user')}</Text>
          <Text color={p.secondary} numberOfLines={1} style={p.fs(12)}>@maria</Text>
        </View>
        <View style={[styles.round44, { backgroundColor: p.elevated, borderColor: p.hairline }]}>
          <Text style={styles.headerEmoji}>🌸</Text>
        </View>
      </View>
      <View style={styles.dayChipRow}>
        <View style={[styles.dayChip, { backgroundColor: p.elevated }]}>
          <Text weight="semibold" color={p.secondary} style={p.fs(12)}>{t('chat.day.today')}</Text>
        </View>
      </View>
      {BUBBLES.map((b, i) => (
        <View key={i} style={[styles.bubbleRow, b.own ? styles.bubbleRowOwn : null]}>
          <View style={[styles.bubble, { backgroundColor: b.own ? p.accent : p.elevated }]}>
            <Text color={b.own ? '#FFFFFF' : p.text} style={p.fs(16)}>{t(b.text)}</Text>
          </View>
          <Text color={p.tertiary} style={{ ...p.fs(11), marginBottom: 3 }}>{b.time}</Text>
        </View>
      ))}
      <LinearGradient colors={[p.bg + '00', p.bg]} style={styles.bottomFade} />
      <View style={styles.composer}>
        <View style={[styles.round44, { backgroundColor: p.elevated, borderColor: p.hairline }]}>
          <Feather name="image" size={20} color={p.accent} />
        </View>
        <View style={[styles.field, { backgroundColor: p.elevated, borderColor: p.hairline }]}>
          <Text color={p.tertiary} numberOfLines={1} style={{ ...p.fs(15), flexShrink: 1 }}>{t('chat.input_placeholder')}</Text>
          <Feather name="smile" size={20} color={p.secondary} />
        </View>
        <View style={[styles.round44, { backgroundColor: p.elevated, borderColor: p.hairline }]}>
          <Feather name="send" size={18} color={p.tertiary} />
        </View>
      </View>
    </>
  );
}

/** One phone: the screen laid out at full size, scaled down to `scale` from its top-left corner. */
function Phone({ scale, p, bezel, children }: { scale: number; p: Palette; bezel: string; children: React.ReactNode }) {
  return (
    <View style={[styles.phoneSlot, { width: PHONE_W * scale, height: PHONE_H * scale, borderRadius: PHONE_RADIUS * scale }]}>
      <View
        style={[
          styles.phone,
          { borderColor: bezel, backgroundColor: p.bg, transform: [{ scale }] },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

export const AppPreview = memo(function AppPreview({ height = 330 }: { height?: number }) {
  const theme = useTheme();
  const { width: windowW } = useWindowDimensions();
  const myEmoji = useAuthStore((s) => s.user?.emoji) || '😊';
  const c = theme.colors;
  const fontScale = theme.fontScale;
  const p: Palette = {
    bg: c.background.primary,
    elevated: c.background.elevated,
    text: c.text.primary,
    secondary: c.text.secondary,
    tertiary: c.text.tertiary,
    accent: c.accent.primary,
    hairline: theme.isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.10)',
    // The interface text size applies, as it does on the real screens.
    fs: (size: number) => ({ fontSize: size * fontScale, lineHeight: Math.round(size * fontScale * 1.25) }),
  };
  // Fit both phones in the card: the screen's width minus the card's 16 pt margins and this padding,
  // and the card's height minus its vertical padding.
  const cardW = windowW - 32;
  const byWidth = (cardW - PAD_H * 2 - GAP) / 2 / PHONE_W;
  const byHeight = (height - PAD_V * 2) / PHONE_H;
  const scale = Math.max(0.2, Math.min(byWidth, byHeight));
  const bezel = theme.isDark ? '#2C2C34' : '#D5D7DE';

  return (
    <View
      style={[styles.root, { height }]}
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <LinearGradient
        colors={[c.accent.primary + (theme.isDark ? '2E' : '24'), c.background.secondary]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.phones}>
        <Phone scale={scale} p={p} bezel={bezel}>
          <ChatListScreen p={p} myEmoji={myEmoji} />
        </Phone>
        <Phone scale={scale} p={p} bezel={bezel}>
          <ChatScreen p={p} />
        </Phone>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  root: { overflow: 'hidden', justifyContent: 'center' },
  phones: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: GAP },
  // Clips the scaled phone to its own rounded outline. No shadow: `overflow: 'hidden'` would clip it.
  phoneSlot: { overflow: 'hidden' },
  phone: {
    width: PHONE_W,
    height: PHONE_H,
    borderRadius: PHONE_RADIUS,
    borderWidth: BEZEL,
    overflow: 'hidden',
    transformOrigin: 'top left',
  },

  status: { height: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 26, paddingTop: 6 },
  statusIcons: { flexDirection: 'row', alignItems: 'center', gap: 5 },

  listHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, height: 52 },
  pill: { height: 36, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  titleAvatar: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  titleEmoji: { fontSize: 17, lineHeight: 21 },
  round36: { width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  search: {
    marginTop: 10,
    marginHorizontal: 16,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
  },
  chips: { flexDirection: 'row', gap: 6, marginTop: 12, paddingHorizontal: 12 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16 },
  row: { flexDirection: 'row', alignItems: 'center', paddingLeft: 16, marginTop: 10 },
  avatar: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center' },
  avatarEmoji: { fontSize: 27, lineHeight: 33 },
  rowText: { flex: 1, marginLeft: 12, paddingRight: 16, paddingBottom: 10, gap: 3 },
  rowLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  badge: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  bottomFade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 120 },
  tabBarRow: { position: 'absolute', left: 0, right: 0, bottom: 26, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10 },
  tabBar: { flexDirection: 'row', height: 58, borderRadius: 29, borderWidth: 1.5, padding: 4, gap: 4 },
  tabSlot: { width: 84, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  tabCapsule: { width: 58, height: 58, borderRadius: 29, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  tabEmoji: { fontSize: 26, lineHeight: 32 },

  chatHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, height: 56 },
  round44: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  headerEmoji: { fontSize: 20, lineHeight: 25 },
  namePill: { minWidth: 128, height: 44, borderRadius: 22, borderWidth: 1, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  dayChipRow: { alignItems: 'center', marginTop: 18, marginBottom: 6 },
  dayChip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 12 },
  bubbleRow: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 14, marginTop: 10, gap: 6 },
  bubbleRowOwn: { flexDirection: 'row-reverse' },
  bubble: { maxWidth: 236, borderRadius: 20, paddingHorizontal: 15, paddingVertical: 10 },
  composer: { position: 'absolute', left: 0, right: 0, bottom: 24, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 8 },
  field: { flex: 1, height: 44, borderRadius: 22, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, gap: 8 },
});
