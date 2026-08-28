/**
 * Platform design concept — Liquid Glass (iOS) beside Material 3 Expressive (Android).
 *
 * ── WHAT THIS SCREEN IS, AND WHAT IT IS NOT ─────────────────────────────────
 *
 * A CONCEPT, on purpose. It changes nothing about the real bottom navigation or any real button; it
 * renders both materials side by side so the difference can be judged before anything is committed to.
 * The platform switch at the top is the whole point: on one device you can only ever see one of these
 * two philosophies, so it forces the other one to render for comparison.
 *
 * ── THE TWO PHILOSOPHIES, AS THEY ACTUALLY DIFFER ───────────────────────────
 *
 * They are not two colour schemes. They disagree about what a surface IS.
 *
 * iOS Liquid Glass treats a surface as a LENS: it is translucent, it samples and blurs what is behind
 * it, and depth comes from that optical relationship. The app already implements this properly —
 * `NativeGlassView` wraps the real system effect and `useLiquidGlassActive()` gates it on the three
 * conditions that must all hold (OS support, compiled-in design, runtime API), standing down when
 * Reduce Transparency is on.
 *
 * Material 3 Expressive treats a surface as PAPER with a tone. Depth is TONAL ELEVATION — the surface
 * colour shifts through a container ramp rather than casting a shadow or blurring a backdrop. Google
 * documents six dp-based levels expressed mainly as tonal overlays, and a seven-step shape scale.
 *
 * So "blur on Android" is not a cheaper Liquid Glass, it is the wrong idea for the platform: it asks
 * a paper surface to behave like a lens. That is what the note you were given is pointing at, and it
 * is correct.
 *
 * The four expressive traits this screen demonstrates, all from Google's own material:
 *
 *   SHAPE      Corner radius is not a constant. M3 Expressive rounds and sharpens containers to signal
 *              state, and supports shape MORPHING between them. Press any Android button here and
 *              watch the radius change — that is the trait, not a flourish.
 *   CONTAINMENT The selected navigation item sits inside an active-indicator pill. Selection is shown
 *              by a container, not by tinting a glyph.
 *   SIZE       The selected item grows. Emphasis is physical, not only chromatic.
 *   MOTION     Spring physics, not easing curves. M3 Expressive themes motion; the springs here are
 *              deliberately a little loose so the difference from the iOS timing curves is visible.
 *
 * ── DYNAMIC COLOUR IS THE ONE PART THIS CANNOT SHOW HONESTLY ────────────────
 *
 * Real Material You derives the whole palette from the user's wallpaper through HCT, on Android 12+.
 * Reading it needs a native module (`@pchmn/expo-material3-theme` is the usual one) and therefore a
 * NEW NATIVE BUILD — it is not OTA-deliverable. It is not installed here.
 *
 * So the Android side below uses the published M3 BASELINE tokens, which is the documented fallback
 * for devices without dynamic colour anyway. The shapes, containment, sizing and motion are all
 * genuine; only the hues are fixed. Saying so matters, because a demo that implied wallpaper-derived
 * colour already worked would be the misleading part.
 *
 * Compliance: no new permission, no new native module, nothing collected. Pure JS + Reanimated, so it
 * ships over OTA.
 */
import React, { memo, useCallback, useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet, Platform } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Reanimated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { GlassCapsule } from '../../src/components/ui/GlassCapsule';
import { NativeGlassView, useLiquidGlassActive } from '../../src/components/ui/LiquidGlass';
import { useT } from '../../src/i18n/store';

// ── M3 BASELINE TOKENS ───────────────────────────────────────────────────────
//
// The published Material 3 baseline scheme. These are the documented values, not sampled from a
// screenshot — Material publishes its tokens openly, which is why this can be exact rather than
// approximated. On a device with dynamic colour these same ROLES would be filled from the wallpaper;
// the roles are what the components below are written against, so swapping the source later changes
// only this object.
/**
 * The M3 colour ROLES, named explicitly rather than inferred from one of the two schemes.
 *
 * Inferring with `typeof M3_LIGHT` and `as const` narrowed every value to its own string literal, so
 * the dark scheme was not assignable to the light one's type. Naming the roles is also the honest
 * shape of the thing: components are written against roles, which is exactly what lets the SOURCE of
 * the values change later (baseline now, wallpaper-derived when a native build carries the module)
 * without touching a single component.
 */
type M3Scheme = {
  primary: string;
  onPrimary: string;
  primaryContainer: string;
  onPrimaryContainer: string;
  secondaryContainer: string;
  onSecondaryContainer: string;
  surface: string;
  onSurface: string;
  surfaceVariant: string;
  onSurfaceVariant: string;
  surfaceContainerLow: string;
  surfaceContainer: string;
  surfaceContainerHigh: string;
  outline: string;
  outlineVariant: string;
};

const M3_LIGHT: M3Scheme = {
  primary: '#6750A4',
  onPrimary: '#FFFFFF',
  primaryContainer: '#EADDFF',
  onPrimaryContainer: '#21005D',
  secondaryContainer: '#E8DEF8',
  onSecondaryContainer: '#1D192B',
  surface: '#FEF7FF',
  onSurface: '#1D1B20',
  surfaceVariant: '#E7E0EC',
  onSurfaceVariant: '#49454F',
  // The tonal-elevation ramp. THIS is how M3 expresses depth — a container tone, not a shadow.
  surfaceContainerLow: '#F7F2FA',
  surfaceContainer: '#F3EDF7',
  surfaceContainerHigh: '#ECE6F0',
  outline: '#79747E',
  outlineVariant: '#CAC4D0',
};

const M3_DARK: M3Scheme = {
  primary: '#D0BCFF',
  onPrimary: '#381E72',
  primaryContainer: '#4F378B',
  onPrimaryContainer: '#EADDFF',
  secondaryContainer: '#4A4458',
  onSecondaryContainer: '#E8DEF8',
  surface: '#141218',
  onSurface: '#E6E0E9',
  surfaceVariant: '#49454F',
  onSurfaceVariant: '#CAC4D0',
  surfaceContainerLow: '#1D1B20',
  surfaceContainer: '#211F26',
  surfaceContainerHigh: '#2B2930',
  outline: '#938F99',
  outlineVariant: '#49454F',
};

/** M3 Expressive leans on spring physics rather than easing curves. Loose enough to be visible. */
const M3_SPRING = { damping: 15, stiffness: 210, mass: 0.9 } as const;
/** iOS timing, for contrast: a curve, not a spring. */
const IOS_TIMING = { duration: 240 } as const;

type Style = 'ios' | 'android';

const NAV_ITEMS = [
  { icon: 'home-filled', label: 'Home' },
  { icon: 'chat-bubble', label: 'Chats' },
  { icon: 'add-circle', label: 'Create' },
  { icon: 'person', label: 'You' },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// MATERIAL 3 EXPRESSIVE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One expressive navigation item.
 *
 * The active indicator is the signature: a pill CONTAINER appears behind the selected glyph, the glyph
 * lifts slightly, and the label switches weight. Nothing here blurs anything — the bar is a toned
 * surface, so selection has to be expressed by containment.
 */
const M3NavItem = memo(function M3NavItem({
  icon,
  label,
  selected,
  m3,
  onPress,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  selected: boolean;
  m3: M3Scheme;
  onPress: () => void;
}) {
  // One shared value per item, driven on the UI thread. Selection is a spring, which is the
  // documented M3 Expressive motion model.
  const p = useSharedValue(selected ? 1 : 0);
  React.useEffect(() => {
    p.value = withSpring(selected ? 1 : 0, M3_SPRING);
  }, [selected, p]);

  const pillStyle = useAnimatedStyle(() => ({
    opacity: p.value,
    // Grows outward from the glyph rather than fading in place — the container arrives.
    transform: [{ scaleX: interpolate(p.value, [0, 1], [0.5, 1], Extrapolation.CLAMP) }],
  }));

  const glyphStyle = useAnimatedStyle(() => ({
    // SIZE as emphasis: the selected item is physically bigger.
    transform: [
      { scale: interpolate(p.value, [0, 1], [1, 1.08], Extrapolation.CLAMP) },
      { translateY: interpolate(p.value, [0, 1], [0, -1], Extrapolation.CLAMP) },
    ],
  }));

  return (
    <Pressable onPress={onPress} style={styles.m3NavItem} accessibilityRole="tab">
      <View style={styles.m3IndicatorWrap}>
        <Reanimated.View
          style={[
            styles.m3Indicator,
            { backgroundColor: m3.secondaryContainer },
            pillStyle,
          ]}
        />
        <Reanimated.View style={glyphStyle}>
          <MaterialIcons
            name={icon}
            size={24}
            color={selected ? m3.onSecondaryContainer : m3.onSurfaceVariant}
          />
        </Reanimated.View>
      </View>
      <Text
        variant="caption"
        weight={selected ? 'semibold' : 'regular'}
        color={selected ? m3.onSurface : m3.onSurfaceVariant}
        style={styles.m3NavLabel}
      >
        {label}
      </Text>
    </Pressable>
  );
});

/**
 * Expressive button. The point of this component is the SHAPE MORPH: press it and the corner radius
 * travels from a full pill to a much squarer container, then springs back.
 *
 * Google describes exactly this — rounding and sharpening corner radius to support shape morphing
 * button states. It is the trait that most distinguishes M3 Expressive from M3, and it is the one
 * thing a static screenshot of Material cannot show you.
 */
const M3Button = memo(function M3Button({
  label,
  icon,
  variant,
  m3,
}: {
  label: string;
  icon?: keyof typeof MaterialIcons.glyphMap;
  variant: 'filled' | 'tonal' | 'outlined' | 'text';
  m3: M3Scheme;
}) {
  const pressed = useSharedValue(0);

  const morph = useAnimatedStyle(() => ({
    // 20 -> 8: pill to squarish. The whole gesture is on the UI thread, so it holds up under load.
    borderRadius: interpolate(pressed.value, [0, 1], [20, 8], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(pressed.value, [0, 1], [1, 0.97], Extrapolation.CLAMP) }],
  }));

  const bg =
    variant === 'filled' ? m3.primary
    : variant === 'tonal' ? m3.secondaryContainer
    : 'transparent';
  const fg =
    variant === 'filled' ? m3.onPrimary
    : variant === 'tonal' ? m3.onSecondaryContainer
    : m3.primary;

  return (
    <Pressable
      onPressIn={() => { pressed.value = withSpring(1, M3_SPRING); }}
      onPressOut={() => { pressed.value = withSpring(0, M3_SPRING); }}
      accessibilityRole="button"
    >
      <Reanimated.View
        style={[
          styles.m3Button,
          {
            backgroundColor: bg,
            borderWidth: variant === 'outlined' ? 1 : 0,
            borderColor: m3.outline,
            paddingHorizontal: variant === 'text' ? 12 : 24,
          },
          morph,
        ]}
      >
        {icon ? <MaterialIcons name={icon} size={18} color={fg} style={styles.m3BtnIcon} /> : null}
        <Text variant="body" weight="semibold" color={fg}>{label}</Text>
      </Reanimated.View>
    </Pressable>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// iOS LIQUID GLASS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The iOS side reuses the app's REAL glass components rather than imitating them, so what you see is
 * what the app actually renders. `useLiquidGlassActive()` decides whether the true system effect is
 * available; `GlassCapsule` is the BlurView fallback everywhere else. On an Android device this side
 * will therefore show the fallback — which is itself informative, since that fallback is precisely
 * what the note you were given argues should be replaced by Material.
 */
const GlassShell = memo(function GlassShell({
  isDark,
  radius,
  style,
  children,
}: {
  isDark: boolean;
  radius: number;
  style?: any;
  children: React.ReactNode;
}) {
  const liquid = useLiquidGlassActive();
  if (liquid) {
    return (
      <NativeGlassView
        style={[style, { borderRadius: radius, overflow: 'hidden' }]}
        glassStyle="regular"
        colorScheme={isDark ? 'dark' : 'light'}
      >
        {children}
      </NativeGlassView>
    );
  }
  return (
    <GlassCapsule borderRadius={radius} isDark={isDark} style={style} pointerEvents="box-none">
      {children}
    </GlassCapsule>
  );
});

const IOSNavItem = memo(function IOSNavItem({
  icon,
  label,
  selected,
  accent,
  dim,
  onPress,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  selected: boolean;
  accent: string;
  dim: string;
  onPress: () => void;
}) {
  const p = useSharedValue(selected ? 1 : 0);
  React.useEffect(() => {
    // A timing curve, not a spring — the contrast with the Android side is deliberate.
    p.value = withTiming(selected ? 1 : 0, IOS_TIMING);
  }, [selected, p]);

  const s = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0, 1], [0.55, 1], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(p.value, [0, 1], [1, 1.04], Extrapolation.CLAMP) }],
  }));

  return (
    <Pressable onPress={onPress} style={styles.iosNavItem} accessibilityRole="tab">
      <Reanimated.View style={[styles.iosNavInner, s]}>
        {/* No container. Selection is chromatic — the glyph and label take the accent, and depth
            comes from the glass behind the whole bar rather than from a per-item surface. */}
        <MaterialIcons name={icon} size={23} color={selected ? accent : dim} />
        <Text variant="caption" color={selected ? accent : dim} style={styles.iosNavLabel}>
          {label}
        </Text>
      </Reanimated.View>
    </Pressable>
  );
});

// ─────────────────────────────────────────────────────────────────────────────

export default function PlatformDesignConceptScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  // Defaults to whatever the device is, so the first thing shown is the relevant one.
  const [style, setStyle] = useState<Style>(Platform.OS === 'android' ? 'android' : 'ios');
  const [navIndex, setNavIndex] = useState(0);
  const m3 = theme.isDark ? M3_DARK : M3_LIGHT;
  const isAndroid = style === 'android';

  const onNav = useCallback((i: number) => setNavIndex(i), []);

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background.primary }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button">
          <MaterialIcons name="chevron-left" size={26} color={theme.colors.text.primary} />
        </Pressable>
        <Text variant="subheading" weight="bold" style={styles.headerTitle}>
          {t('design_lab.title', 'Материал платформы')}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 64 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Segmented switch. The reason this screen exists: one device shows one philosophy. */}
        <View style={[styles.segment, { backgroundColor: theme.colors.background.elevated }]}>
          {(['ios', 'android'] as const).map((s) => {
            const active = style === s;
            return (
              <Pressable
                key={s}
                onPress={() => setStyle(s)}
                style={[
                  styles.segmentBtn,
                  active && { backgroundColor: active && s === 'android' ? m3.primary : theme.colors.accent.primary },
                ]}
                accessibilityRole="button"
              >
                <Text
                  variant="caption"
                  weight="semibold"
                  color={active ? (s === 'android' ? m3.onPrimary : '#FFFFFF') : theme.colors.text.secondary}
                >
                  {s === 'ios' ? 'iOS · Liquid Glass' : 'Android · Material 3'}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text variant="caption" color={theme.colors.text.tertiary} style={styles.note}>
          {isAndroid
            ? t(
                'design_lab.note.android',
                'Поверхность — это тонированная бумага. Глубина задаётся тоном контейнера, а не размытием фона. Выбор показан контейнером-пилюлей, нажатие меняет радиус скругления, моторика пружинная.',
              )
            : t(
                'design_lab.note.ios',
                'Поверхность — это линза. Она пропускает и размывает то, что за ней, глубина возникает из этой оптики. Выбор показан цветом, а не контейнером; движение — кривая, а не пружина.',
              )}
        </Text>

        {/* ── Bottom navigation ─────────────────────────────────────────────── */}
        <Text variant="body" weight="semibold" color={theme.colors.text.secondary} style={styles.sectionTitle}>
          {t('design_lab.section.nav', 'Нижняя навигация')}
        </Text>

        {isAndroid ? (
          <View
            style={[
              styles.m3NavBar,
              {
                // Tonal elevation: a container tone, no shadow, no blur.
                backgroundColor: m3.surfaceContainer,
                borderColor: m3.outlineVariant,
              },
            ]}
          >
            {NAV_ITEMS.map((it, i) => (
              <M3NavItem
                key={it.label}
                icon={it.icon as keyof typeof MaterialIcons.glyphMap}
                label={it.label}
                selected={navIndex === i}
                m3={m3}
                onPress={() => onNav(i)}
              />
            ))}
          </View>
        ) : (
          <GlassShell isDark={theme.isDark} radius={28} style={styles.iosNavBar}>
            {NAV_ITEMS.map((it, i) => (
              <IOSNavItem
                key={it.label}
                icon={it.icon as keyof typeof MaterialIcons.glyphMap}
                label={it.label}
                selected={navIndex === i}
                accent={theme.colors.accent.primary}
                dim={theme.colors.text.tertiary}
                onPress={() => onNav(i)}
              />
            ))}
          </GlassShell>
        )}

        {/* ── Buttons ───────────────────────────────────────────────────────── */}
        <Text variant="body" weight="semibold" color={theme.colors.text.secondary} style={styles.sectionTitle}>
          {t('design_lab.section.buttons', 'Кнопки')}
        </Text>
        <Text variant="caption" color={theme.colors.text.tertiary} style={styles.note}>
          {isAndroid
            ? t('design_lab.note.morph', 'Нажми и подержи: радиус скругления уезжает от пилюли к почти квадрату и пружиной возвращается. Это и есть shape morphing — главный признак Expressive, который нельзя увидеть на скриншоте.')
            : t('design_lab.note.iosbtn', 'Капсула из стекла: форма постоянна, отклик — изменение прозрачности и лёгкий масштаб.')}
        </Text>

        <View style={styles.btnRow}>
          {isAndroid ? (
            <>
              <M3Button label="Filled" icon="send" variant="filled" m3={m3} />
              <M3Button label="Tonal" variant="tonal" m3={m3} />
            </>
          ) : (
            <>
              <IOSButton label="Отправить" icon="send" filled isDark={theme.isDark} accent={theme.colors.accent.primary} />
              <IOSButton label="Ещё" isDark={theme.isDark} accent={theme.colors.accent.primary} />
            </>
          )}
        </View>
        <View style={styles.btnRow}>
          {isAndroid ? (
            <>
              <M3Button label="Outlined" variant="outlined" m3={m3} />
              <M3Button label="Text" variant="text" m3={m3} />
            </>
          ) : (
            <IOSButton label="Прозрачная" isDark={theme.isDark} accent={theme.colors.accent.primary} />
          )}
        </View>

        {/* ── Elevation / depth ─────────────────────────────────────────────── */}
        <Text variant="body" weight="semibold" color={theme.colors.text.secondary} style={styles.sectionTitle}>
          {t('design_lab.section.depth', 'Глубина')}
        </Text>
        {isAndroid ? (
          <View style={styles.depthRow}>
            {([
              ['Low', m3.surfaceContainerLow],
              ['Base', m3.surfaceContainer],
              ['High', m3.surfaceContainerHigh],
            ] as const).map(([label, bg]) => (
              <View key={label} style={[styles.depthTile, { backgroundColor: bg, borderColor: m3.outlineVariant }]}>
                <Text variant="caption" color={m3.onSurfaceVariant}>{label}</Text>
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.depthRow}>
            {[18, 22, 26].map((r) => (
              <GlassShell key={r} isDark={theme.isDark} radius={r} style={styles.depthGlass}>
                <View style={styles.depthGlassInner}>
                  <Text variant="caption" color={theme.colors.text.secondary}>{`r${r}`}</Text>
                </View>
              </GlassShell>
            ))}
          </View>
        )}
        <Text variant="caption" color={theme.colors.text.tertiary} style={styles.note}>
          {isAndroid
            ? t('design_lab.note.tonal', 'Три уровня — это три тона одной поверхности. Тени нет вообще: в M3 глубина тональная.')
            : t('design_lab.note.lens', 'Глубина берётся из того, что за поверхностью. Уровни различаются радиусом и материалом, а не тоном.')}
        </Text>

        {/* Honest limitation, stated in the UI and not only in the code. */}
        <View style={[styles.limitCard, { backgroundColor: theme.colors.background.elevated }]}>
          <MaterialIcons name="info-outline" size={18} color={theme.colors.text.tertiary} />
          <Text variant="caption" color={theme.colors.text.tertiary} style={styles.limitText}>
            {t(
              'design_lab.limit',
              'Цвета на стороне Android — это базовая палитра Material 3. Настоящий Material You выводит палитру из обоев устройства (Android 12+), для чего нужен нативный модуль и новая сборка — по OTA это не доставляется. Формы, контейнеры, размеры и моторика здесь настоящие, зафиксированы только оттенки.',
            )}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

/** iOS button, built on the app's real glass so the comparison is not against an imitation. */
const IOSButton = memo(function IOSButton({
  label,
  icon,
  filled,
  isDark,
  accent,
}: {
  label: string;
  icon?: keyof typeof MaterialIcons.glyphMap;
  filled?: boolean;
  isDark: boolean;
  accent: string;
}) {
  const pressed = useSharedValue(0);
  const s = useAnimatedStyle(() => ({
    // Constant shape. Depth response is opacity and a slight scale — the surface does not reshape.
    opacity: interpolate(pressed.value, [0, 1], [1, 0.72], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(pressed.value, [0, 1], [1, 0.98], Extrapolation.CLAMP) }],
  }));
  return (
    <Pressable
      onPressIn={() => { pressed.value = withTiming(1, { duration: 120 }); }}
      onPressOut={() => { pressed.value = withTiming(0, IOS_TIMING); }}
      accessibilityRole="button"
    >
      <Reanimated.View style={s}>
        {filled ? (
          <View style={[styles.iosBtn, { backgroundColor: accent }]}>
            {icon ? <MaterialIcons name={icon} size={18} color="#FFFFFF" style={styles.m3BtnIcon} /> : null}
            <Text variant="body" weight="semibold" color="#FFFFFF">{label}</Text>
          </View>
        ) : (
          <GlassShell isDark={isDark} radius={22} style={styles.iosBtnGlassWrap}>
            <View style={styles.iosBtn}>
              {icon ? <MaterialIcons name={icon} size={18} color={accent} style={styles.m3BtnIcon} /> : null}
              <Text variant="body" weight="semibold" color={accent}>{label}</Text>
            </View>
          </GlassShell>
        )}
      </Reanimated.View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 8 },
  headerTitle: { flex: 1, textAlign: 'center', marginRight: 32 },
  scroll: { paddingHorizontal: 16, paddingTop: 4 },
  segment: { flexDirection: 'row', borderRadius: 14, padding: 4, gap: 4, marginBottom: 12 },
  segmentBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 9, borderRadius: 11 },
  sectionTitle: { marginTop: 20, marginBottom: 8, paddingHorizontal: 2 },
  note: { marginBottom: 12, paddingHorizontal: 2, lineHeight: 18 },

  // M3 navigation. Height 64 rather than 80: the expressive style is documented as shorter.
  m3NavBar: {
    flexDirection: 'row',
    height: 64,
    alignItems: 'center',
    borderRadius: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 4,
  },
  m3NavItem: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  m3IndicatorWrap: { width: 64, height: 32, alignItems: 'center', justifyContent: 'center' },
  m3Indicator: { position: 'absolute', width: 64, height: 32, borderRadius: 16 },
  m3NavLabel: { fontSize: 11 },

  m3Button: { flexDirection: 'row', alignItems: 'center', height: 44, justifyContent: 'center' },
  m3BtnIcon: { marginRight: 8 },

  iosNavBar: { flexDirection: 'row', height: 64, alignItems: 'center', overflow: 'hidden' },
  iosNavItem: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  iosNavInner: { alignItems: 'center', gap: 2 },
  iosNavLabel: { fontSize: 11 },

  iosBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 44, paddingHorizontal: 22, borderRadius: 22 },
  iosBtnGlassWrap: { height: 44 },

  btnRow: { flexDirection: 'row', gap: 10, marginBottom: 10, flexWrap: 'wrap' },

  depthRow: { flexDirection: 'row', gap: 10 },
  depthTile: { flex: 1, height: 72, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  depthGlass: { flex: 1, height: 72 },
  depthGlassInner: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  limitCard: { flexDirection: 'row', gap: 10, padding: 14, borderRadius: 16, marginTop: 24, alignItems: 'flex-start' },
  limitText: { flex: 1, lineHeight: 18 },
});
