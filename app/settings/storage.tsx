import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { View, Pressable, ViewStyle, Alert, ScrollView, Animated, Easing } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, G } from 'react-native-svg';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { triggerHaptic } from '../../src/utils/haptics';
import { kvAllEntries, kvDeleteRawKeys } from '../../src/services/kvStore';
import { t as tStatic, useT } from '../../src/i18n/store';

// Storage screen — the on-device cache is visualised as a clean, segmented
// progress ring: each category contributes one rounded arc sized to its share
// of the cache and tinted with the category colour, with the total size sitting
// in the middle. It replaces the old spinning-emoji "orbit" (which read as
// dated / Telegram-ish and burned a continuous animation). The ring fills once
// on mount with a subtle native-driver reveal — no infinite spin, no per-frame
// JS — so it stays cheap even on weak Android devices.
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

// ─── Storage ring ──────────────────────────────────────────────────────────
// A segmented donut: one rounded arc per non-empty category, sized to its
// share of `total` and coloured with the category colour, drawn over a faint
// track. The total cache size + a small caption sit in the centre.
//
// Performance: the geometry is computed once from `buckets`/`total` (no
// per-frame work). The only motion is a one-time entrance — opacity + a small
// scale — driven by a single Animated.Value on the NATIVE driver, so the SVG
// never re-renders during the reveal and there's nothing running afterwards.

interface RingProps {
  buckets: CategoryUsage[];
  total: number;
  totalLabel: string;
  caption: string;
  size: number;
  trackColor: string;
  centerTextColor: string;
  centerSubColor: string;
}

const STROKE_WIDTH = 16;

function StorageRing({ buckets, total, totalLabel, caption, size, trackColor, centerTextColor, centerSubColor }: RingProps) {
  const appear = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    // One-time reveal. Native driver → no JS thread cost, no SVG re-render.
    Animated.timing(appear, {
      toValue: 1,
      duration: 620,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    return () => { appear.stopAnimation(); };
  }, [appear]);

  const radius = (size - STROKE_WIDTH) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * radius;

  // Visible categories only — empty buckets contribute no arc. The gap between
  // segments is sized to the stroke width so the round caps never overlap.
  const visible = buckets.filter((b) => b.bytes > 0);
  const gapPx = visible.length > 1 ? STROKE_WIDTH : 0;
  const totalGap = gapPx * visible.length;
  const drawable = Math.max(circ - totalGap, 1);

  let cursor = 0; // px travelled along the circumference
  const segments = visible.map((b) => {
    const frac = total > 0 ? b.bytes / total : 0;
    const len = Math.max(frac * drawable, 1);
    const seg = { id: b.def.id, color: b.def.color, len, offset: cursor };
    cursor += len + gapPx;
    return seg;
  });

  const opacity = appear;
  const scale = appear.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] });

  return (
    <Animated.View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center', opacity, transform: [{ scale }] }}>
      <Svg width={size} height={size}>
        {/* Faint full-circle track underneath the coloured segments. */}
        <Circle cx={cx} cy={cy} r={radius} stroke={trackColor} strokeWidth={STROKE_WIDTH} fill="none" />
        {/* Rotate so segments start at the top (12 o'clock) and run clockwise. */}
        <G rotation={-90} originX={cx} originY={cy}>
          {segments.map((s) => (
            <Circle
              key={s.id}
              cx={cx}
              cy={cy}
              r={radius}
              stroke={s.color}
              strokeWidth={STROKE_WIDTH}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={`${s.len} ${circ - s.len}`}
              strokeDashoffset={-s.offset}
            />
          ))}
        </G>
      </Svg>

      {/* Centre label — total size + a small caption underneath. */}
      <View style={{ position: 'absolute', alignItems: 'center', justifyContent: 'center' }} pointerEvents="none">
        <Text variant="subheading" weight="bold" color={centerTextColor} style={{ fontSize: 26, lineHeight: 32 }}>{totalLabel}</Text>
        <Text variant="caption" color={centerSubColor} style={{ fontSize: 11, marginTop: 2, letterSpacing: 0.3 }}>{caption}</Text>
      </View>
    </Animated.View>
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
  const ringTrack = theme.isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)';

  return (
    <View style={containerStyle}>
      {/* Sticky header — centred title with the back chevron pinned to the
          left so the title stays truly centred (matches settings/index.tsx).
          LinearGradient + pointerEvents="box-none" lets the scroll content
          read through everywhere except on the back button. */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, height: insets.top + 56 }} pointerEvents="box-none">
        <LinearGradient colors={[theme.colors.background.primary, theme.colors.background.primary, theme.colors.background.primary + '00']} locations={[0, 0.7, 1]} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingTop: insets.top + 8, paddingHorizontal: 24, height: insets.top + 48 }} pointerEvents="box-none">
          <Pressable onPress={() => router.back()} hitSlop={8} style={{ position: 'absolute', left: 24, top: insets.top + 8 }}>
            <Feather name="chevron-left" size={24} color={theme.colors.text.primary} />
          </Pressable>
          <Text variant="body" weight="bold" style={{ fontSize: 17 }}>{t('storage.title')}</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 64, paddingBottom: insets.bottom + 32 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Segmented ring visual + caption */}
        <View style={{ alignItems: 'center', paddingTop: 12, paddingBottom: 24 }}>
          <StorageRing
            buckets={buckets}
            total={total}
            totalLabel={totalLabel}
            caption={t('storage.local_cache')}
            size={216}
            trackColor={ringTrack}
            centerTextColor={theme.colors.text.primary}
            centerSubColor={theme.colors.text.tertiary}
          />
          <Text variant="subheading" weight="bold" style={{ fontSize: 22, marginTop: 22 }}>{t('storage.usage_title')}</Text>
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
