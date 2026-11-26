/**
 * The chat's header band: the top of the screen in the chat's own colour, with the conversation
 * tucked under it as if it were a card with rounded TOP corners, and that rounded edge soft.
 *
 * Asked for (Nov 2026, with a reference screenshot): the header "looks the same as in every app".
 * Round one, a sheet with rounded bottom corners, was turned the wrong way. Round two had the shape
 * right, but its corners were too diffuse to read, and on iPhone the blur ran as a separate straight
 * strip under the band ("the strip of blur goes straight; it is this rounded strip itself that should
 * blur smoothly"), and the corners should be "sharper and rounder".
 *
 * So the colour and the blur now share one edge: everything is a function of one distance, from the
 * card's rounded top edge out into the band (`edgeY` is where that edge runs in the middle), and they
 * only differ in how far in each one takes to come in:
 *
 *   - the colour over `COLOR_FADE` pt, so the band is opaque from there up and soft at its edge;
 *   - iOS: a system blur (UIVisualEffectView) over `BLUR_FADE` pt, much sooner, so what scrolls under
 *     the rounded edge is blurred right up to the line, and the line reads clearly, corners included.
 *     Not our glass: that re-captures what is under it whenever it changes, which under a scrolling
 *     transcript is every frame. Android: the colour alone (a live blur there costs frames, see
 *     AppBlurView).
 *
 * The corners are `RADIUS` pt (round two had 34; asked twice for bigger ones, about an iPhone's own screen\r
 * corner) and come from
 * assets/chat-header-corner*.png, drawn by scripts/make-chat-header-corner.js with the same distance.
 * Everything here is static: nothing is drawn per frame. The transcript's top inset is unchanged.
 */
import React, { memo, useMemo } from 'react';
import { Image, Platform, StyleSheet, View } from 'react-native';
import { BlurView as ExpoBlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { getMaskedView } from '../ui/FadingBlurHeader';

const CORNER_COLOR = require('../../../assets/chat-header-corner.png');
const CORNER_BLUR = require('../../../assets/chat-header-corner-blur.png');
/** Keep these equal to the ones in scripts/make-chat-header-corner.js. */
const RADIUS = 56;
const FADE_MAX = 20;
const COLOR_FADE = 20;
const BLUR_FADE = 8;

const STOPS = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1] as const;
const smoothstep = (t: number) => t * t * (3 - 2 * t);
type GradientColors = readonly [string, string, ...string[]];
/** `color` (#RRGGBB) from opaque to clear along `STOPS`. */
function edgeColors(color: string): GradientColors {
  const base = /^#[0-9a-f]{6}/i.test(color) ? color.slice(0, 7) : '#000000';
  return STOPS.map((s) => base + Math.round((1 - smoothstep(s)) * 255).toString(16).padStart(2, '0')) as unknown as GradientColors;
}
const BLACK_EDGE = edgeColors('#000000');

/**
 * The band in `color`: opaque down to `edgeY - fade`, then coming off over `fade` to the card's edge,
 * which runs straight at `edgeY` and turns down around the card's rounded top corners.
 */
function BandShape({ color, edgeY, fade, edge, corner }: {
  color: string;
  edgeY: number;
  fade: number;
  edge: GradientColors;
  corner: number;
}) {
  return (
    <>
      <View style={[styles.fill, { height: edgeY - fade, backgroundColor: color }]} />
      <LinearGradient colors={edge} locations={STOPS} style={[styles.edge, { top: edgeY - fade, height: fade }]} />
      <Image source={corner} style={[styles.corner, { top: edgeY - FADE_MAX, left: 0, tintColor: color }]} />
      <Image source={corner} style={[styles.corner, styles.mirrored, { top: edgeY - FADE_MAX, right: 0, tintColor: color }]} />
    </>
  );
}

/**
 * How tall the band is for a given `edgeY`: its corners reach `RADIUS` below the edge. The view the
 * band is drawn in must be at least this tall: Android clips a child to its parent's bounds, which
 * cut the corners off at the header row (emulator, Nov 2026).
 */
export function chatHeaderSheetHeight(edgeY: number): number {
  return edgeY + RADIUS;
}

export const ChatHeaderSheet = memo(function ChatHeaderSheet({
  isDark,
  bgColor,
  edgeY,
}: {
  isDark: boolean;
  /** The chat's background colour (#RRGGBB): the band's colour. */
  bgColor: string;
  /** Where the card's top edge runs in the middle, from the top of the screen. */
  edgeY: number;
}) {
  const edge = useMemo(() => edgeColors(bgColor), [bgColor]);
  const Masked = Platform.OS === 'ios' ? getMaskedView() : null;
  return (
    <View pointerEvents="none" style={[styles.band, { height: chatHeaderSheetHeight(edgeY) }]}>
      {Masked ? (
        <Masked
          style={StyleSheet.absoluteFill}
          maskElement={
            <View style={StyleSheet.absoluteFill}>
              <BandShape color="#000000" edgeY={edgeY} fade={BLUR_FADE} edge={BLACK_EDGE} corner={CORNER_BLUR} />
            </View>
          }
        >
          <ExpoBlurView
            intensity={60}
            tint={isDark ? 'systemUltraThinMaterialDark' : 'systemUltraThinMaterialLight'}
            style={StyleSheet.absoluteFill}
          />
        </Masked>
      ) : null}
      <BandShape color={bgColor} edgeY={edgeY} fade={COLOR_FADE} edge={edge} corner={CORNER_COLOR} />
    </View>
  );
});

const styles = StyleSheet.create({
  // Over the transcript, under the header's controls (their wrapper has zIndex 100).
  band: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 99 },
  fill: { position: 'absolute', top: 0, left: 0, right: 0 },
  // Between the corners; the corners carry the edge at the sides.
  edge: { position: 'absolute', left: RADIUS, right: RADIUS },
  corner: { position: 'absolute', width: RADIUS, height: FADE_MAX + RADIUS },
  mirrored: { transform: [{ scaleX: -1 }] },
});
