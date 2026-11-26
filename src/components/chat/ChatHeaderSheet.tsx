/**
 * The chat's header band: the top of the screen in the chat's own colour, with the conversation
 * tucked under it as if it were a card with rounded TOP corners, and every edge of it soft.
 *
 * Asked for (Nov 2026, with a reference screenshot): the header "looks the same as in every app".
 * The first try was a sheet with rounded bottom corners, which was "turned the wrong way": the
 * rounding goes the other way, the band wraps around the conversation's top corners, and "along the
 * edges it is all smoothly blurred". So:
 *
 *   - the band is solid down to `solid`, then fades out over `FADE` pt on a smoothstep curve (flat at
 *     both ends, so there is no line where it starts or ends);
 *   - at the left and right it reaches `RADIUS` pt further down, around the transcript's rounded top
 *     corners, with the same soft falloff (assets/chat-header-corner.png, drawn by
 *     scripts/make-chat-header-corner.js, tinted to the chat's colour);
 *   - iOS: what scrolls under the edge is also blurred, by a system blur (UIVisualEffectView) shown
 *     through the same shape a little lower, so the blur runs on just past the colour. Not our glass:
 *     that re-captures what is under it whenever it changes, which under a scrolling transcript is
 *     every frame. Android: the colour alone (a live blur there costs frames, see AppBlurView).
 *
 * Everything here is static views and one gradient: nothing is drawn per frame. The band hangs below
 * the header row by `FADE`, and its corners by `RADIUS`; the transcript's top inset is unchanged.
 */
import React, { memo, useMemo } from 'react';
import { Image, Platform, StyleSheet, View } from 'react-native';
import { BlurView as ExpoBlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { getMaskedView } from '../ui/FadingBlurHeader';

const CORNER = require('../../../assets/chat-header-corner.png');
/** The transcript's top corners. The profile banner card had 30; "a little bigger". */
const RADIUS = 34;
/** The soft edge. Must match FADE in scripts/make-chat-header-corner.js. */
const FADE = 26;
/** How much lower the iOS blur's edge runs than the colour's. */
const BLUR_LAG = 12;

const STOPS = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1] as const;
const smoothstep = (t: number) => t * t * (3 - 2 * t);
type GradientColors = readonly [string, string, ...string[]];
/** `color` (#RRGGBB) from opaque to clear along `STOPS`. */
function edgeColors(color: string): GradientColors {
  const base = /^#[0-9a-f]{6}/i.test(color) ? color.slice(0, 7) : '#000000';
  return STOPS.map((s) => base + Math.round((1 - smoothstep(s)) * 255).toString(16).padStart(2, '0')) as unknown as GradientColors;
}
const BLACK_EDGE = edgeColors('#000000');

/** The band's shape in `color`: solid to `solid`, then the soft edge and the two soft corners. */
function BandShape({ color, solid, edge }: { color: string; solid: number; edge: GradientColors }) {
  return (
    <>
      <View style={[styles.solid, { height: solid, backgroundColor: color }]} />
      <LinearGradient colors={edge} locations={STOPS} style={[styles.edge, { top: solid }]} />
      <Image source={CORNER} style={[styles.corner, { top: solid, left: 0, tintColor: color }]} />
      <Image source={CORNER} style={[styles.corner, styles.mirrored, { top: solid, right: 0, tintColor: color }]} />
    </>
  );
}

export const ChatHeaderSheet = memo(function ChatHeaderSheet({
  isDark,
  bgColor,
  solid,
}: {
  isDark: boolean;
  /** The chat's background colour (#RRGGBB): the band's colour. */
  bgColor: string;
  /** Where the solid part ends (from the top of the screen): just under the header row. */
  solid: number;
}) {
  const edge = useMemo(() => edgeColors(bgColor), [bgColor]);
  const Masked = Platform.OS === 'ios' ? getMaskedView() : null;
  const height = solid + Math.max(FADE, RADIUS) + BLUR_LAG;
  return (
    <View pointerEvents="none" style={[styles.band, { height }]}>
      {Masked ? (
        <Masked
          style={StyleSheet.absoluteFill}
          maskElement={
            <View style={StyleSheet.absoluteFill}>
              <BandShape color="#000000" solid={solid + BLUR_LAG} edge={BLACK_EDGE} />
            </View>
          }
        >
          <ExpoBlurView intensity={28} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
        </Masked>
      ) : null}
      <BandShape color={bgColor} solid={solid} edge={edge} />
    </View>
  );
});

const styles = StyleSheet.create({
  band: { position: 'absolute', top: 0, left: 0, right: 0 },
  solid: { position: 'absolute', top: 0, left: 0, right: 0 },
  // Between the corners; the corners carry the edge at the sides.
  edge: { position: 'absolute', left: RADIUS, right: RADIUS, height: FADE },
  corner: { position: 'absolute', width: RADIUS, height: RADIUS },
  mirrored: { transform: [{ scaleX: -1 }] },
});
