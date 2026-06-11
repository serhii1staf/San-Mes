import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { View, Pressable, ViewStyle, Alert, ScrollView } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { triggerHaptic } from '../../src/utils/haptics';
import { kvAllEntries, kvDeleteRawKeys } from '../../src/services/kvStore';

// Storage screen — donut breakdown of on-device cache by category, modeled
// after Telegram's "Storage Usage" UI. Each category is selectable; the big
// CTA at the bottom clears whichever subset the user picks (defaults to all).
//
// Sources of cache size:
//   - MMKV (every kvAllEntries() row, bucketed by key prefix below).
//   - We do NOT include the expo-image disk cache here because expo-image
//     doesn't expose its on-disk size publicly; that cache is reset whenever
//     the user clears app data via iOS Settings or reinstalls the app, and
//     the bytes are managed by the framework.
//
// All sizes are UTF-8 byte counts of the stored JSON strings — same number
// MMKV writes to disk (within a few percent for non-ASCII data).

interface Category {
  id: string;
  label: string;
  color: string;
  // Predicate run against the RAW (already-namespaced) MMKV key.
  match: (rawKey: string) => boolean;
}

// Order matters: first match wins. "Прочее" is the catch-all and lives last.
const CATEGORY_DEFS: Category[] = [
  {
    id: 'feed',
    label: 'Лента',
    color: '#F4B547', // warm amber — the bulk of cache is usually feed JSON
    match: (k) => /feed_posts|@san:feed|posts_cache|user_posts/.test(k),
  },
  {
    id: 'chats',
    label: 'Чаты',
    color: '#4C8DF6', // signature blue for messages
    match: (k) => /chat|message|conversation|chat_settings/.test(k),
  },
  {
    id: 'music',
    label: 'Музыка',
    color: '#E5535B', // red-pink for music
    match: (k) => /music_search|music_chat_history|music_/.test(k),
  },
  {
    id: 'profiles',
    label: 'Профили',
    color: '#9B6DDF', // violet for profile/identity data
    match: (k) => /profile|user_/.test(k),
  },
  {
    id: 'notifications',
    label: 'Уведомления',
    color: '#F08A3E', // orange for notifications (slightly warmer than feed)
    match: (k) => /notifications|notif/.test(k),
  },
  {
    id: 'misc',
    label: 'Прочее',
    color: '#7A8190', // neutral grey for everything else (settings, flags…)
    match: () => true, // catch-all
  },
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
  if (bytes <= 0) return '0 КБ';
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} ГБ`;
}

// ─── Donut chart ────────────────────────────────────────────────────────────
// Uses a single SVG <Circle> per segment with strokeDasharray to draw the arc
// — the standard pure-SVG donut technique. No animation needed for a settings
// screen (perf > flair), so we render once and call it a day.

interface DonutProps {
  segments: { value: number; color: string }[];
  total: number;
  totalLabel: string;
  size: number;
  thickness: number;
  bg: string;
  trackColor: string;
  centerTextColor: string;
}

function DonutChart({ segments, total, totalLabel, size, thickness, bg, trackColor, centerTextColor }: DonutProps) {
  const radius = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const C = 2 * Math.PI * radius; // full circumference

  // Build cumulative fractions to compute each segment's strokeDashoffset.
  // We rotate the SVG group -90° so 0° is at the top of the donut.
  let cumulative = 0;
  const arcs = segments
    .filter((s) => s.value > 0)
    .map((s, idx) => {
      const fraction = total > 0 ? s.value / total : 0;
      const dashLen = fraction * C;
      const offset = -cumulative * C;
      cumulative += fraction;
      return (
        <Circle
          key={idx}
          cx={cx}
          cy={cy}
          r={radius}
          stroke={s.color}
          strokeWidth={thickness}
          fill="none"
          strokeDasharray={`${dashLen} ${C}`}
          strokeDashoffset={offset}
          strokeLinecap="butt"
        />
      );
    });

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size}>
        <G rotation={-90} origin={`${cx}, ${cy}`}>
          {/* Track ring — visible when no data yet, otherwise overdrawn by segments. */}
          <Circle cx={cx} cy={cy} r={radius} stroke={trackColor} strokeWidth={thickness} fill="none" />
          {arcs}
        </G>
      </Svg>
      <View style={{ position: 'absolute', alignItems: 'center', justifyContent: 'center' }} pointerEvents="none">
        <Text variant="subheading" weight="bold" color={centerTextColor} style={{ fontSize: 22 }}>{totalLabel}</Text>
      </View>
    </View>
  );
}

export default function StorageScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
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

  // Selected total is what the CTA actually clears. When everything's selected
  // (default) it equals the grand total, so the button label reads naturally.
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
      'Очистить кэш?',
      'Локальные данные выбранных категорий будут удалены. Они снова появятся при следующем открытии соответствующих экранов.',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Очистить', style: 'destructive', onPress: async () => {
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
  const totalLabel = total > 0 ? formatBytes(total).replace(/\s+/g, ' ') : '0 КБ';
  const segments = useMemo(() => buckets.map((b) => ({ value: b.bytes, color: b.def.color })), [buckets]);

  return (
    <View style={containerStyle}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 32 }} showsVerticalScrollIndicator={false}>
        {/* Header — lone back button on the left, no centred title (the page
            title sits below the donut, Telegram-style). */}
        <View style={{ paddingHorizontal: 24, paddingBottom: 8 }}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={8}
            style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: cardBg, alignItems: 'center', justifyContent: 'center' }}
          >
            <Feather name="chevron-left" size={22} color={theme.colors.text.primary} />
          </Pressable>
        </View>

        {/* Donut + heading */}
        <View style={{ alignItems: 'center', paddingTop: 8, paddingBottom: 18 }}>
          <DonutChart
            segments={segments}
            total={total || 1}
            totalLabel={totalLabel}
            size={232}
            thickness={32}
            bg={theme.colors.background.primary}
            trackColor={theme.isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)'}
            centerTextColor={theme.colors.text.primary}
          />
          <Text variant="subheading" weight="bold" style={{ fontSize: 22, marginTop: 14 }}>Использование памяти</Text>
          <Text variant="caption" color={theme.colors.text.tertiary} align="center" style={{ paddingHorizontal: 32, marginTop: 6, fontSize: 13, lineHeight: 18 }}>
            San хранит локально {formatBytes(total)} данных. Их можно безопасно очистить — приложение восстановит нужное при следующем открытии.
          </Text>
          {/* Slim progress bar mirrors the Telegram screenshot — visualises
              cache "weight" with a single accent fill. */}
          <View style={{ marginTop: 12, width: 140, height: 4, borderRadius: 2, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)', overflow: 'hidden' }}>
            <View style={{ height: '100%', width: total > 0 ? '40%' : '0%', backgroundColor: theme.colors.accent.primary, borderRadius: 2 }} />
          </View>
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
                <Text variant="body" weight="semibold" style={{ fontSize: 15 }}>{b.def.label}</Text>
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
              {isClearing ? 'Очищаем…' : `Очистить выбранное · ${formatBytes(selectedTotal)}`}
            </Text>
          </Pressable>
          <Text variant="caption" align="center" color={theme.colors.text.tertiary} style={{ marginTop: 12, paddingHorizontal: 16, fontSize: 12, lineHeight: 17 }}>
            Все ваши посты, сообщения и медиа остаются на серверах San. Локальный кэш — это просто копия для скорости и работы без интернета.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
