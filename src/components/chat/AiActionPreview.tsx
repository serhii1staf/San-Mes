/**
 * What San AI shows under a reply that changed something: a preview of the theme it applied, and a
 * chip for every other change (name, emoji, bio, font, mode, links).
 *
 * ── WHY IT WAS REDONE (Nov 2026) ──────────────────────────────────────────────────────────────────
 *
 * Reported: the previews «выглядят максимально ужасно». The old card was a 55%-wide phone drawn at
 * 8-11 pt type with grey placeholder bars for content and a 2 pt accent outline, always dark (a light
 * theme was previewed on black), and a separate «🎨 Тема: X ✓» pill above it repeated its name.
 *
 * Now the card shows the theme as it will look: a short conversation on the theme's own page, an
 * incoming bubble on its surface colour, an outgoing one in its accent with text picked to be legible
 * on it, the composer, a soft glow of the accent, and the name, the code and «Применена» under it. It is
 * drawn in the mode the theme is applied in, so a cream theme is previewed light. The pill is gone for
 * an applied theme: the card says the same thing.
 *
 * Static views only: no blur, no animation, nothing measured; one gradient.
 */
import React, { memo } from 'react';
import { StyleSheet, Text as RNText, View, useWindowDimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Text } from '../ui/Text';
import { readableTextOn } from '../../constants/bubbleColors';
import { emojiTextStyle } from '../ui/emojiText';
import type { ACCENT_COLORS, ThemeMode } from '../../store/themeStore';

type ThemeOption = (typeof ACCENT_COLORS)[number];

export const ThemePreviewCard = memo(function ThemePreviewCard({
  theme,
  mode,
  emoji,
  incoming,
  outgoing,
  composer,
  appliedLabel,
}: {
  theme: ThemeOption;
  mode: ThemeMode;
  /** The account's emoji, as the avatar of the incoming message. */
  emoji: string;
  incoming: string;
  outgoing: string;
  composer: string;
  appliedLabel: string;
}) {
  const { width } = useWindowDimensions();
  const cardW = Math.min(300, Math.round(width * 0.74));
  const light = mode === 'light';
  const accent = theme.accent || theme.color;
  const page = light ? theme.light : theme.darkBg;
  const surface = light ? '#FFFFFF' : theme.darkElevated;
  const ink = light ? '#15161B' : '#FFFFFF';
  const subInk = light ? 'rgba(21,22,27,0.55)' : 'rgba(255,255,255,0.55)';
  const line = light ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.08)';
  const onAccent = readableTextOn(accent);
  const label = theme.label.replace(/^✨\s*/, '');

  return (
    <View style={[styles.card, { width: cardW, backgroundColor: page, borderColor: line }]}>
      <View style={styles.stage}>
        {/* The accent's glow from the top, fading into the page. */}
        <LinearGradient
          pointerEvents="none"
          colors={[accent + (light ? '40' : '55'), accent + '00']}
          style={styles.glow}
        />
        <View style={styles.swatches}>
          {[page, surface, accent].map((c, i) => (
            <View key={i} style={[styles.swatch, { backgroundColor: c, borderColor: light ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.18)' }]} />
          ))}
        </View>

        <View style={styles.inRow}>
          <View style={[styles.avatar, { backgroundColor: accent + '2E' }]}>
            <RNText style={emojiTextStyle(12)} allowFontScaling={false}>{emoji}</RNText>
          </View>
          <View style={[styles.bubble, styles.bubbleIn, { backgroundColor: surface, borderColor: line }]}>
            <Text numberOfLines={2} color={ink} style={styles.bubbleText}>{incoming}</Text>
          </View>
        </View>
        <View style={[styles.bubble, styles.bubbleOut, { backgroundColor: accent }]}>
          <Text numberOfLines={2} color={onAccent} style={styles.bubbleText}>{outgoing}</Text>
        </View>

        <View style={[styles.composer, { backgroundColor: surface, borderColor: line }]}>
          <Text numberOfLines={1} color={subInk} style={styles.composerText}>{composer}</Text>
          <View style={[styles.send, { backgroundColor: accent }]}>
            <Feather name="arrow-up" size={13} color={onAccent} />
          </View>
        </View>
      </View>

      <View style={[styles.footer, { borderTopColor: line }]}>
        <View style={styles.footerText}>
          <Text weight="semibold" numberOfLines={1} color={ink} style={styles.name}>{label}</Text>
          <Text numberOfLines={1} color={subInk} style={styles.code}>{theme.color.toUpperCase()}</Text>
        </View>
        <View style={[styles.applied, { backgroundColor: accent + (light ? '24' : '2E') }]}>
          <Feather name="check" size={12} color={accent} />
          <Text weight="semibold" color={accent} style={styles.appliedText}>{appliedLabel}</Text>
        </View>
      </View>
    </View>
  );
});

/**
 * One change San AI made (or tried to): a round mark, the label, the value. Failed changes are red.
 */
export const AiActionChip = memo(function AiActionChip({
  label,
  value,
  applied,
  accent,
  ink,
  isDark,
}: {
  label: string;
  value: string;
  applied: boolean;
  accent: string;
  ink: string;
  isDark: boolean;
}) {
  const tone = applied ? accent : '#FF453A';
  return (
    <View
      style={[
        styles.chip,
        {
          backgroundColor: applied ? accent + (isDark ? '24' : '1A') : 'rgba(255,69,58,0.12)',
          borderColor: applied ? accent + '40' : 'rgba(255,69,58,0.3)',
        },
      ]}
    >
      <View style={[styles.mark, { backgroundColor: tone }]}>
        <Feather name={applied ? 'check' : 'x'} size={11} color={readableTextOn(tone)} />
      </View>
      <Text numberOfLines={1} color={ink} style={styles.chipText}>
        <Text weight="semibold" color={ink} style={styles.chipText}>{label}</Text>
        {value ? `  ${value}` : ''}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    marginTop: 8,
    borderRadius: 24,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  stage: { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 12 },
  glow: { position: 'absolute', left: 0, right: 0, top: 0, height: 120 },
  swatches: { flexDirection: 'row', gap: 5, marginBottom: 12 },
  swatch: { width: 14, height: 14, borderRadius: 7, borderWidth: StyleSheet.hairlineWidth },
  inRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  avatar: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  bubble: { maxWidth: '78%', paddingHorizontal: 11, paddingVertical: 7, borderRadius: 16, borderCurve: 'continuous' },
  bubbleIn: { borderBottomLeftRadius: 5, borderWidth: StyleSheet.hairlineWidth },
  bubbleOut: { alignSelf: 'flex-end', marginTop: 6, borderBottomRightRadius: 5 },
  bubbleText: { fontSize: 13, lineHeight: 17 },
  composer: {
    marginTop: 12,
    height: 34,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 14,
    paddingRight: 4,
  },
  composerText: { flex: 1, fontSize: 12 },
  send: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerText: { flex: 1, minWidth: 0 },
  name: { fontSize: 14, lineHeight: 18 },
  code: { fontSize: 11, lineHeight: 14, marginTop: 1, letterSpacing: 0.4 },
  applied: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, height: 24, borderRadius: 12 },
  appliedText: { fontSize: 11 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    marginTop: 6,
    height: 30,
    paddingLeft: 5,
    paddingRight: 12,
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
  },
  mark: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontSize: 12.5, flexShrink: 1 },
});
