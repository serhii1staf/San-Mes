import React from 'react';
import { View, Pressable, Switch, ScrollView } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import { BlurView } from '../../src/components/ui/AppBlurView';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { useSettingsStore } from '../../src/store/settingsStore';
import { BOTTOM_BAND_ENABLED } from '../../src/lib/browserWidget';
import { useT } from '../../src/i18n/store';
import { triggerHaptic } from '../../src/utils/haptics';

// Browser-specific settings: in-app browser toggle + position of the
// minimised-session widget. Kept out of the generic Behavior/Appearance
// sections so the user can land on a page dedicated to one feature.

/** The preview's chat rows: the widths of their name and last-message lines. */
const ROW_NAME_W = ['55%', '40%', '62%', '35%'] as const;
const ROW_TEXT_W = ['35%', '50%', '28%', '44%'] as const;

export default function BrowserSettingsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const useInAppBrowser = useSettingsStore((s) => s.useInAppBrowser);
  const setInAppBrowser = useSettingsStore((s) => s.setInAppBrowser);
  const browserWidgetPosition = useSettingsStore((s) => s.browserWidgetPosition);
  const setBrowserWidgetPosition = useSettingsStore((s) => s.setBrowserWidgetPosition);

  const cardBg = theme.isDark ? theme.colors.background.elevated : '#FFFFFF';

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: insets.top + 8, paddingBottom: 12 }}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={{ padding: 4 }}>
          <Feather name="chevron-left" size={24} color={theme.colors.text.primary} />
        </Pressable>
        <Text variant="body" weight="bold" style={{ flex: 1, textAlign: 'center', marginRight: 32 }}>{t('browser_settings.title')}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 100 }}>
        {/* In-app browser toggle */}
        <View style={{ backgroundColor: cardBg, borderRadius: 14, marginBottom: 24 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 }}>
            <View style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: 'rgba(100,210,255,0.16)', alignItems: 'center', justifyContent: 'center', marginRight: 14 }}>
              <Feather name="globe" size={17} color="#64D2FF" />
            </View>
            <Text variant="body" style={{ flex: 1 }}>{t('browser_settings.in_app_label')}</Text>
            <Switch
              value={useInAppBrowser}
              onValueChange={setInAppBrowser}
              trackColor={{ true: '#4CD964', false: theme.colors.border.light }}
              thumbColor="#FFFFFF"
            />
          </View>
        </View>

        {/* Position picker — hidden while the bottom variant is switched off, rather
            than left on screen as a choice that silently does nothing. The stored
            preference is untouched, so flipping `BOTTOM_BAND_ENABLED` back on restores
            both this picker and whatever the user had selected. */}
        {BOTTOM_BAND_ENABLED ? (
          <>
            <Text variant="caption" weight="semibold" color={theme.colors.text.secondary} style={{ marginLeft: 4, marginBottom: 8, textTransform: 'uppercase', fontSize: 11 }}>
              {t('browser_settings.position_label')}
            </Text>
            <View style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>
              <PositionCard
                label={t('browser_settings.position_top')}
                active={browserWidgetPosition === 'top'}
                onPress={() => { triggerHaptic('selection'); setBrowserWidgetPosition('top'); }}
                theme={theme}
                kind="top"
              />
              <PositionCard
                label={t('browser_settings.position_bottom')}
                active={browserWidgetPosition === 'bottom'}
                onPress={() => { triggerHaptic('selection'); setBrowserWidgetPosition('bottom'); }}
                theme={theme}
                kind="bottom"
              />
            </View>
            <Text variant="caption" color={theme.colors.text.tertiary} style={{ paddingHorizontal: 4 }}>
              {t('browser_settings.position_hint')}
            </Text>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function PositionCard({
  label,
  active,
  onPress,
  theme,
  kind,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  theme: any;
  kind: 'top' | 'bottom';
}) {
  const isDark = theme.isDark;
  const accent = theme.colors.accent.primary;

  // Outer tile chrome.
  const tileBg = isDark ? theme.colors.background.elevated : '#FFFFFF';

  // The faux phone "screen" — slightly off from pure black/white so the
  // skeleton content reads as floating cards, like the real feed.
  const screenBg = isDark ? '#0A0A0C' : '#EEF0F4';
  // Cards/surfaces that sit on the screen (feed rows, tab bar, bottom band).
  const surfaceBg = isDark ? 'rgba(255,255,255,0.07)' : '#FFFFFF';
  // Hairline strokes + neutral skeleton fills.
  const stroke = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)';
  const skeleton = isDark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.10)';
  const skeletonFaint = isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.055)';
  const inkStrong = isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.45)';

  // The minimised browser pill, matched to the real widgets:
  //  • top  → a floating glass pill (BrowserMiniBar / BlurView, rounded 16): favicon/emoji dot,
  //    a short title line, a tiny ✕ on the right
  //  • bottom → Telegram's minimized app bar under the app (BrowserBottomBand): a centred title
  //    line and the ✕ on the left
  const renderPill = () => {
    if (kind === 'top') {
      return (
        <View
          style={{
            position: 'absolute',
            top: 22,
            alignSelf: 'center',
            borderRadius: 9,
            overflow: 'hidden',
            // Accent ring + soft glow so the pill pops on the faux screen.
            borderWidth: 1,
            borderColor: active ? accent + 'AA' : stroke,
            shadowColor: active ? accent : '#000',
            shadowOpacity: active ? 0.5 : 0.18,
            shadowRadius: active ? 5 : 3,
            shadowOffset: { width: 0, height: 1 },
          }}
        >
          <BlurView
            intensity={70}
            tint={isDark ? 'dark' : 'light'}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              paddingHorizontal: 6,
              paddingVertical: 4,
              backgroundColor: isDark ? 'rgba(20,20,20,0.55)' : 'rgba(255,255,255,0.6)',
            }}
          >
            {/* favicon/emoji dot */}
            <View style={{ width: 7, height: 7, borderRadius: 2, backgroundColor: accent }} />
            {/* title line */}
            <View style={{ width: 26, height: 3.5, borderRadius: 2, backgroundColor: inkStrong }} />
            {/* tiny ✕ */}
            <Feather name="x" size={7} color={theme.colors.text.tertiary} />
          </BlurView>
        </View>
      );
    }
    // Bottom bar, drawn the way BrowserBottomBand draws it (Telegram's minimized app bar): the app
    // ends above it with black rounded corners, then a thin black gap, then a solid bar with rounded
    // top corners, the title centred and the ✕ on the LEFT. No icon, as in Telegram.
    const barBg = isDark ? theme.colors.background.secondary : '#FFFFFF';
    return (
      <>
        <Svg width={8} height={8} style={{ position: 'absolute', left: 0, bottom: 22 }} pointerEvents="none">
          <Path d="M0,0 A8,8 0 0 0 8,8 L0,8 Z" fill="#000" />
        </Svg>
        <Svg width={8} height={8} style={{ position: 'absolute', right: 0, bottom: 22, transform: [{ scaleX: -1 }] }} pointerEvents="none">
          <Path d="M0,0 A8,8 0 0 0 8,8 L0,8 Z" fill="#000" />
        </Svg>
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: 22,
            paddingTop: 1.5,
            backgroundColor: '#000',
          }}
        >
          <View
            style={{
              flex: 1,
              borderTopLeftRadius: 7,
              borderTopRightRadius: 7,
              backgroundColor: barBg,
              borderTopWidth: active ? 1.5 : 0,
              borderColor: accent,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {/* title line */}
            <View style={{ width: 30, height: 3.5, borderRadius: 2, backgroundColor: inkStrong }} />
            {/* tiny ✕ pinned to the left, like the real bar */}
            <Feather name="x" size={8} color={inkStrong} style={{ position: 'absolute', left: 7 }} />
          </View>
        </View>
      </>
    );
  };

  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1,
        backgroundColor: tileBg,
        borderRadius: 20,
        padding: 14,
        borderWidth: 2,
        borderColor: active ? accent : theme.colors.border.light,
        // Accent glow on the whole tile when selected.
        shadowColor: active ? accent : '#000',
        shadowOpacity: active ? 0.28 : 0.06,
        shadowRadius: active ? 12 : 4,
        shadowOffset: { width: 0, height: active ? 4 : 2 },
      }}
    >
      {/* ── Mini phone frame ─────────────────────────────────────────── */}
      <View
        style={{
          aspectRatio: 9 / 19,
          borderRadius: 18,
          backgroundColor: screenBg,
          borderWidth: 3,
          borderColor: isDark ? '#1C1C1F' : '#D7DAE0',
          overflow: 'hidden',
          paddingHorizontal: 7,
          paddingTop: 13,
          paddingBottom: 5,
        }}
      >
        {/* Status bar — time block + signal/wifi/battery hints */}
        <View style={{ position: 'absolute', top: 4, left: 9, right: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ width: 11, height: 3.5, borderRadius: 2, backgroundColor: inkStrong }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
            <View style={{ width: 4, height: 3.5, borderRadius: 1, backgroundColor: inkStrong }} />
            <View style={{ width: 4, height: 3.5, borderRadius: 1, backgroundColor: inkStrong }} />
            <View style={{ width: 7, height: 3.5, borderRadius: 1.5, backgroundColor: inkStrong }} />
          </View>
        </View>

        {/* Dynamic-island / notch hint */}
        <View style={{ position: 'absolute', top: 3, left: 0, right: 0, alignItems: 'center' }}>
          <View style={{ width: 26, height: 6, borderRadius: 3, backgroundColor: isDark ? '#000' : '#23252B' }} />
        </View>

        {/* The chat list as the app shows it now: «Изм.», the title with the account's avatar, the
            pencil; the search field; the folder chips; chat rows. (It was a feed with stories and post
            cards, which the app no longer has.) */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <View style={{ width: 14, height: 7, borderRadius: 3.5, borderWidth: 1, borderColor: stroke, backgroundColor: skeletonFaint }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: accent + 'AA' }} />
            <View style={{ width: 16, height: 4.5, borderRadius: 2, backgroundColor: inkStrong }} />
          </View>
          <View style={{ width: 7, height: 7, borderRadius: 3.5, borderWidth: 1, borderColor: stroke, backgroundColor: skeletonFaint }} />
        </View>

        <View style={{ height: 8, borderRadius: 4, backgroundColor: skeletonFaint, marginBottom: 6 }} />

        <View style={{ flexDirection: 'row', gap: 3, marginBottom: 7 }}>
          <View style={{ width: 13, height: 6, borderRadius: 3, backgroundColor: accent + '55' }} />
          <View style={{ width: 20, height: 6, borderRadius: 3, backgroundColor: skeletonFaint }} />
          <View style={{ width: 12, height: 6, borderRadius: 3, backgroundColor: skeletonFaint }} />
        </View>

        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 7 }}>
            <View style={{ width: 11, height: 11, borderRadius: 5.5, backgroundColor: i === 0 ? accent + 'AA' : skeleton }} />
            <View style={{ flex: 1 }}>
              <View style={{ width: ROW_NAME_W[i], height: 3, borderRadius: 1.5, backgroundColor: skeleton }} />
              <View style={{ width: ROW_TEXT_W[i], height: 2.5, borderRadius: 1.5, backgroundColor: skeletonFaint, marginTop: 2.5 }} />
            </View>
          </View>
        ))}

        {/* The tab bar as it is now: a pill with search and chats (chats selected), and the profile
            circle beside it. On the bottom variant it rests on the bar. */}
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: kind === 'bottom' ? 27 : 7,
            flexDirection: 'row',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 3,
          }}
        >
          <View
            style={{
              width: 44,
              height: 15,
              borderRadius: 7.5,
              backgroundColor: surfaceBg,
              borderWidth: 1,
              borderColor: stroke,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-around',
              paddingHorizontal: 3,
            }}
          >
            <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: skeleton }} />
            <View style={{ width: 18, height: 10, borderRadius: 5, backgroundColor: skeletonFaint, alignItems: 'center', justifyContent: 'center' }}>
              <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: accent }} />
            </View>
          </View>
          <View style={{ width: 15, height: 15, borderRadius: 7.5, backgroundColor: surfaceBg, borderWidth: 1, borderColor: stroke, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: skeleton }} />
          </View>
        </View>

        {/* The minimised browser pill in its real position */}
        {renderPill()}
      </View>

      {/* Label + selected check */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, marginTop: 11 }}>
        {active && <Feather name="check-circle" size={13} color={accent} />}
        <Text variant="caption" weight="semibold" style={{ color: active ? accent : theme.colors.text.primary }}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}
