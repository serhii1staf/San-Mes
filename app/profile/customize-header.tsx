// Customize Header — "build-your-own" profile header decorations editor.
//
// The user drags glyphs from a grouped library onto a preview shaped like the
// profile header card, then moves / resizes / rotates / deletes each placed
// item. Saving persists the scene locally (instant, per-account) AND to the
// profile row (best-effort) so other users see it. Coordinates are stored
// NORMALIZED (0..1) so the same scene renders across device widths.

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, Pressable, ScrollView, Text as RNText, StyleSheet, PanResponder, useWindowDimensions, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { useAuthStore } from '../../src/store/authStore';
import { updateProfile as updateRemoteProfile } from '../../src/lib/supabase';
import { triggerHaptic } from '../../src/utils/haptics';
import { showToast } from '../../src/store/toastStore';
import {
  HeaderScene, HeaderItem, EMPTY_SCENE, BASE_ITEM_SIZE, MAX_ITEMS,
  STICKER_LIBRARY, HEADER_BACKGROUNDS, backgroundColors,
  getLocalScene, setLocalScene, normalizeScene,
} from '../../src/services/headerScene';

const PREVIEW_H = 300;

export default function CustomizeHeaderScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width: screenW } = useWindowDimensions();
  const user = useAuthStore((s) => s.user);
  const updateLocalUser = useAuthStore((s) => s.updateProfile);

  const previewW = screenW; // full-bleed preview to match the real card width

  // Seed from any existing scene (local first, then whatever is on the user).
  const initial = useMemo<HeaderScene>(() => {
    const local = getLocalScene(user?.id);
    if (local.items.length > 0) return local;
    return normalizeScene((user as any)?.headerScene);
  }, [user]);

  const [items, setItems] = useState<HeaderItem[]>(initial.items);
  const [background, setBackground] = useState<string | null>(initial.background ?? null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [activeGroup, setActiveGroup] = useState('bg');

  // Live drag bookkeeping (px), committed to normalized state on release.
  const dragRef = useRef<{ id: string; startX: number; startY: number } | null>(null);

  const addItem = useCallback((value: string) => {
    triggerHaptic('light');
    setItems((prev) => {
      if (prev.length >= MAX_ITEMS) {
        showToast(`Максимум ${MAX_ITEMS} элементов`, 'alert-circle');
        return prev;
      }
      const it: HeaderItem = {
        id: `i-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        kind: 'emoji',
        value,
        x: 0.5,
        y: 0.4,
        scale: 1,
        rotation: 0,
      };
      setSelectedId(it.id);
      return [...prev, it];
    });
  }, []);

  const updateSelected = useCallback((patch: Partial<HeaderItem>) => {
    setItems((prev) => prev.map((it) => (it.id === selectedId ? { ...it, ...patch } : it)));
  }, [selectedId]);

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    triggerHaptic('medium');
    setItems((prev) => prev.filter((it) => it.id !== selectedId));
    setSelectedId(null);
  }, [selectedId]);

  // One PanResponder factory per item (memoized by item id via a map ref).
  const respondersRef = useRef<Record<string, any>>({});
  const getResponder = useCallback((item: HeaderItem) => {
    const existing = respondersRef.current[item.id];
    if (existing) return existing;
    const pr = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 2 || Math.abs(g.dy) > 2,
      onPanResponderGrant: () => {
        setSelectedId(item.id);
        // Snapshot the item's current normalized pos at grant.
        const cur = itemsRef.current.find((i) => i.id === item.id);
        dragRef.current = { id: item.id, startX: cur?.x ?? 0.5, startY: cur?.y ?? 0.4 };
      },
      onPanResponderMove: (_e, g) => {
        const d = dragRef.current;
        if (!d) return;
        const nx = Math.min(1, Math.max(0, d.startX + g.dx / previewW));
        const ny = Math.min(1, Math.max(0, d.startY + g.dy / PREVIEW_H));
        setItems((prev) => prev.map((it) => (it.id === d.id ? { ...it, x: nx, y: ny } : it)));
      },
      onPanResponderRelease: () => { dragRef.current = null; },
      onPanResponderTerminate: () => { dragRef.current = null; },
    });
    respondersRef.current[item.id] = pr;
    return pr;
  }, [previewW]);

  // Always-current items ref so the pan grant can read live positions.
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const onSave = useCallback(async () => {
    if (!user?.id) { router.back(); return; }
    setSaving(true);
    const scene: HeaderScene = normalizeScene({ version: 1, items, background });
    // 1) Local (instant, offline, per-account).
    setLocalScene(user.id, scene);
    // 2) Reflect on the in-memory user so the profile card updates immediately.
    try { updateLocalUser({ headerScene: scene } as any); } catch {}
    // 3) Best-effort server persist so other users see it.
    try { await updateRemoteProfile(user.id, { header_scene: scene } as any); } catch {}
    setSaving(false);
    triggerHaptic('light');
    showToast('Оформление сохранено', 'check-circle');
    router.back();
  }, [user, items, background, updateLocalUser]);

  const selected = items.find((it) => it.id === selectedId) || null;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
      {/* Top bar */}
      <View style={{ paddingTop: insets.top + 6, paddingHorizontal: 16, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
          <Feather name="x" size={24} color={theme.colors.text.primary} />
        </Pressable>
        <Text variant="h3" weight="bold">Оформление</Text>
        <Pressable onPress={onSave} disabled={saving} hitSlop={10} style={{ minWidth: 40, height: 40, alignItems: 'flex-end', justifyContent: 'center' }}>
          {saving ? <ActivityIndicator color={theme.colors.accent.primary} /> : <Text variant="body" weight="bold" color={theme.colors.accent.primary}>Готово</Text>}
        </Pressable>
      </View>

      {/* Preview — shaped like the header card. Tap empty space to deselect. */}
      <Pressable onPress={() => setSelectedId(null)}>
        <View style={{ width: previewW, height: PREVIEW_H, overflow: 'hidden', backgroundColor: theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)', borderBottomLeftRadius: 30, borderBottomRightRadius: 30 }}>
          {/* Chosen background gradient (behind everything in the preview). */}
          {backgroundColors(background) ? (
            <LinearGradient colors={backgroundColors(background) as any} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} pointerEvents="none" />
          ) : null}
          {/* Hint when empty */}
          {items.length === 0 ? (
            <View style={{ ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 }}>
              <Text variant="body" color={theme.colors.text.tertiary} style={{ textAlign: 'center' }}>
                Нажимай на элементы снизу, чтобы добавить. Перетаскивай, чтобы двигать, и выбирай для размера/поворота.
              </Text>
            </View>
          ) : null}

          {items.map((it) => {
            const isSel = it.id === selectedId;
            return (
              <View
                key={it.id}
                {...getResponder(it).panHandlers}
                style={{
                  position: 'absolute',
                  left: `${it.x * 100}%`,
                  top: `${it.y * 100}%`,
                  width: BASE_ITEM_SIZE,
                  height: BASE_ITEM_SIZE,
                  alignItems: 'center',
                  justifyContent: 'center',
                  transform: [
                    { translateX: -BASE_ITEM_SIZE / 2 },
                    { translateY: -BASE_ITEM_SIZE / 2 },
                    { rotate: `${it.rotation}deg` },
                    { scale: it.scale },
                  ],
                  borderWidth: isSel ? 1.5 : 0,
                  borderColor: theme.colors.accent.primary,
                  borderRadius: 8,
                  borderStyle: 'dashed',
                }}
              >
                <RNText allowFontScaling={false} style={{ fontSize: BASE_ITEM_SIZE * 0.82 }}>{it.value}</RNText>
              </View>
            );
          })}
        </View>
      </Pressable>

      {/* Selected-item toolbar */}
      {selected ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 12 }}>
          <ToolBtn theme={theme} icon="minus" onPress={() => updateSelected({ scale: Math.max(0.4, +(selected.scale - 0.15).toFixed(2)) })} />
          <ToolBtn theme={theme} icon="plus" onPress={() => updateSelected({ scale: Math.min(4, +(selected.scale + 0.15).toFixed(2)) })} />
          <ToolBtn theme={theme} icon="rotate-ccw" onPress={() => updateSelected({ rotation: (selected.rotation - 15 + 360) % 360 })} />
          <ToolBtn theme={theme} icon="rotate-cw" onPress={() => updateSelected({ rotation: (selected.rotation + 15) % 360 })} />
          <ToolBtn theme={theme} icon="trash-2" danger onPress={deleteSelected} />
        </View>
      ) : (
        <View style={{ height: 12 }} />
      )}

      {/* Library — group tabs + glyph grid */}
      <View style={{ flex: 1 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, gap: 8, paddingVertical: 6 }} style={{ flexGrow: 0 }}>
          {[{ key: 'bg', label: 'Фон' }, ...STICKER_LIBRARY.map((g) => ({ key: g.key, label: g.label }))].map((g) => {
            const active = g.key === activeGroup;
            return (
              <Pressable key={g.key} onPress={() => setActiveGroup(g.key)} style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 18, backgroundColor: active ? theme.colors.accent.primary : (theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)') }}>
                <RNText style={{ fontSize: 13, fontWeight: '700', color: active ? '#FFFFFF' : theme.colors.text.secondary }}>{g.label}</RNText>
              </Pressable>
            );
          })}
        </ScrollView>

        {activeGroup === 'bg' ? (
          <ScrollView contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, paddingBottom: insets.bottom + 16, paddingTop: 6, gap: 12 }}>
            {/* "None" swatch */}
            <Pressable onPress={() => { triggerHaptic('light'); setBackground(null); }} style={{ width: 76, height: 76, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)', borderWidth: background == null ? 2 : 0, borderColor: theme.colors.accent.primary }}>
              <Feather name="slash" size={22} color={theme.colors.text.tertiary} />
              <RNText style={{ fontSize: 10, color: theme.colors.text.tertiary, marginTop: 4 }}>Нет</RNText>
            </Pressable>
            {HEADER_BACKGROUNDS.map((b) => (
              <Pressable key={b.id} onPress={() => { triggerHaptic('light'); setBackground(b.id); }} style={{ width: 76, alignItems: 'center' }}>
                <LinearGradient colors={b.colors as any} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 76, height: 76, borderRadius: 16, borderWidth: background === b.id ? 3 : 0, borderColor: theme.colors.accent.primary }} />
                <RNText style={{ fontSize: 11, color: theme.colors.text.secondary, marginTop: 4 }}>{b.label}</RNText>
              </Pressable>
            ))}
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 10, paddingBottom: insets.bottom + 16, paddingTop: 4 }} keyboardShouldPersistTaps="always">
            {(STICKER_LIBRARY.find((g) => g.key === activeGroup) || STICKER_LIBRARY[0]).items.map((g, i) => (
              <Pressable key={g + i} onPress={() => addItem(g)} style={{ width: '12.5%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center' }}>
                <RNText allowFontScaling={false} style={{ fontSize: 30 }}>{g}</RNText>
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

function ToolBtn({ theme, icon, onPress, danger }: { theme: any; icon: any; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: danger ? '#FF3B3022' : (theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)') }}>
      <Feather name={icon} size={20} color={danger ? '#FF3B30' : theme.colors.text.primary} />
    </Pressable>
  );
}
