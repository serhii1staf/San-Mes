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
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { useLiquidGlassActive, NativeGlassView } from '../../src/components/ui/LiquidGlass';
import { useT } from '../../src/i18n/store';
import { useAuthStore } from '../../src/store/authStore';
import { updateProfile as updateRemoteProfile } from '../../src/lib/supabase';
import { triggerHaptic } from '../../src/utils/haptics';
import { showToast } from '../../src/store/toastStore';
import { HeaderLandscape } from '../../src/components/profile/HeaderLandscape';
import { StickerGlyph } from '../../src/components/profile/StickerGlyph';
import {
  HeaderScene, HeaderItem, HeaderItemAnim, HeaderDrawStroke, HeaderBrush, BASE_ITEM_SIZE, MAX_ITEMS,
  STICKER_LIBRARY, HEADER_BACKGROUNDS,
  getLocalScene, setLocalScene, normalizeScene, brushLayers,
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

// Brush styles for the draw mode. Labels go through t() with Russian fallbacks.
const BRUSH_OPTIONS: { key: HeaderBrush; icon: any; label: string; tKey: string }[] = [
  { key: 'pen', icon: 'edit-2', label: 'Перо', tKey: 'customize.brush_pen' },
  { key: 'marker', icon: 'edit-3', label: 'Маркер', tKey: 'customize.brush_marker' },
  { key: 'neon', icon: 'zap', label: 'Неон', tKey: 'customize.brush_neon' },
  { key: 'dashed', icon: 'more-horizontal', label: 'Пунктир', tKey: 'customize.brush_dashed' },
];

// Convert an HSL colour to a #RRGGBB hex string (used by the hue picker).
function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp >= 0 && hp < 1) { r = c; g = x; }
  else if (hp < 2) { r = x; g = c; }
  else if (hp < 3) { g = c; b = x; }
  else if (hp < 4) { g = x; b = c; }
  else if (hp < 5) { r = x; b = c; }
  else { r = c; b = x; }
  const m = l - c / 2;
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

// Background swatch list: a "none" tile followed by every scene, PADDED to a
// multiple of 3 with invisible spacers so the last FlatList row never stretches
// a lone item to full width (that was the giant background at the bottom).
const BG_ITEMS: { id: string | null }[] = (() => {
  const list: { id: string | null }[] = [{ id: null }, ...HEADER_BACKGROUNDS.map((b) => ({ id: b.id }))];
  while (list.length % 3 !== 0) list.push({ id: `__pad${list.length}` });
  return list;
})();
const isPad = (id: string | null) => !!id && id.startsWith('__pad');

export default function CustomizeHeaderScreen() {
  const theme = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const { width: screenW } = useWindowDimensions();
  const glassActive = useLiquidGlassActive();
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
  const [redo, setRedo] = useState<HeaderDrawStroke[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [activeGroup, setActiveGroup] = useState('bg');
  const [drawMode, setDrawMode] = useState(false);
  const [drawColor, setDrawColor] = useState(DRAW_COLORS[0]);
  const [drawWidth, setDrawWidth] = useState(4);
  const [eraser, setEraser] = useState(false);
  const [brush, setBrush] = useState<HeaderBrush>('pen');
  const [hue, setHue] = useState(210);

  // Defer the (heavy) library grid mount until the open transition fully
  // finishes. runAfterInteractions can resolve a frame or two before the nav
  // animation visually ends, so we add one rAF to push the mount past it —
  // mounting 14 swatches mid-animation was the open/close FPS drop.
  const [libReady, setLibReady] = useState(false);
  // Second-stage gate: the background swatch grid (24 live HeaderLandscape SVG
  // scenes) is the single most expensive subtree. Mounting it in the SAME frame
  // as the big preview produced one giant synchronous render → the long task
  // that showed up as the 60→40 dip right after the screen opened. Gating the
  // grid one extra frame behind `libReady` splits that work across two frames,
  // so neither frame blows the budget.
  const [gridReady, setGridReady] = useState(false);
  useEffect(() => {
    let raf = 0;
    const h = InteractionManager.runAfterInteractions(() => {
      raf = requestAnimationFrame(() => setLibReady(true));
    });
    return () => { h.cancel(); if (raf) cancelAnimationFrame(raf); };
  }, []);
  useEffect(() => {
    if (!libReady) return;
    const raf = requestAnimationFrame(() => setGridReady(true));
    return () => cancelAnimationFrame(raf);
  }, [libReady]);

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
    setRedo([]); // a new stroke invalidates the redo stack
  }, []);
  const undoStroke = useCallback(() => {
    triggerHaptic('light');
    setStrokes((p) => {
      if (p.length === 0) return p;
      setRedo((r) => [...r, p[p.length - 1]]);
      return p.slice(0, -1);
    });
  }, []);
  const redoStroke = useCallback(() => {
    triggerHaptic('light');
    setRedo((r) => {
      if (r.length === 0) return r;
      const s = r[r.length - 1];
      setStrokes((p) => (p.length >= 60 ? p : [...p, s]));
      return r.slice(0, -1);
    });
  }, []);
  const clearStrokes = useCallback(() => { triggerHaptic('medium'); setStrokes([]); setRedo([]); }, []);
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

  // Subtle tinted-accent surface (≈13% alpha) — used for active/secondary
  // actions so accent reads as an ACCENT, not a wall of solid fills. Derived
  // from the theme token (not a hardcoded brand colour).
  const accentTint = theme.colors.accent.primary + '22';
  const neutralSurface = theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
      {/* Screen title — a full-width overlay anchored to the ROOT view (not the
          padded header row) so it is mathematically centered on the screen,
          independent of the close/save button widths or the row's horizontal
          padding. pointerEvents="none" keeps both buttons fully tappable;
          symmetric horizontal padding clears the side buttons so a long title
          truncates (numberOfLines={1}) instead of overlapping. */}
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: insets.top + 8, height: 34, zIndex: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 84 }}>
        <Text variant="h3" weight="bold" numberOfLines={1} style={{ textAlign: 'center' }}>{t('customize.title', 'Оформление')}</Text>
      </View>

      {/* Top bar — floating ghost close pill + filled accent save pill, no hard
          divider (the rounded preview card below provides the separation). */}
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 14, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={({ pressed }) => ({ width: 34, height: 34, borderRadius: 17, transform: [{ scale: pressed ? 0.92 : 1 }], opacity: glassActive ? 1 : (pressed ? 0.6 : 1) })}>
          {glassActive ? (
            <NativeGlassView glassStyle="regular" isInteractive colorScheme={theme.isDark ? 'dark' : 'light'} style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' }}>
              <Feather name="x" size={20} color={theme.colors.text.primary} />
            </NativeGlassView>
          ) : (
            <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.04)' }}>
              <Feather name="x" size={20} color={theme.colors.text.primary} />
            </View>
          )}
        </Pressable>
        <Pressable onPress={onSave} disabled={saving} hitSlop={10} style={({ pressed }) => ({ minWidth: 64, height: 34, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.accent.primary, opacity: saving ? 0.7 : (pressed ? 0.85 : 1) })}>
          {saving ? <ActivityIndicator color="#FFFFFF" size="small" /> : <RNText allowFontScaling={false} style={{ fontSize: 14, fontWeight: '600', color: '#FFFFFF', includeFontPadding: false }}>{t('common.done', 'Готово')}</RNText>}
        </Pressable>
      </View>

      {/* Preview — shaped like the header card. Tap empty space to deselect. */}
      <Pressable onPress={() => !drawMode && setSelectedId(null)}>
        <View style={{ width: previewW, height: PREVIEW_H, overflow: 'hidden', backgroundColor: theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)', borderBottomLeftRadius: 30, borderBottomRightRadius: 30 }}>
          {/* Background landscape + saved drawing. Deferred behind libReady so
              NO SVG renders during the open transition (that was the 60→40
              drop on open). The in-progress drawing still shows via DrawCanvas. */}
          {libReady ? <HeaderLandscape backgroundId={background} drawing={strokes} /> : null}

          {/* Soft scrims for depth — top fade for the floating chrome, bottom
              fade to seat the card. Behind stickers, never capture touches. */}
          <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0.12)', 'rgba(0,0,0,0)']} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 56 }} />
          <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.14)']} style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 72 }} />

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
            <DrawCanvas width={previewW} height={PREVIEW_H} color={drawColor} strokeWidth={drawWidth} brush={brush} strokes={strokes} onComplete={onStrokeComplete} eraser={eraser} onErase={eraseAt} />
          ) : null}

          {/* Crisp framing ring — sits above everything, never blocks touches. */}
          <View pointerEvents="none" style={{ ...StyleSheet.absoluteFillObject, borderBottomLeftRadius: 30, borderBottomRightRadius: 30, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)' }} />
        </View>
      </Pressable>

      {/* ── Contextual controls ───────────────────────────────────────── */}
      {drawMode ? (
        // DRAW controls — a clean vertical stack of rounded cards BELOW the
        // preview: size slider on top, then brush styles, then colours (hue
        // picker + quick swatches), then tools + done.
        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 16, gap: 12 }}>
          <DrawCard theme={theme}>
            <MiniLabel theme={theme} text={eraser ? t('customize.draw_erase_hint', 'Нажимай по линиям, чтобы стирать.') : t('customize.draw_size', 'Размер кисти')} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <HSizeSlider value={drawWidth} min={DRAW_MIN_W} max={DRAW_MAX_W} color={eraser ? theme.colors.text.secondary : drawColor} onChange={setDrawWidth} theme={theme} />
              <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.022)', borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border.light }}>
                <View style={{ width: Math.max(4, Math.min(34, drawWidth * 2)), height: Math.max(4, Math.min(34, drawWidth * 2)), borderRadius: 17, backgroundColor: eraser ? theme.colors.text.secondary : drawColor }} />
              </View>
              <RNText allowFontScaling={false} style={{ width: 26, textAlign: 'right', fontSize: 13, fontWeight: '500', color: theme.colors.text.secondary, includeFontPadding: false }}>{Math.round(drawWidth)}</RNText>
            </View>
          </DrawCard>

          <DrawCard theme={theme}>
            <MiniLabel theme={theme} text={t('customize.draw_brush', 'Кисть')} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {BRUSH_OPTIONS.map((b) => {
                const active = brush === b.key;
                return (
                  <Pressable key={b.key} onPress={() => { triggerHaptic('light'); setEraser(false); setBrush(b.key); }} style={({ pressed }) => ({ flex: 1, height: 52, borderRadius: 18, alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: active ? accentTint : (pressed ? neutralSurface : 'transparent'), borderWidth: active ? 0 : StyleSheet.hairlineWidth, borderColor: theme.colors.border.light, opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
                    <Feather name={b.icon} size={16} color={active ? theme.colors.accent.primary : theme.colors.text.secondary} />
                    <RNText allowFontScaling={false} style={{ fontSize: 10.5, fontWeight: '500', includeFontPadding: false, color: active ? theme.colors.accent.primary : theme.colors.text.secondary }}>{t(b.tKey, b.label)}</RNText>
                  </Pressable>
                );
              })}
            </View>
          </DrawCard>

          <DrawCard theme={theme}>
            <MiniLabel theme={theme} text={t('customize.draw_all_colors', 'Все цвета')} />
            <HuePicker hue={hue} onChange={(h) => { triggerHaptic('light'); setEraser(false); setHue(h); setDrawColor(hslToHex(h, 0.85, 0.55)); }} theme={theme} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, alignItems: 'center', paddingVertical: 2 }} style={{ marginTop: 12 }}>
              {DRAW_COLORS.map((c) => {
                const active = !eraser && drawColor === c;
                return (
                  <Pressable key={c} onPress={() => { triggerHaptic('light'); setEraser(false); setDrawColor(c); }} style={({ pressed }) => ({ width: 30, height: 30, borderRadius: 15, backgroundColor: c, borderWidth: active ? 2 : StyleSheet.hairlineWidth, borderColor: active ? theme.colors.accent.primary : 'rgba(127,127,127,0.22)', opacity: pressed ? 0.7 : 1, transform: [{ scale: pressed ? 0.9 : 1 }] })} />
                );
              })}
            </ScrollView>
          </DrawCard>

          <DrawCard theme={theme}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
              <Pressable onPress={() => { triggerHaptic('light'); setEraser((e) => !e); }} style={({ pressed }) => ({ width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: eraser ? accentTint : (pressed ? neutralSurface : 'transparent'), borderWidth: StyleSheet.hairlineWidth, borderColor: eraser ? 'transparent' : theme.colors.border.light, opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.94 : 1 }] })}>
                <Feather name="delete" size={18} color={eraser ? theme.colors.accent.primary : theme.colors.text.secondary} />
              </Pressable>
              <ToolBtn theme={theme} glassActive={glassActive} icon="corner-up-left" onPress={undoStroke} />
              <ToolBtn theme={theme} glassActive={glassActive} icon="corner-up-right" onPress={redoStroke} />
              <ToolBtn theme={theme} glassActive={glassActive} icon="trash-2" danger onPress={clearStrokes} />
            </View>
            <Pressable onPress={() => { triggerHaptic('light'); setEraser(false); setDrawMode(false); }} style={({ pressed }) => ({ height: 46, marginTop: 12, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.accent.primary, opacity: pressed ? 0.9 : 1, transform: [{ scale: pressed ? 0.99 : 1 }] })}>
              <RNText allowFontScaling={false} style={{ fontSize: 15, fontWeight: '600', color: '#FFFFFF', includeFontPadding: false }}>{t('customize.draw_done', 'Готово')}</RNText>
            </Pressable>
          </DrawCard>
        </ScrollView>
      ) : selected ? (
        // SELECTED-STICKER controls — grouped in a rounded surface card so it
        // shares the draw controls' visual language.
        <View style={{ paddingHorizontal: 12, paddingTop: 12, paddingBottom: 2 }}>
          <DrawCard theme={theme}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
              <ToolBtn theme={theme} glassActive={glassActive} icon="minus" onPress={() => updateSelected({ scale: Math.max(0.4, +(selected.scale - 0.15).toFixed(2)) })} />
              <ToolBtn theme={theme} glassActive={glassActive} icon="plus" onPress={() => updateSelected({ scale: Math.min(4, +(selected.scale + 0.15).toFixed(2)) })} />
              <ToolBtn theme={theme} glassActive={glassActive} icon="rotate-ccw" onPress={() => updateSelected({ rotation: (selected.rotation - 15 + 360) % 360 })} />
              <ToolBtn theme={theme} glassActive={glassActive} icon="rotate-cw" onPress={() => updateSelected({ rotation: (selected.rotation + 15) % 360 })} />
              <ToolBtn theme={theme} glassActive={glassActive} icon="trash-2" danger onPress={deleteSelected} />
            </View>
            <MiniLabel theme={theme} text={t('customize.anim', 'Анимация')} />
            {/* Animation picker — horizontally scrollable so every option is reachable. */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, alignItems: 'center' }}>
              {ANIM_OPTIONS.map((opt) => (
                <AnimChip key={opt.key} theme={theme} glassActive={glassActive} icon={opt.icon} label={t(opt.tKey, opt.label)} active={(selected.anim || 'none') === opt.key} onPress={() => { triggerHaptic('light'); updateSelected({ anim: opt.key }); }} />
              ))}
            </ScrollView>
          </DrawCard>
        </View>
      ) : (
        <View style={{ height: 10 }} />
      )}

      {/* ── Library — group tabs + grids ──────────────────────────────── */}
      {!drawMode ? (
        <View style={{ flex: 1 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, gap: 8, paddingTop: 8, paddingBottom: 10 }} style={{ flexGrow: 0, marginTop: 0, marginBottom: 14 }}>
            {[{ key: 'bg', label: t('customize.bg', 'Фон') }, ...STICKER_LIBRARY.map((g) => ({ key: g.key, label: g.label }))].map((g) => {
              const active = g.key === activeGroup;
              return (
                <Pressable key={g.key} onPress={() => setActiveGroup(g.key)} style={({ pressed }) => (glassActive
                  ? { height: 36, borderRadius: 18, transform: [{ scale: pressed ? 0.96 : 1 }] }
                  : { height: 36, paddingHorizontal: 16, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? accentTint : neutralSurface, borderWidth: active ? 0 : StyleSheet.hairlineWidth, borderColor: theme.colors.border.light, opacity: pressed ? 0.7 : 1 })}>
                  {glassActive ? (
                    <NativeGlassView glassStyle="regular" isInteractive colorScheme={theme.isDark ? 'dark' : 'light'} tintColor={active ? theme.colors.accent.primary + '33' : undefined} style={{ height: 36, paddingHorizontal: 16, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }}>
                      <RNText allowFontScaling={false} style={{ fontSize: 13.5, fontWeight: '600', includeFontPadding: false, color: active ? theme.colors.accent.primary : theme.colors.text.secondary }}>{g.label}</RNText>
                    </NativeGlassView>
                  ) : (
                    <RNText allowFontScaling={false} style={{ fontSize: 13.5, fontWeight: '600', includeFontPadding: false, color: active ? theme.colors.accent.primary : theme.colors.text.secondary }}>{g.label}</RNText>
                  )}
                </Pressable>
              );
            })}
          </ScrollView>

          {activeGroup === 'bg' ? (
            gridReady ? (
              <FlatList
                data={BG_ITEMS}
                keyExtractor={(it) => it.id ?? 'none'}
                numColumns={3}
                showsVerticalScrollIndicator={false}
                initialNumToRender={3}
                maxToRenderPerBatch={3}
                windowSize={3}
                updateCellsBatchingPeriod={90}
                removeClippedSubviews
                columnWrapperStyle={{ paddingHorizontal: 12, gap: 10 }}
                contentContainerStyle={{ paddingBottom: insets.bottom + 16, gap: 10 }}
                ListHeaderComponent={
                  <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 12, marginTop: 6, marginBottom: 16 }}>
                    <Pressable onPress={() => { triggerHaptic('light'); setSelectedId(null); setDrawMode(true); }} style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, height: 46, borderRadius: 14, backgroundColor: accentTint, opacity: pressed ? 0.7 : 1 })}>
                      <Feather name="edit-2" size={16} color={theme.colors.accent.primary} />
                      <RNText allowFontScaling={false} style={{ fontSize: 13.5, fontWeight: '600', color: theme.colors.accent.primary, includeFontPadding: false }}>{t('customize.draw', 'Рисовать свой')}</RNText>
                    </Pressable>
                    <Pressable onPress={() => { triggerHaptic('light'); setBgBlend((b) => !b); }} style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, height: 46, borderRadius: 14, backgroundColor: bgBlend ? accentTint : neutralSurface, borderWidth: bgBlend ? 0 : StyleSheet.hairlineWidth, borderColor: theme.colors.border.light, opacity: pressed ? 0.7 : 1 })}>
                      <Feather name="layers" size={16} color={bgBlend ? theme.colors.accent.primary : theme.colors.text.secondary} />
                      <RNText allowFontScaling={false} style={{ fontSize: 13.5, fontWeight: '600', includeFontPadding: false, color: bgBlend ? theme.colors.accent.primary : theme.colors.text.secondary }}>{t('customize.blend', 'Слить с баннером')}</RNText>
                    </Pressable>
                  </View>
                }
                renderItem={({ item }) => {
                  if (isPad(item.id)) return <View style={{ flex: 1 }} />;
                  const isSel = background === item.id;
                  return (
                    <Pressable onPress={() => { triggerHaptic('light'); setBackground(item.id); }} style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.8 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
                      <View style={{ aspectRatio: 1, borderRadius: 14, overflow: 'hidden', borderWidth: isSel ? 2 : StyleSheet.hairlineWidth, borderColor: isSel ? theme.colors.accent.primary : theme.colors.border.light, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)', alignItems: 'center', justifyContent: 'center' }}>
                        {item.id ? (
                          <HeaderLandscape backgroundId={item.id} />
                        ) : (
                          <View style={{ alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                            <Feather name="slash" size={24} color={theme.colors.text.tertiary} />
                            <RNText allowFontScaling={false} style={{ fontSize: 11.5, fontWeight: '600', includeFontPadding: false, color: theme.colors.text.tertiary }}>{t('customize.bg_none', 'Без фона')}</RNText>
                          </View>
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
                <Pressable key={g + i} onPress={() => addItem(g)} style={({ pressed }) => ({ width: '12.5%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: pressed ? (theme.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)') : 'transparent' })}>
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
function DrawCanvas({ width, height, color, strokeWidth, brush, strokes, onComplete, eraser, onErase }: {
  width: number; height: number; color: string; strokeWidth: number; brush: HeaderBrush;
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
      if (!eraserRef.current && pathRef.current.includes('L')) onComplete({ d: pathRef.current, color, w: strokeWidth, brush });
      pathRef.current = ''; lastRef.current = null; ptsRef.current = 0; setCur('');
    },
    onPanResponderTerminate: () => {
      if (!eraserRef.current && pathRef.current.includes('L')) onComplete({ d: pathRef.current, color, w: strokeWidth, brush });
      pathRef.current = ''; lastRef.current = null; ptsRef.current = 0; setCur('');
    },
  }), [width, height, color, strokeWidth, brush, onComplete, onErase]);

  return (
    <View {...pan.panHandlers} style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
        {strokes.flatMap((s, i) => brushLayers(s.brush).map((L, li) => (
          <Path key={`${i}-${li}`} d={s.d} stroke={s.color} strokeWidth={s.w * L.widthMul} strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={L.opacity} strokeDasharray={L.dash} />
        )))}
        {cur ? brushLayers(brush).map((L, li) => (
          <Path key={`cur-${li}`} d={cur} stroke={color} strokeWidth={strokeWidth * L.widthMul} strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={L.opacity} strokeDasharray={L.dash} />
        )) : null}
      </Svg>
    </View>
  );
}

function ToolBtn({ theme, icon, onPress, danger, glassActive }: { theme: any; icon: any; onPress: () => void; danger?: boolean; glassActive?: boolean }) {
  if (glassActive) {
    return (
      <Pressable onPress={onPress} hitSlop={8} style={({ pressed }) => ({ width: 42, height: 42, borderRadius: 21, transform: [{ scale: pressed ? 0.94 : 1 }] })}>
        <NativeGlassView glassStyle="regular" isInteractive colorScheme={theme.isDark ? 'dark' : 'light'} style={{ width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' }}>
          <Feather name={icon} size={18} color={danger ? theme.colors.status.error : theme.colors.text.secondary} />
        </NativeGlassView>
      </Pressable>
    );
  }
  return (
    <Pressable onPress={onPress} hitSlop={8} style={({ pressed }) => ({ width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? (theme.isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.045)') : 'transparent', borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border.light, opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.94 : 1 }] })}>
      <Feather name={icon} size={18} color={danger ? theme.colors.status.error : theme.colors.text.secondary} />
    </Pressable>
  );
}

function AnimChip({ theme, glassActive, icon, label, active, onPress }: { theme: any; glassActive?: boolean; icon: any; label: string; active: boolean; onPress: () => void }) {
  const tint = theme.colors.accent.primary + '22';
  const fg = active ? theme.colors.accent.primary : theme.colors.text.secondary;
  // Glass variant — same conditional pattern as the category tab pills: the
  // native glass surface IS the chip background when glass is active, with a
  // soft accent tint marking the selected animation.
  if (glassActive) {
    return (
      <Pressable onPress={onPress} hitSlop={6} style={({ pressed }) => ({ borderRadius: 17, transform: [{ scale: pressed ? 0.96 : 1 }] })}>
        <NativeGlassView glassStyle="regular" isInteractive colorScheme={theme.isDark ? 'dark' : 'light'} tintColor={active ? theme.colors.accent.primary + '33' : undefined} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, height: 34, paddingHorizontal: 14, borderRadius: 17 }}>
          <Feather name={icon} size={13} color={fg} />
          <RNText allowFontScaling={false} style={{ fontSize: 12, includeFontPadding: false, fontWeight: '500', color: fg }}>{label}</RNText>
        </NativeGlassView>
      </Pressable>
    );
  }
  return (
    <Pressable onPress={onPress} hitSlop={6} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 5, height: 34, paddingHorizontal: 13, borderRadius: 17, backgroundColor: active ? tint : (theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'), borderWidth: active ? 0 : StyleSheet.hairlineWidth, borderColor: theme.colors.border.light, opacity: pressed ? 0.7 : 1 })}>
      <Feather name={icon} size={13} color={fg} />
      <RNText allowFontScaling={false} style={{ fontSize: 12, includeFontPadding: false, fontWeight: '500', color: fg }}>{label}</RNText>
    </Pressable>
  );
}

// A subtle rounded surface card used to group the draw controls. Light tint,
// tight padding and a small radius so cards read as clean grouped surfaces
// rather than chunky blocks.
function DrawCard({ theme, children }: { theme: any; children: React.ReactNode }) {
  return (
    <View style={{ borderRadius: 20, padding: 14, gap: 12, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.014)', borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border.light }}>
      {children}
    </View>
  );
}

// Tiny section label in tertiary colour.
function MiniLabel({ theme, text }: { theme: any; text: string }) {
  return (
    <RNText allowFontScaling={false} style={{ fontSize: 11.5, fontWeight: '600', letterSpacing: 0.3, textTransform: 'uppercase', color: theme.colors.text.tertiary, includeFontPadding: false }}>{text}</RNText>
  );
}

// Horizontal brush-size slider. Left = min, right = max. Every inner View is
// pointerEvents="none" so locationX is always measured against the track
// container (same robustness trick as the old vertical slider).
function HSizeSlider({ value, min, max, color, onChange, theme }: { value: number; min: number; max: number; color: string; onChange: (v: number) => void; theme: any }) {
  const [w, setW] = useState(0);
  const frac = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const thumb = Math.max(14, Math.min(30, value * 2));
  const wRef = useRef(0);
  wRef.current = w;
  const set = (x: number) => {
    const W = wRef.current;
    if (W <= 0) return;
    const f = Math.max(0, Math.min(1, x / W));
    onChange(+(min + f * (max - min)).toFixed(1));
  };
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => set(e.nativeEvent.locationX),
    onPanResponderMove: (e) => set(e.nativeEvent.locationX),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [min, max, onChange]);
  return (
    <View
      {...pan.panHandlers}
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      style={{ flex: 1, height: 36, justifyContent: 'center' }}
    >
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, height: 6, borderRadius: 3, backgroundColor: 'rgba(127,127,127,0.3)' }} />
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, width: `${frac * 100}%`, height: 6, borderRadius: 3, backgroundColor: theme.colors.accent.primary }} />
      <View pointerEvents="none" style={{ position: 'absolute', left: frac * w - thumb / 2, width: thumb, height: thumb, borderRadius: thumb / 2, backgroundColor: color, borderWidth: 2, borderColor: theme.isDark ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.95)' }} />
    </View>
  );
}

// Full-spectrum hue picker: a rainbow bar; dragging maps touch x → hue 0..360.
function HuePicker({ hue, onChange, theme }: { hue: number; onChange: (h: number) => void; theme: any }) {
  const [w, setW] = useState(0);
  const wRef = useRef(0);
  wRef.current = w;
  const frac = Math.max(0, Math.min(1, hue / 360));
  const set = (x: number) => {
    const W = wRef.current;
    if (W <= 0) return;
    const f = Math.max(0, Math.min(1, x / W));
    onChange(Math.round(f * 360));
  };
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => set(e.nativeEvent.locationX),
    onPanResponderMove: (e) => set(e.nativeEvent.locationX),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [onChange]);
  const thumbColor = hslToHex(hue, 0.85, 0.55);
  return (
    <View
      {...pan.panHandlers}
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      style={{ height: 28, justifyContent: 'center' }}
    >
      <LinearGradient
        pointerEvents="none"
        colors={['#FF0000', '#FFFF00', '#00FF00', '#00FFFF', '#0000FF', '#FF00FF', '#FF0000']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{ position: 'absolute', left: 0, right: 0, height: 14, borderRadius: 7 }}
      />
      <View pointerEvents="none" style={{ position: 'absolute', left: frac * w - 12, width: 24, height: 24, borderRadius: 12, backgroundColor: thumbColor, borderWidth: 3, borderColor: '#FFFFFF', shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 1, shadowOffset: { width: 0, height: 1 } }} />
    </View>
  );
}
