// Settings → Lab.
//
// A "playground" screen for trying out new React Native libraries before we
// commit to shipping them in production. Each section demonstrates one
// effect/lib so the user can poke at it on a real device. Kept lightweight
// on purpose: only the moti shimmer is a continuous animation, everything
// else is one-shot or driven by user input.
//
// Currently shown:
//   1. moti       — JS-only animations on top of Reanimated (already a dep).
//   2. @gorhom/bottom-sheet v5 — best-in-class bottom sheet on top of
//      reanimated + gesture-handler. Provider is mounted at the app root in
//      `app/_layout.tsx`.
//   3. expo-glass-effect — Apple's native iOS 26+ Liquid Glass material.
//      Native module → only renders properly after a fresh dev-client /
//      App Store build. Wrapped in a guarded require + runtime-availability
//      check so a binary lacking the native side never crashes the screen
//      (mirror of `NavigationBarController`'s pattern).

import React, { useCallback, useMemo, useRef } from 'react';
import {
  View,
  ScrollView,
  Pressable,
  StyleSheet,
  ViewStyle,
  Platform,
  AccessibilityInfo,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { MotiView } from 'moti';
import {
  BottomSheetModal,
  BottomSheetView,
  BottomSheetBackdrop,
} from '@gorhom/bottom-sheet';
import type { BottomSheetBackdropProps } from '@gorhom/bottom-sheet';

import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { useT } from '../../src/i18n/store';
import { triggerHaptic } from '../../src/utils/haptics';

// ─── Guarded native module load ────────────────────────────────────────────
// expo-glass-effect ships a native module that the running dev-client / IPA
// binary may NOT yet contain (we just installed the dep — the JS bundle
// references it before the matching binary is rebuilt). A top-level static
// import would throw at module-eval time and take the whole screen down.
// The pattern mirrors `src/components/system/NavigationBarController.tsx`.

let GlassView: React.ComponentType<any> | null = null;
let isLiquidGlassAvailable: (() => boolean) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('expo-glass-effect');
  GlassView = mod?.GlassView ?? null;
  isLiquidGlassAvailable = typeof mod?.isLiquidGlassAvailable === 'function' ? mod.isLiquidGlassAvailable : null;
} catch {
  GlassView = null;
  isLiquidGlassAvailable = null;
}

// Runtime availability — true only when:
//   - we're on iOS,
//   - the native module loaded above (not stripped from the binary), and
//   - the lib reports the OS supports the API (iOS 26+).
function getGlassAvailable(): boolean {
  if (Platform.OS !== 'ios') return false;
  if (!GlassView) return false;
  try {
    return isLiquidGlassAvailable ? !!isLiquidGlassAvailable() : false;
  } catch {
    return false;
  }
}

export default function LabScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();

  const containerStyle: ViewStyle = {
    flex: 1,
    backgroundColor: theme.colors.background.primary,
  };

  const bgColor = theme.colors.background.primary;
  const bgTransparent = theme.colors.background.primary + '00';
  const headerContentHeight = insets.top + 48;
  const headerGradientHeight = headerContentHeight + 28;

  const sectionCardStyle: ViewStyle = {
    backgroundColor: theme.colors.background.elevated,
    borderRadius: 24,
    marginBottom: 20,
    padding: 16,
    overflow: 'hidden',
  };

  const sectionTitleStyle: ViewStyle = {
    marginBottom: 8,
    paddingHorizontal: 4,
  };

  // ─── Bottom sheet ────────────────────────────────────────────────────────
  const sheetRef = useRef<BottomSheetModal>(null);
  const snapPoints = useMemo(() => ['25%', '60%'], []);
  const openSheet = useCallback(() => {
    triggerHaptic('light');
    sheetRef.current?.present();
  }, []);
  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.4}
      />
    ),
    [],
  );

  // ─── Glass section ───────────────────────────────────────────────────────
  const glassAvailable = getGlassAvailable();

  return (
    <View style={containerStyle}>
      {/* Standard gradient-fade header — same pattern as the rest of /settings */}
      <View
        style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100, height: headerGradientHeight }}
        pointerEvents="box-none"
      >
        <LinearGradient
          colors={[bgColor, bgColor, bgTransparent]}
          locations={[0, 0.55, 1]}
          style={StyleSheet.absoluteFill}
        />
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: theme.spacing.lg,
            paddingTop: insets.top + 8,
            paddingBottom: 8,
            position: 'relative',
          }}
          pointerEvents="auto"
        >
          <Pressable
            onPress={() => router.back()}
            style={{ position: 'absolute', left: theme.spacing.lg, top: insets.top + 8 }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
          >
            <Feather name="chevron-left" size={24} color={theme.colors.text.primary} />
          </Pressable>
          <Text variant="subheading" weight="bold">{t('settings.lab.title')}</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingBottom: 100,
          paddingHorizontal: theme.spacing.lg,
          paddingTop: headerContentHeight,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Intro */}
        <Text
          variant="body"
          color={theme.colors.text.secondary}
          style={{ marginTop: 4, marginBottom: 20, lineHeight: 22 }}
        >
          {t('settings.lab.intro')}
        </Text>

        {/* ─── 1. Moti animations ───────────────────────────────────────── */}
        <View style={sectionTitleStyle}>
          <Text variant="body" weight="semibold" color={theme.colors.text.secondary}>
            {t('settings.lab.section.moti.title')}
          </Text>
        </View>
        <View style={sectionCardStyle}>
          <MotiBouncePill label={t('settings.lab.section.moti.bounce')} />
          <View style={{ height: 14 }} />
          <MotiFadeSlideCard label={t('settings.lab.section.moti.fade_in')} />
          <View style={{ height: 14 }} />
          <MotiSkeleton label={t('settings.lab.section.moti.skeleton')} />
        </View>

        {/* ─── 2. Bottom sheet ──────────────────────────────────────────── */}
        <View style={sectionTitleStyle}>
          <Text variant="body" weight="semibold" color={theme.colors.text.secondary}>
            {t('settings.lab.section.sheet.title')}
          </Text>
        </View>
        <View style={sectionCardStyle}>
          <Pressable
            onPress={openSheet}
            style={{
              paddingVertical: 14,
              alignItems: 'center',
              backgroundColor: theme.colors.accent.primary,
              borderRadius: 14,
            }}
            accessibilityRole="button"
            accessibilityLabel={t('settings.lab.section.sheet.open')}
          >
            <Text variant="body" weight="semibold" color="#FFFFFF">
              {t('settings.lab.section.sheet.open')}
            </Text>
          </Pressable>
        </View>

        {/* ─── 3. Liquid Glass (iOS 26+) ────────────────────────────────── */}
        <View style={sectionTitleStyle}>
          <Text variant="body" weight="semibold" color={theme.colors.text.secondary}>
            {t('settings.lab.section.glass.title')}
          </Text>
        </View>
        <View style={sectionCardStyle}>
          <GlassDemo
            available={glassAvailable}
            fallbackLabel={t('settings.lab.section.glass.fallback')}
          />
        </View>
      </ScrollView>

      {/* Bottom sheet modal — content is intentionally tiny; this is a demo. */}
      <BottomSheetModal
        ref={sheetRef}
        snapPoints={snapPoints}
        enablePanDownToClose
        backdropComponent={renderBackdrop}
        backgroundStyle={{ backgroundColor: theme.colors.background.elevated }}
        handleIndicatorStyle={{ backgroundColor: theme.colors.text.tertiary }}
      >
        <BottomSheetView style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 28 }}>
          <Text variant="subheading" weight="bold" style={{ marginBottom: 12 }}>
            {t('settings.lab.section.sheet.title')}
          </Text>
          <Text variant="body" color={theme.colors.text.secondary} style={{ marginBottom: 16, lineHeight: 22 }}>
            {t('settings.lab.section.sheet.body')}
          </Text>
          <SheetRow icon="zap" label="Reanimated" tint={theme.colors.accent.primary} />
          <SheetRow icon="layers" label="Gesture Handler" tint={theme.colors.accent.primary} />
          <SheetRow icon="check-circle" label="Snap points: 25%, 60%" tint={theme.colors.accent.primary} />
        </BottomSheetView>
      </BottomSheetModal>
    </View>
  );
}

// ─── Moti demos ────────────────────────────────────────────────────────────

function MotiBouncePill({ label }: { label: string }) {
  const theme = useTheme();
  // Toggle a key on every press so the spring re-runs from 1 → 1.15 → 1.
  // Using `from` + `animate` with a spring transition gives us the bounce
  // entirely on the UI thread (Reanimated worklet under the hood).
  const [tick, setTick] = React.useState(0);
  const reduceMotion = useReduceMotion();

  return (
    <Pressable
      onPress={() => {
        triggerHaptic('light');
        setTick((n) => n + 1);
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <MotiView
        // Force a remount of the animation by changing the key on every tap.
        key={tick}
        from={{ scale: 1 }}
        animate={{ scale: reduceMotion ? 1 : 1.12 }}
        transition={{
          type: 'spring',
          damping: 8,
          stiffness: 220,
          mass: 0.6,
        }}
        style={{
          paddingVertical: 14,
          paddingHorizontal: 20,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.colors.background.secondary,
          borderRadius: 999,
        }}
      >
        <Text variant="body" weight="semibold">{label}</Text>
      </MotiView>
    </Pressable>
  );
}

function MotiFadeSlideCard({ label }: { label: string }) {
  const theme = useTheme();
  const reduceMotion = useReduceMotion();
  return (
    <MotiView
      from={{ opacity: 0, translateY: reduceMotion ? 0 : 16 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{
        type: 'timing',
        duration: 380,
        // Stagger so it's clearly mount-driven and not a flat fade.
        delay: 80,
      }}
      style={{
        padding: 16,
        backgroundColor: theme.colors.background.secondary,
        borderRadius: 14,
      }}
    >
      <Text variant="body" weight="semibold" style={{ marginBottom: 4 }}>{label}</Text>
      <Text variant="caption" color={theme.colors.text.tertiary}>
        opacity 0 → 1, translateY 16 → 0
      </Text>
    </MotiView>
  );
}

function MotiSkeleton({ label }: { label: string }) {
  const theme = useTheme();
  const reduceMotion = useReduceMotion();
  return (
    <View>
      <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginBottom: 6 }}>
        {label}
      </Text>
      <MotiView
        from={{ opacity: 0.4 }}
        animate={{ opacity: reduceMotion ? 0.4 : 1.0 }}
        transition={{
          type: 'timing',
          duration: 900,
          loop: !reduceMotion,
        }}
        style={{
          height: 18,
          borderRadius: 6,
          backgroundColor: theme.colors.background.secondary,
        }}
      />
    </View>
  );
}

// ─── Bottom sheet row ──────────────────────────────────────────────────────

function SheetRow({ icon, label, tint }: { icon: keyof typeof Feather.glyphMap; label: string; tint: string }) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.border.light,
      }}
    >
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: 8,
          backgroundColor: tint + '22',
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: 12,
        }}
      >
        <Feather name={icon} size={15} color={tint} />
      </View>
      <Text variant="body">{label}</Text>
    </View>
  );
}

// ─── Glass demo ────────────────────────────────────────────────────────────

function GlassDemo({ available, fallbackLabel }: { available: boolean; fallbackLabel: string }) {
  const theme = useTheme();
  const t = useT();

  // Colourful gradient backdrop so the glass material has something
  // visually rich to refract over.
  const Backdrop = (
    <LinearGradient
      colors={['#FF6B9D', '#A855F7', '#3B82F6', '#10B981']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={StyleSheet.absoluteFill}
    />
  );

  if (available && GlassView) {
    return (
      <View style={{ borderRadius: 18, overflow: 'hidden', height: 140 }}>
        {Backdrop}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <GlassView
            glassEffectStyle="regular"
            isInteractive
            style={{
              paddingVertical: 14,
              paddingHorizontal: 22,
              borderRadius: 22,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <Feather name="droplet" size={18} color="#FFFFFF" />
            <Text variant="body" weight="semibold" color="#FFFFFF">
              {t('settings.lab.section.glass.title')}
            </Text>
            <Feather name="zap" size={16} color="#FFFFFF" />
          </GlassView>
        </View>
      </View>
    );
  }

  // Fallback: BlurView pill on iOS, flat translucent fill on Android — same
  // pattern we use elsewhere where blur is too expensive on weak hardware.
  return (
    <View style={{ borderRadius: 18, overflow: 'hidden', height: 140 }}>
      {Backdrop}
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        {Platform.OS === 'ios' ? (
          <BlurView
            intensity={60}
            tint={theme.isDark ? 'dark' : 'light'}
            style={{
              paddingVertical: 14,
              paddingHorizontal: 22,
              borderRadius: 22,
              overflow: 'hidden',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <Feather name="droplet" size={18} color="#FFFFFF" />
            <Text variant="body" weight="semibold" color="#FFFFFF">
              {t('settings.lab.section.glass.title')}
            </Text>
            <Feather name="zap" size={16} color="#FFFFFF" />
          </BlurView>
        ) : (
          <View
            style={{
              paddingVertical: 14,
              paddingHorizontal: 22,
              borderRadius: 22,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              backgroundColor: 'rgba(255,255,255,0.18)',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.3)',
            }}
          >
            <Feather name="droplet" size={18} color="#FFFFFF" />
            <Text variant="body" weight="semibold" color="#FFFFFF">
              {t('settings.lab.section.glass.title')}
            </Text>
            <Feather name="zap" size={16} color="#FFFFFF" />
          </View>
        )}
      </View>
      <View
        style={{
          position: 'absolute',
          left: 12,
          right: 12,
          bottom: 10,
          alignItems: 'center',
        }}
        pointerEvents="none"
      >
        <Text
          variant="caption"
          align="center"
          color="#FFFFFF"
          style={{ fontSize: 11, opacity: 0.92 }}
        >
          {fallbackLabel}
        </Text>
      </View>
    </View>
  );
}

// ─── Reduce-motion hook ────────────────────────────────────────────────────
// Honour the system "Reduce Motion" preference — when it's on we still play
// the demo but freeze its animation values so users who explicitly asked
// for less movement get a static screen. iOS A11y guidance.

function useReduceMotion(): boolean {
  const [reduce, setReduce] = React.useState(false);
  React.useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((v) => mounted && setReduce(!!v))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v) => {
      if (mounted) setReduce(!!v);
    });
    return () => {
      mounted = false;
      sub?.remove?.();
    };
  }, []);
  return reduce;
}
