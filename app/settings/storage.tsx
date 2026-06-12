import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { View, Pressable, ViewStyle, Alert, ScrollView, Animated, Easing } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { triggerHaptic } from '../../src/utils/haptics';
import { kvAllEntries, kvDeleteRawKeys } from '../../src/services/kvStore';
import { t as tStatic, useT } from '../../src/i18n/store';

// Storage screen — instead of a Telegram-style donut chart we render an
// "orbit" of category emojis around a soft accent halo. Each emoji's size
// scales with how much of the on-device cache that category occupies, and
// the whole orbit rotates slowly so the screen feels alive without
// distracting the user from the data.
//
// Sources of cache size:
//   - MMKV (every kvAllEntries() row, bucketed by key prefix below).
//   - We do NOT include the expo-image disk cache here because expo-image
//     doesn't expose its on-disk size publicly; that cache is reset whenever
//     the user clears app data via iOS Settings or reinstalls the app.

interface Category {
  id: string;
  label: string;
  color: string;
  emoji: string;
  // Predicate run against the RAW (already-namespaced) MMKV key.
  match: (rawKey: string) => boolean;
}

// Order matters: first match wins. "Прочее" is the catch-all and lives last.
const CATEGORY_DEFS: Category[] = [
  { id: 'feed',          label: 'storage.cat.feed',          color: '#F4B547', emoji: '📰', match: (k) => /feed_posts|@san:feed|posts_cache|user_posts/.test(k) },
  { id: 'chats',         label: 'storage.cat.chats',         color: '#4C8DF6', emoji: '💬', match: (k) => /chat|message|conversation|chat_settings/.test(k) },
  { id: 'music',         label: 'storage.cat.music',         color: '#E5535B', emoji: '🎵', match: (k) => /music_search|music_chat_history|music_/.test(k) },
  { id: 'profiles',      label: 'storage.cat.profiles',      color: '#9B6DDF', emoji: '👤', match: (k) => /profile|user_/.test(k) },
  { id: 'notifications', label: 'storage.cat.notifications', color: '#F08A3E', emoji: '🔔', match: (k) => /notifications|notif/.test(k) },
  { id: 'misc',          label: 'storage.cat.misc',          color: '#7A8190', emoji: '✨', match: () => true },
];

interface CategoryUsage {
  def: Category;
  bytes: number;
  keys: string[];
}

function bucketEntries(entries: Array<{ key: string; bytes: number }>): CategoryUsage[] {
  const out: CategoryUsage[] = CATEGORY_DEFS.map((def) => ({ def, bytes: 0, keys: [] }));
  for (const { key, bytes } of entries) {
    for (let i = 0; i < CATEGORY_DEFS.length; i++) {
      if (CATEGORY_DEFS[i].match(key)) {
        out[i].bytes += bytes;
        out[i].keys.push(key);
        break;
      }
    }
  }
  return out;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return `0 ${tStatic('storage.unit.kb')}`;
  if (bytes < 1024) return `${bytes} ${tStatic('storage.unit.b')}`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} ${tStatic('storage.unit.kb')}`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} ${tStatic('storage.unit.mb')}`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} ${tStatic('storage.unit.gb')}`;
}

// ─── Orbit visual ──────────────────────────────────────────────────────────
// A circular halo + a ring of category emojis that gently orbits around it.
// One Animated.Value drives rotation; emoji positions are computed from
// fixed angles (offset by the rotation) so the layout stays stable. All
// transforms run on the native driver — no JS thread cost while the user
// is reading.
//
// We deliberately AVOID rendering animated emoji size changes (would force
// layout work each frame). Instead each emoji gets its size baked in once
// from the bucket totals. Rotation is the only continuous animation.

interface OrbitProps {
  buckets: CategoryUsage[];
  total: number;
  totalLabel: string;
  size: number;
  haloColor: string;
  haloAccent: string;
  centerTextColor: string;
  centerSubColor: string;
  caption: string;
}

const ORBIT_DIAMETER_RATIO = 0.78; // orbit ring diameter relative to outer container
const EMOJI_BASE = 22;             // px font-size for the smallest visible emoji
const EMOJI_RANGE = 22;             // additional px gained at 100% category share

function Orbit({ buckets, total, totalLabel, size, haloColor, haloAccent, centerTextColor, centerSubColor, caption }: OrbitProps) {
  const rot = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    // Slow continuous rotation (~30 s per full revolution). Native driver
    // keeps it free even on Android E-cores.
    Animated.loop(
      Animated.timing(rot, { toValue: 1, duration: 30000, easing: Easing.linear, useNativeDriver: true }),
    ).start();
    return () => { rot.stopAnimation(); };
  }, [rot]);

  const orbitRadius = (size * ORBIT_DIAMETER_RATIO) / 2;
  const cx = size / 2;
  const cy = size / 2;

  // Emojis positioned at fixed angles around the circle. We rotate the
  // whole containing View — cheaper than animating each child's transform.
  const visibleBuckets = buckets.filter((b) => b.bytes > 0);
  const fallback = visibleBuckets.length === 0 ? buckets : visibleBuckets;
  const N = fallback.length;
  const placements = fallback.map((b, i) => {
    const angle = (i / N) * 2 * Math.PI - Math.PI / 2; // start at top
    const x = cx + orbitRadius * Math.cos(angle);
    const y = cy + orbitRadius * Math.sin(angle);
    const share = total > 0 ? b.bytes / total : 1 / N;
    const fontSize = Math.round(EMOJI_BASE + EMOJI_RANGE * Math.sqrt(share));
    return { b, x, y, fontSize };
  });

  const spin = rot.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {/* Soft halo behind the orbit — two concentric circles for depth. */}
      <View style={{ position: 'absolute', width: size * 0.96, height: size * 0.96, borderRadius: size * 0.48, backgroundColor: haloColor }} />
      <View style={{ position: 'absolute', width: size * 0.72, height: size * 0.72, borderRadius: size * 0.36, backgroundColor: haloAccent }} />

      {/* Rotating layer — emojis are children that ride along with the spin. */}
      <Animated.View style={{ width: size, height: size, position: 'absolute', transform: [{ rotate: spin }] }}>
        {placements.map(({ b, x, y, fontSize }) => (
          <View
            key={b.def.id}
            style={{
              position: 'absolute',
              left: x - fontSize,
              top: y - fontSize,
              width: fontSize * 2,
              height: fontSize * 2,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {/* Counter-rotate the emoji so it stays upright while the orbit spins. */}
            <Animated.Text
              allowFontScaling={false}
              style={{
                fontSize,
                transform: [{ rotate: rot.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-360deg'] }) }],
              }}
            >{b.def.emoji}</Animated.Text>
          </View>
        ))}
      </Animated.View>

      {/* Center label — total + a small caption underneath. */}
      <View style={{ position: 'absolute', alignItems: 'center', justifyContent: 'center', paddingTop: 4 }} pointerEvents="none">
        <Text variant="subheading" weight="bold" color={centerTextColor} style={{ fontSize: 24, lineHeight: 30 }}>{totalLabel}</Text>
        <Text variant="caption" color={centerSubColor} style={{ fontSize: 11, marginTop: 2 }}>{caption}</Text>
      </View>
    </View>
  );
}

export default function StorageScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const [entries, setEntries] = useState<Array<{ key: string; bytes: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [isClearing, setIsClearing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(CATEGORY_DEFS.map((c) => c.id)));

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const all = await kvAllEntries();
      setEntries(all);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const buckets = useMemo(() => bucketEntries(entries), [entries]);
  const total = useMemo(() => buckets.reduce((sum, b) => sum + b.bytes, 0), [buckets]);
  const selectedBuckets = useMemo(() => buckets.filter((b) => selectedIds.has(b.def.id)), [buckets, selectedIds]);
  const selectedTotal = useMemo(() => selectedBuckets.reduce((sum, b) => sum + b.bytes, 0), [selectedBuckets]);

  const toggle = (id: string) => {
    triggerHaptic('light');
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const clear = async () => {
    if (selectedTotal <= 0 || isClearing) return;
    triggerHaptic('medium');
    Alert.alert(
      t('storage.confirm_title'),
      t('storage.confirm_msg'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('storage.clear'), style: 'destructive', onPress: async () => {
            setIsClearing(true);
            try {
              const keysToDelete: string[] = [];
              for (const b of selectedBuckets) keysToDelete.push(...b.keys);
              kvDeleteRawKeys(keysToDelete);
              await refresh();
            } finally {
              setIsClearing(false);
            }
          },
        },
      ],
    );
  };

  const containerStyle: ViewStyle = { flex: 1, backgroundColor: theme.colors.background.primary };
  const cardBg = theme.colors.background.elevated;
  const totalLabel = total > 0 ? formatBytes(total).replace(/\s+/g, ' ') : `0 ${t('storage.unit.kb')}`;

  return (
    <View style={containerStyle}>
      {/* Sticky header — standard gradient fade matching the home/notifications
          screens so the back-button + title never scroll away. Using
          LinearGradient + pointerEvents="box-none" means the scroll content
          reads through anywhere except on the interactive buttons. */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, height: insets.top + 56 }} pointerEvents="box-none">
        <LinearGradient colors={[theme.colors.background.primary, theme.colors.background.primary, theme.colors.background.primary + '00']} locations={[0, 0.7, 1]} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: insets.top + 8, paddingHorizontal: 24, gap: 12 }} pointerEvents="auto">
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Feather name="chevron-left" size={24} color={theme.colors.text.primary} />
          </Pressable>
          <Text variant="body" weight="bold" style={{ fontSize: 17 }}>{t('storage.title')}</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 64, paddingBottom: insets.bottom + 32 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Orbit visual + caption */}
        <View style={{ alignItems: 'center', paddingTop: 8, paddingBottom: 24 }}>
          <Orbit
            buckets={buckets}
            total={total}
            totalLabel={totalLabel}
            size={232}
            haloColor={theme.colors.accent.primary + '14'}
            haloAccent={theme.colors.accent.primary + '22'}
            centerTextColor={theme.colors.text.primary}
            centerSubColor={theme.colors.text.tertiary}
            caption={t('storage.local_cache')}
          />
          <Text variant="subheading" weight="bold" style={{ fontSize: 22, marginTop: 18 }}>{t('storage.usage_title')}</Text>
          <Text variant="caption" color={theme.colors.text.tertiary} align="center" style={{ paddingHorizontal: 32, marginTop: 6, fontSize: 13, lineHeight: 18 }}>
            {t('storage.usage_caption', undefined, { bytes: formatBytes(total) })}
          </Text>
        </View>

        {/* Category list */}
        <View style={{ marginHorizontal: 16, backgroundColor: cardBg, borderRadius: 18, paddingVertical: 4 }}>
          {buckets.map((b, i) => {
            const pct = total > 0 ? Math.round((b.bytes / total) * 1000) / 10 : 0;
            const checked = selectedIds.has(b.def.id);
            const dimmed = b.bytes <= 0;
            return (
              <Pressable
                key={b.def.id}
                onPress={() => !dimmed && toggle(b.def.id)}
                disabled={dimmed}
                style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 13, borderTopWidth: i === 0 ? 0 : 0.5, borderTopColor: theme.colors.border.light, opacity: dimmed ? 0.45 : 1 }}
              >
                <View
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 11,
                    backgroundColor: b.def.color,
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginRight: 12,
                    opacity: checked ? 1 : 0.35,
                  }}
                >
                  {checked && <Feather name="check" size={13} color="#FFFFFF" />}
                </View>
                <Text style={{ fontSize: 16, marginRight: 8 }} allowFontScaling={false}>{b.def.emoji}</Text>
                <Text variant="body" weight="semibold" style={{ fontSize: 15 }}>{t(b.def.label)}</Text>
                <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginLeft: 6, fontSize: 13 }}>{pct}%</Text>
                <View style={{ flex: 1 }} />
                <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 13 }}>{formatBytes(b.bytes)}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* CTA */}
        <View style={{ paddingHorizontal: 16, marginTop: 16 }}>
          <Pressable
            onPress={clear}
            disabled={isClearing || selectedTotal <= 0 || loading}
            style={{
              paddingVertical: 16,
              alignItems: 'center',
              backgroundColor: theme.colors.accent.primary,
              borderRadius: 18,
              opacity: isClearing || selectedTotal <= 0 || loading ? 0.5 : 1,
            }}
          >
            <Text variant="body" weight="bold" color="#FFFFFF" style={{ fontSize: 15 }}>
              {isClearing ? t('storage.clearing') : t('storage.clear_selected', undefined, { size: formatBytes(selectedTotal) })}
            </Text>
          </Pressable>
          <Text variant="caption" align="center" color={theme.colors.text.tertiary} style={{ marginTop: 12, paddingHorizontal: 16, fontSize: 12, lineHeight: 17 }}>
            {t('storage.footer')}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
