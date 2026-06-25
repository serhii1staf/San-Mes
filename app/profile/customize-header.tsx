// Customize Header — "build-your-own" profile header decorations editor.
//
// The user picks/draws a BACKGROUND (a drawn-landscape preset, a freehand
// drawing, or both — optionally blended with their banner photo) and drags
// emoji STICKERS (each with an optional looping animation) onto a preview
// shaped like the profile header card. Saving persists the scene locally
// (instant, per-account) AND to the profile row (best-effort) so other users
// see it. Coordinates are stored NORMALIZED (0..1 for stickers, 0..100 for
// drawing) so the same scene renders across device widths.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Pressable, ScrollView, FlatList, Text as RNText, StyleSheet, PanResponder, useWindowDimensions, ActivityIndicator, InteractionManager } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { useT } from '../../src/i18n/store';
import { useAuthStore } from '../../src/store/authStore';
import { updateProfile as updateRemoteProfile } from '../../src/lib/supabase';
import { triggerHaptic } from '../../src/utils/haptics';
import { showToast } from '../../src/store/toastStore';
import { HeaderLandscape } from '../../src/components/profile/HeaderLandscape';
import { StickerGlyph } from '../../src/components/profile/StickerGlyph';
import {
  HeaderScene, HeaderItem, HeaderItemAnim, HeaderDrawStroke, BASE_ITEM_SIZE, MAX_ITEMS,
  STICKER_LIBRARY, HEADER_BACKGROUNDS,
  getLocalScene, setLocalScene, normalizeScene,
} from '../../src/services/headerScene';

const PREVIEW_H = 300;

// Looping animations a sticker can carry. Labels go through t() with a Russian
// fallback (no new hardcoded strings — uses the existing i18n system).
const ANIM_OPTIONS: { key: HeaderItemAnim; icon: any; label: string; tKey: string }[] = [
  { key: 'none', icon: 'slash', label: 'Без', tKey: 'customize.anim_none' },
  { key: 'float', icon: 'chevrons-up', label: 'Парение', tKey: 'customize.anim_float' },
  { key: 'pulse', icon: 'heart', label: 'Пульс', tKey: 'customize.anim_pulse' },
  { key: 'spin', icon: 'refresh-cw', label: 'Вращение', tKey: 'customize.anim_spin' },
  { key: 'swing', icon: 'wind', label: 'Качание', tKey: 'customize.anim_swing' },
];

// Freehand drawing palette + brush size range (continuous via the slider).
const DRAW_COLORS = [
  '#FFFFFF', '#C9CDD4', '#000000', '#FF3B30', '#FF6B6B', '#FF9F45', '#FFD93D',
  '#A8E05F', '#6BCB77', '#2EC4B6', '#4D96FF', '#3A6EA5', '#B388FF', '#9B59B6',
  '#FF6FB5', '#8B5A2B',
];
const DRAW_MIN_W = 1;
const DRAW_MAX_W = 18;

// Background swatch list: a "none" tile followed by every scene. Rendered in a
// windowed FlatList so only visible swatches mount (scales to many scenes).
const BG_ITEMS: { id: string | null }[] = [{ id: null }, ...HEADER_BACKGROUNDS.map((b) => ({ id: b.id }))];

export default function CustomizeHeaderScreen() {
  const theme = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const { width: screenW } = useWindowDimensions();
  const user = useAuthStore((s) => s.user);
  const updateLocalUser = useAuthStore((s) => s.updateProfile);

  const previewW = screenW; // full-bleed preview to match the real card width

  // Seed from any existing scene (local first, then whatever is on the user).
  const initial = useMemo<HeaderScene>(() => {
    const local = getLocalScene(user?.id);
    if (local.items.length > 0 || local.background || (local.drawing?.length ?? 0) > 0) return local;
    return normalizeScene((user as any)?.headerScene);
  }, [user]);

  const [items, setItems] = useState<HeaderItem[]>(initial.items);
  const [background, setBackground] = useState<string | null>(initial.background ?? null);
  const [bgBlend, setBgBlend] = useState<boolean>(!!initial.bgBlend);
  const [strokes, setStrokes] = useState<HeaderDrawStroke[]>(initial.drawing ?? []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [activeGroup, setActiveGroup] = useState('bg');
  const [drawMode, setDrawMode] = useState(false);
  const [drawColor, setDrawColor] = useState(DRAW_COLORS[0]);
  const [drawWidth, setDrawWidth] = useState(4);
  const [eraser, setEraser] = useState(false);

  // Defer the (heavy) library grid mount until the open transition fully
  // finishes. runAfterInteractions can resolve a frame or two before the nav
  // animation visually ends, so we add one rAF to push the mount past it —
  // mounting 14 swatches mid-animation was the open/close FPS drop.
  const [libReady, setLibReady] = useState(false);
  useEffect(() => {
    let raf = 0;
    const h = InteractionManager.runAfterInteractions(() => {
      raf = requestAnimationFrame(() => setLibReady(true));
    });
    return () => { h.cancel(); if (raf) cancelAnimationFrame(raf); };
  }, []);

  // Live drag bookkeeping (px), committed to normalized state on release.
  const dragRef = useRef<{ id: string; startX: number; startY: number } | null>(null);

  const addItem = useCallback((value: string) => {
    triggerHaptic('light');
    setItems((prev) => {
      if (prev.length >= MAX_ITEMS) {
        showToast(t('customize.max_items', `Максимум ${MAX_ITEMS} элементов`), 'alert-circle');
        return prev;
      }
      const it: HeaderItem = {
        id: `i-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        kind: 'emoji', value, x: 0.5, y: 0.4, scale: 1, rotation: 0, anim: 'none',
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

  const respondersRef = useRef<Record<string, any>>({});
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const getResponder = useCallback((item: HeaderItem) => {
    const existing = respondersRef.current[item.id];
    if (existing) return existing;
    const pr = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 2 || Math.abs(g.dy) > 2,
      onPanResponderGrant: () => {
        setSelectedId(item.id);
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

  const onStrokeComplete = useCallback((s: HeaderDrawStroke) => {
    setStrokes((prev) => (prev.length >= 60 ? prev : [...prev, s]));
  }, []);
  const undoStroke = useCallback(() => { triggerHaptic('light'); setStrokes((p) => p.slice(0, -1)); }, []);
  const clearStrokes = useCallback(() => { triggerHaptic('medium'); setStrokes([]); }, []);
  // Eraser: remove the top-most stroke that passes near the tapped point
  // (coords are in the shared 0..100 space). Lets the user delete individual
  // strokes instead of only undo/clear.
  const eraseAt = useCallback((x: number, y: number) => {
    setStrokes((prev) => {
      for (let i = prev.length - 1; i >= 0; i--) {
        const nums = prev[i].d.match(/-?\d+(?:\.\d+)?/g);
        if (!nums) continue;
        const tol = Math.max(5, prev[i].w + 3);
        for (let k = 0; k + 1 < nums.length; k += 2) {
          if (Math.abs(+nums[k] - x) < tol && Math.abs(+nums[k + 1] - y) < tol) {
            const next = prev.slice(); next.splice(i, 1); triggerHaptic('light'); return next;
          }
        }
      }
      return prev;
    });
  }, []);

  const onSave = useCallback(async () => {
    if (!user?.id) { router.back(); return; }
    setSaving(true);
    const scene: HeaderScene = normalizeScene({ version: 1, items, background, bgBlend, drawing: strokes });
    setLocalScene(user.id, scene);
    try { updateLocalUser({ headerScene: scene } as any); } catch {}
    try { await updateRemoteProfile(user.id, { header_scene: scene } as any); } catch {}
    setSaving(false);
    triggerHaptic('light');
    showToast(t('customize.saved', 'Оформление сохранено'), 'check-circle');
    router.back();
  }, [user, items, background, bgBlend, strokes, updateLocalUser]);

  const selected = items.find((it) => it.id === selectedId) || null;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
      {/* Top bar */}
      <View style={{ paddingTop: insets.top + 6, paddingHorizontal: 16, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
          <Feather name="x" size={24} color={theme.colors.text.primary} />
        </Pressable>
        <Text variant="h3" weight="bold">{t('customize.title', 'Оформление')}</Text>
        <Pressable onPress={onSave} disabled={saving} hitSlop={10} style={{ minWidth: 40, height: 40, alignItems: 'flex-end', justifyContent: 'center' }}>
          {saving ? <ActivityIndicator color={theme.colors.accent.primary} /> : <Text variant="body" weight="bold" color={theme.colors.accent.primary}>{t('common.done', 'Готово')}</Text>}
        </Pressable>
      </View>

      {/* Preview — shaped like the header card. Tap empty space to deselect. */}
      <Pressable onPress={() => !drawMode && setSelectedId(null)}>
        <View style={{ width: previewW, height: PREVIEW_H, overflow: 'hidden', backgroundColor: theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)', borderBottomLeftRadius: 30, borderBottomRightRadius: 30 }}>
          {/* Background landscape + saved drawing */}
          <HeaderLandscape backgroundId={background} drawing={strokes} />

          {/* Hint when empty */}
          {items.length === 0 && !background && strokes.length === 0 && !drawMode ? (
            <View style={{ ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 }}>
              <Text variant="body" color={theme.colors.text.tertiary} style={{ textAlign: 'center' }}>
                {t('customize.hint', 'Выбери фон, нарисуй свой или добавь стикеры снизу. Перетаскивай и настраивай.')}
              </Text>
            </View>
          ) : null}

          {items.map((it) => {
            const isSel = it.id === selectedId;
            const size = BASE_ITEM_SIZE * it.scale;
            return (
              <View
                key={it.id}
                {...(drawMode ? {} : getResponder(it).panHandlers)}
                style={{
                  position: 'absolute', left: `${it.x * 100}%`, top: `${it.y * 100}%`,
                  width: size, height: size,
                  transform: [{ translateX: -size / 2 }, { translateY: -size / 2 }],
                  borderWidth: isSel ? 1.5 : 0, borderColor: theme.colors.accent.primary,
                  borderRadius: 8, borderStyle: 'dashed',
                }}
              >
                <StickerGlyph value={it.value} size={size} rotation={it.rotation} anim={it.anim} />
              </View>
            );
          })}

          {/* Drawing surface — on top, captures touches only in draw mode. */}
          {drawMode ? (
            <DrawCanvas width={previewW} height={PREVIEW_H} color={drawColor} strokeWidth={drawWidth} strokes={strokes} onComplete={onStrokeComplete} eraser={eraser} onErase={eraseAt} />
          ) : null}
          {/* Left-side vertical brush-size slider (above the canvas so it works). */}
          {drawMode ? (
            <VSizeSlider value={drawWidth} min={DRAW_MIN_W} max={DRAW_MAX_W} color={eraser ? theme.colors.text.secondary : drawColor} onChange={setDrawWidth} theme={theme} />
          ) : null}
        </View>
      </Pressable>

      {/* ── Contextual controls ───────────────────────────────────────── */}
      {drawMode ? (
        // DRAW controls — a clean panel that fills the space below the preview
        // and anchors its toolbar near the bottom for easy thumb reach.
        <View style={{ flex: 1, justifyContent: 'space-between', paddingTop: 12, paddingBottom: insets.bottom + 12 }}>
          {/* hint */}
          <Text variant="caption" color={theme.colors.text.tertiary} style={{ textAlign: 'center', paddingHorizontal: 24 }}>
            {eraser
              ? t('customize.draw_erase_hint', 'Нажимай по линиям, чтобы стирать.')
              : t('customize.draw_hint', 'Рисуй пальцем по превью сверху.')}
          </Text>

          <View style={{ gap: 14 }}>
            {/* Colour row (scrollable) */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 12, alignItems: 'center' }}>
              {DRAW_COLORS.map((c) => {
                const active = !eraser && drawColor === c;
                return (
                  <Pressable key={c} onPress={() => { triggerHaptic('light'); setEraser(false); setDrawColor(c); }} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: c, borderWidth: active ? 3 : 1, borderColor: active ? theme.colors.accent.primary : 'rgba(127,127,127,0.4)' }} />
                );
              })}
            </ScrollView>

            {/* Actions row (brush size is the left slider on the preview). */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 12 }}>
              {/* Eraser toggle */}
              <Pressable onPress={() => { triggerHaptic('light'); setEraser((e) => !e); }} style={{ width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: eraser ? theme.colors.accent.primary : (theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)') }}>
                <Feather name="delete" size={20} color={eraser ? '#FFFFFF' : theme.colors.text.primary} />
              </Pressable>
              <ToolBtn theme={theme} icon="corner-up-left" onPress={undoStroke} />
              <ToolBtn theme={theme} icon="trash-2" danger onPress={clearStrokes} />
            </View>

            {/* Done */}
            <View style={{ paddingHorizontal: 16 }}>
              <Pressable onPress={() => { triggerHaptic('light'); setEraser(false); setDrawMode(false); }} style={{ height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.accent.primary }}>
                <RNText allowFontScaling={false} style={{ fontSize: 15, fontWeight: '700', color: '#FFFFFF', includeFontPadding: false }}>{t('customize.draw_done', 'Готово')}</RNText>
              </Pressable>
            </View>
          </View>
        </View>
      ) : selected ? (
        // SELECTED-STICKER controls
        <View style={{ paddingVertical: 12, gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            <ToolBtn theme={theme} icon="minus" onPress={() => updateSelected({ scale: Math.max(0.4, +(selected.scale - 0.15).toFixed(2)) })} />
            <ToolBtn theme={theme} icon="plus" onPress={() => updateSelected({ scale: Math.min(4, +(selected.scale + 0.15).toFixed(2)) })} />
            <ToolBtn theme={theme} icon="rotate-ccw" onPress={() => updateSelected({ rotation: (selected.rotation - 15 + 360) % 360 })} />
            <ToolBtn theme={theme} icon="rotate-cw" onPress={() => updateSelected({ rotation: (selected.rotation + 15) % 360 })} />
            <ToolBtn theme={theme} icon="trash-2" danger onPress={deleteSelected} />
          </View>
          {/* Animation picker — horizontally scrollable so every option is reachable. */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 14, gap: 8, alignItems: 'center' }}>
            {ANIM_OPTIONS.map((opt) => (
              <AnimChip key={opt.key} theme={theme} icon={opt.icon} label={t(opt.tKey, opt.label)} active={(selected.anim || 'none') === opt.key} onPress={() => { triggerHaptic('light'); updateSelected({ anim: opt.key }); }} />
            ))}
          </ScrollView>
        </View>
      ) : (
        <View style={{ height: 12 }} />
      )}

      {/* ── Library — group tabs + grids ──────────────────────────────── */}
      {!drawMode ? (
        <View style={{ flex: 1 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, gap: 8, paddingVertical: 6 }} style={{ flexGrow: 0 }}>
            {[{ key: 'bg', label: t('customize.bg', 'Фон') }, ...STICKER_LIBRARY.map((g) => ({ key: g.key, label: g.label }))].map((g) => {
              const active = g.key === activeGroup;
              return (
                <Pressable key={g.key} onPress={() => setActiveGroup(g.key)} style={{ height: 34, paddingHorizontal: 14, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? theme.colors.accent.primary : (theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)') }}>
                  <RNText allowFontScaling={false} style={{ fontSize: 13, fontWeight: '700', includeFontPadding: false, color: active ? '#FFFFFF' : theme.colors.text.secondary }}>{g.label}</RNText>
                </Pressable>
              );
            })}
          </ScrollView>

          {activeGroup === 'bg' ? (
            libReady ? (
              <FlatList
                data={BG_ITEMS}
                keyExtractor={(it) => it.id ?? 'none'}
                numColumns={3}
                showsVerticalScrollIndicator={false}
                initialNumToRender={6}
                maxToRenderPerBatch={6}
                windowSize={5}
                removeClippedSubviews
                columnWrapperStyle={{ paddingHorizontal: 12, gap: 10 }}
                contentContainerStyle={{ paddingBottom: insets.bottom + 16, gap: 10 }}
                ListHeaderComponent={
                  <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 12, marginBottom: 12 }}>
                    <Pressable onPress={() => { triggerHaptic('light'); setSelectedId(null); setDrawMode(true); }} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, height: 44, borderRadius: 14, backgroundColor: theme.colors.accent.primary }}>
                      <Feather name="edit-2" size={16} color="#FFFFFF" />
                      <RNText allowFontScaling={false} style={{ fontSize: 13, fontWeight: '700', color: '#FFFFFF', includeFontPadding: false }}>{t('customize.draw', 'Рисовать свой')}</RNText>
                    </Pressable>
                    <Pressable onPress={() => { triggerHaptic('light'); setBgBlend((b) => !b); }} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, height: 44, borderRadius: 14, backgroundColor: bgBlend ? theme.colors.accent.primary : (theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)') }}>
                      <Feather name="layers" size={16} color={bgBlend ? '#FFFFFF' : theme.colors.text.secondary} />
                      <RNText allowFontScaling={false} style={{ fontSize: 13, fontWeight: '700', includeFontPadding: false, color: bgBlend ? '#FFFFFF' : theme.colors.text.secondary }}>{t('customize.blend', 'Слить с баннером')}</RNText>
                    </Pressable>
                  </View>
                }
                renderItem={({ item }) => {
                  const isSel = background === item.id;
                  return (
                    <Pressable onPress={() => { triggerHaptic('light'); setBackground(item.id); }} style={{ flex: 1 }}>
                      <View style={{ aspectRatio: 1, borderRadius: 16, overflow: 'hidden', borderWidth: isSel ? 3 : 0, borderColor: theme.colors.accent.primary, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)', alignItems: 'center', justifyContent: 'center' }}>
                        {item.id ? (
                          // SAME renderer as the big preview + profile → the swatch
                          // matches the applied result exactly.
                          <HeaderLandscape backgroundId={item.id} />
                        ) : (
                          <Feather name="slash" size={24} color={theme.colors.text.tertiary} />
                        )}
                      </View>
                    </Pressable>
                  );
                }}
              />
            ) : (
              <View style={{ flex: 1 }} />
            )
          ) : (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 10, paddingBottom: insets.bottom + 16, paddingTop: 4 }} keyboardShouldPersistTaps="always">
              {(STICKER_LIBRARY.find((g) => g.key === activeGroup) || STICKER_LIBRARY[0]).items.map((g, i) => (
                <Pressable key={g + i} onPress={() => addItem(g)} style={{ width: '12.5%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center' }}>
                  <RNText allowFontScaling={false} style={{ fontSize: 30 }}>{g}</RNText>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>
      ) : null}
    </View>
  );
}

// Isolated drawing surface: keeps the in-progress stroke in its OWN state so
// the per-move re-renders don't touch the rest of the editor (smooth drawing).
function DrawCanvas({ width, height, color, strokeWidth, strokes, onComplete, eraser, onErase }: {
  width: number; height: number; color: string; strokeWidth: number;
  strokes: HeaderDrawStroke[]; onComplete: (s: HeaderDrawStroke) => void;
  eraser?: boolean; onErase?: (x: number, y: number) => void;
}) {
  const [cur, setCur] = useState('');
  const pathRef = useRef('');
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  const ptsRef = useRef(0);
  const eraserRef = useRef(!!eraser);
  eraserRef.current = !!eraser;
  const to = (v: number, size: number) => Math.max(0, Math.min(100, (v / size) * 100));
  const fmt = (n: number) => n.toFixed(1);
  const MAX_PTS = 240; // hard cap so a single stroke can't bloat the scene
  const MIN_STEP = 0.6; // min normalized distance between captured points
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => {
      const x = to(e.nativeEvent.locationX, width);
      const y = to(e.nativeEvent.locationY, height);
      if (eraserRef.current) { onErase?.(x, y); return; }
      pathRef.current = `M${fmt(x)} ${fmt(y)}`;
      lastRef.current = { x, y };
      ptsRef.current = 1;
      setCur(pathRef.current);
    },
    onPanResponderMove: (e) => {
      const x = to(e.nativeEvent.locationX, width);
      const y = to(e.nativeEvent.locationY, height);
      if (eraserRef.current) { onErase?.(x, y); return; }
      if (ptsRef.current >= MAX_PTS) return;
      const last = lastRef.current;
      // Throttle: skip points that barely moved (keeps the path short + smooth).
      if (last && Math.abs(x - last.x) < MIN_STEP && Math.abs(y - last.y) < MIN_STEP) return;
      pathRef.current += ` L${fmt(x)} ${fmt(y)}`;
      lastRef.current = { x, y };
      ptsRef.current += 1;
      setCur(pathRef.current);
    },
    onPanResponderRelease: () => {
      // Only commit strokes that actually have a line (≥1 L command); the
      // scene normalizer sanitizes again before persisting.
      if (!eraserRef.current && pathRef.current.includes('L')) onComplete({ d: pathRef.current, color, w: strokeWidth });
      pathRef.current = ''; lastRef.current = null; ptsRef.current = 0; setCur('');
    },
    onPanResponderTerminate: () => {
      if (!eraserRef.current && pathRef.current.includes('L')) onComplete({ d: pathRef.current, color, w: strokeWidth });
      pathRef.current = ''; lastRef.current = null; ptsRef.current = 0; setCur('');
    },
  }), [width, height, color, strokeWidth, onComplete, onErase]);

  return (
    <View {...pan.panHandlers} style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
        {strokes.map((s, i) => (
          <Path key={i} d={s.d} stroke={s.color} strokeWidth={s.w} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        ))}
        {cur ? <Path d={cur} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" fill="none" /> : null}
      </Svg>
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

function AnimChip({ theme, icon, label, active, onPress }: { theme: any; icon: any; label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, height: 32, paddingHorizontal: 11, borderRadius: 16, backgroundColor: active ? theme.colors.accent.primary : (theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)') }}>
      <Feather name={icon} size={13} color={active ? '#FFFFFF' : theme.colors.text.secondary} />
      <RNText allowFontScaling={false} style={{ fontSize: 12, includeFontPadding: false, fontWeight: '600', color: active ? '#FFFFFF' : theme.colors.text.secondary }}>{label}</RNText>
    </Pressable>
  );
}

// Vertical brush-size slider pinned to the LEFT of the drawing preview. The top
// of the track = max size, bottom = min. Sits above the canvas so it captures
// touches in its narrow strip without blocking drawing elsewhere.
function VSizeSlider({ value, min, max, color, onChange, theme }: { value: number; min: number; max: number; color: string; onChange: (v: number) => void; theme: any }) {
  const H = Math.round(PREVIEW_H * 0.66);
  const top = Math.round((PREVIEW_H - H) / 2);
  const frac = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const thumb = Math.max(12, Math.min(40, value * 2.2));
  const set = (y: number) => {
    const f = 1 - Math.max(0, Math.min(1, y / H));
    onChange(+(min + f * (max - min)).toFixed(1));
  };
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => set(e.nativeEvent.locationY),
    onPanResponderMove: (e) => set(e.nativeEvent.locationY),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [min, max, H, onChange]);
  return (
    <View {...pan.panHandlers} style={{ position: 'absolute', left: 8, top, width: 44, height: H, alignItems: 'center', justifyContent: 'center' }}>
      {/* track */}
      <View style={{ position: 'absolute', top: 0, bottom: 0, width: 6, borderRadius: 3, backgroundColor: 'rgba(127,127,127,0.45)' }} />
      {/* filled portion (from thumb down) */}
      <View style={{ position: 'absolute', bottom: 0, width: 6, height: `${(1 - frac) * 100}%`, borderRadius: 3, backgroundColor: 'rgba(127,127,127,0.25)' }} />
      {/* thumb — its size previews the brush size */}
      <View style={{ position: 'absolute', top: (1 - frac) * H - thumb / 2, width: thumb, height: thumb, borderRadius: thumb / 2, backgroundColor: color, borderWidth: 2, borderColor: theme.isDark ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.9)' }} />
    </View>
  );
}
