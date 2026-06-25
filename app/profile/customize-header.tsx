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
import { View, Pressable, ScrollView, Text as RNText, StyleSheet, PanResponder, useWindowDimensions, ActivityIndicator, InteractionManager } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
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

// Freehand drawing palette + brush sizes.
const DRAW_COLORS = ['#FFFFFF', '#000000', '#FF6B6B', '#FFD93D', '#6BCB77', '#4D96FF', '#B388FF', '#FF9F45', '#FF6FB5', '#2EC4B6'];
const DRAW_WIDTHS = [1.5, 3, 5, 8];

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
  const [drawWidth, setDrawWidth] = useState(DRAW_WIDTHS[1]);

  // Defer the (heavy) library grid mount until the open transition finishes so
  // the screen animates in at 60fps.
  const [libReady, setLibReady] = useState(false);
  useEffect(() => {
    const h = InteractionManager.runAfterInteractions(() => setLibReady(true));
    return () => h.cancel();
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
            <DrawCanvas width={previewW} height={PREVIEW_H} color={drawColor} strokeWidth={drawWidth} strokes={strokes} onComplete={onStrokeComplete} />
          ) : null}
        </View>
      </Pressable>

      {/* ── Contextual controls ───────────────────────────────────────── */}
      {drawMode ? (
        // DRAW controls
        <View style={{ paddingVertical: 10, gap: 10 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 14, gap: 10, alignItems: 'center' }}>
            {DRAW_COLORS.map((c) => (
              <Pressable key={c} onPress={() => { triggerHaptic('light'); setDrawColor(c); }} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: c, borderWidth: drawColor === c ? 3 : 1, borderColor: drawColor === c ? theme.colors.accent.primary : 'rgba(127,127,127,0.4)' }} />
            ))}
          </ScrollView>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            {DRAW_WIDTHS.map((w) => (
              <Pressable key={w} onPress={() => { triggerHaptic('light'); setDrawWidth(w); }} style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: drawWidth === w ? theme.colors.accent.primary : (theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)') }}>
                <View style={{ width: w * 2.4, height: w * 2.4, borderRadius: 999, backgroundColor: drawWidth === w ? '#FFFFFF' : theme.colors.text.secondary }} />
              </Pressable>
            ))}
            <ToolBtn theme={theme} icon="corner-up-left" onPress={undoStroke} />
            <ToolBtn theme={theme} icon="trash-2" danger onPress={clearStrokes} />
            <Pressable onPress={() => { triggerHaptic('light'); setDrawMode(false); }} style={{ paddingHorizontal: 16, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.accent.primary }}>
              <RNText allowFontScaling={false} style={{ fontSize: 13, fontWeight: '700', color: '#FFFFFF', includeFontPadding: false }}>{t('common.done', 'Готово')}</RNText>
            </Pressable>
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
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 16, paddingTop: 6 }}>
              {/* Action row: draw your own + blend with banner */}
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

              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-evenly', paddingHorizontal: 8, rowGap: 16 }}>
                {/* "None" swatch */}
                <Pressable onPress={() => { triggerHaptic('light'); setBackground(null); }} style={{ width: 90, alignItems: 'center' }}>
                  <View style={{ width: 90, height: 90, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)', borderWidth: background == null ? 3 : 0, borderColor: theme.colors.accent.primary }}>
                    <Feather name="slash" size={24} color={theme.colors.text.tertiary} />
                  </View>
                  <RNText allowFontScaling={false} style={{ fontSize: 11, includeFontPadding: false, color: theme.colors.text.secondary, marginTop: 5 }}>{t('customize.none', 'Нет')}</RNText>
                </Pressable>
                {libReady ? HEADER_BACKGROUNDS.map((b) => {
                  const isSel = background === b.id;
                  return (
                    <Pressable key={b.id} onPress={() => { triggerHaptic('light'); setBackground(b.id); }} style={{ width: 90, alignItems: 'center' }}>
                      <View style={{ width: 90, height: 90, borderRadius: 18, overflow: 'hidden', borderWidth: isSel ? 3 : 0, borderColor: theme.colors.accent.primary }}>
                        {/* Only the SELECTED swatch renders the full SVG landscape; the
                            rest are cheap gradient thumbnails (keeps the grid at 60fps). */}
                        {isSel ? (
                          <HeaderLandscape backgroundId={b.id} />
                        ) : (
                          <LinearGradient colors={b.colors as any} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={{ width: '100%', height: '100%' }} />
                        )}
                      </View>
                      <RNText allowFontScaling={false} style={{ fontSize: 11, includeFontPadding: false, color: theme.colors.text.secondary, marginTop: 5 }}>{b.label}</RNText>
                    </Pressable>
                  );
                }) : null}
              </View>
            </ScrollView>
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
      ) : (
        <View style={{ flex: 1 }} />
      )}
    </View>
  );
}

// Isolated drawing surface: keeps the in-progress stroke in its OWN state so
// the per-move re-renders don't touch the rest of the editor (smooth drawing).
function DrawCanvas({ width, height, color, strokeWidth, strokes, onComplete }: {
  width: number; height: number; color: string; strokeWidth: number;
  strokes: HeaderDrawStroke[]; onComplete: (s: HeaderDrawStroke) => void;
}) {
  const [cur, setCur] = useState('');
  const pathRef = useRef('');
  const to = (v: number, size: number) => Math.max(0, Math.min(100, (v / size) * 100)).toFixed(1);
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => {
      const { locationX: x, locationY: y } = e.nativeEvent;
      pathRef.current = `M${to(x, width)} ${to(y, height)}`;
      setCur(pathRef.current);
    },
    onPanResponderMove: (e) => {
      const { locationX: x, locationY: y } = e.nativeEvent;
      pathRef.current += ` L${to(x, width)} ${to(y, height)}`;
      setCur(pathRef.current);
    },
    onPanResponderRelease: () => {
      if (pathRef.current.includes('L')) onComplete({ d: pathRef.current, color, w: strokeWidth });
      pathRef.current = ''; setCur('');
    },
    onPanResponderTerminate: () => { pathRef.current = ''; setCur(''); },
  }), [width, height, color, strokeWidth, onComplete]);

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
