// HeaderLandscape
// ---------------
// Draws a profile-header background as a detailed LANDSCAPE (sky gradient +
// haze + layered silhouettes + sun/moon + optional stars) and/or the user's
// own FREEHAND DRAWING. The silhouettes use react-native-svg on a 0..100
// viewBox with preserveAspectRatio="none" so they stretch to fill any box
// identically in the swatch, editor preview and live card. The sun/moon is a
// real round RN View (NOT an SVG circle) so it never squishes on wide boxes.
//
// Read-only, memoized, pointerEvents off. Returns null when there's nothing to
// draw (no known background id and no strokes).

import React, { memo, useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, {
  Defs, LinearGradient as SvgGradient, Stop, Rect, Polygon, Path,
} from 'react-native-svg';
import { backgroundScene, LandscapeKind, HeaderDrawStroke } from '../../services/headerScene';

function noise(seed: number, i: number): number {
  const v = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

function ridge(seed: number, baseY: number, amp: number, count: number): string {
  const pts: string[] = ['0,101', `0,${baseY.toFixed(1)}`];
  for (let i = 0; i <= count; i++) {
    const x = (i / count) * 100;
    const y = baseY - amp * noise(seed, i);
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  pts.push(`100,${baseY.toFixed(1)}`, '100,101');
  return pts.join(' ');
}

// Per-kind ridge geometry: haze (far), back, front.
const GEOMETRY: Record<LandscapeKind, { baseY: number; amp: number; count: number }[]> = {
  mountains: [
    { baseY: 48, amp: 16, count: 9 },
    { baseY: 58, amp: 28, count: 7 },
    { baseY: 74, amp: 34, count: 5 },
  ],
  hills: [
    { baseY: 58, amp: 8, count: 11 },
    { baseY: 68, amp: 13, count: 9 },
    { baseY: 81, amp: 17, count: 7 },
  ],
  waves: [
    { baseY: 64, amp: 4, count: 15 },
    { baseY: 73, amp: 6, count: 13 },
    { baseY: 85, amp: 7, count: 11 },
  ],
  space: [
    { baseY: 88, amp: 7, count: 6 },
  ],
};

// Mix two hex colours (for a soft haze tone between sky and mountains).
function mix(a: string, b: string, t: number): string {
  const pa = a.replace('#', ''); const pb = b.replace('#', '');
  const ra = parseInt(pa.slice(0, 2), 16), ga = parseInt(pa.slice(2, 4), 16), ba = parseInt(pa.slice(4, 6), 16);
  const rb = parseInt(pb.slice(0, 2), 16), gb = parseInt(pb.slice(2, 4), 16), bb = parseInt(pb.slice(4, 6), 16);
  const r = Math.round(ra + (rb - ra) * t), g = Math.round(ga + (gb - ga) * t), bl = Math.round(ba + (bb - ba) * t);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bl.toString(16).padStart(2, '0')}`;
}

function HeaderLandscapeComponent({
  backgroundId,
  drawing,
  style,
}: {
  backgroundId: string | null | undefined;
  drawing?: HeaderDrawStroke[] | null;
  style?: any;
}) {
  const scene = backgroundScene(backgroundId);

  const geo = useMemo(() => {
    if (!scene) return null;
    const g = GEOMETRY[scene.kind];
    // Colour ramp back → front: haze (sky/mountain mix), then the layer colours.
    const haze = mix(scene.sky[1], scene.layers[0], 0.5);
    const ramp = [haze, scene.layers[0], scene.layers[Math.min(1, scene.layers.length - 1)]];
    const layers = g.map((gg, i) => ({
      color: ramp[Math.min(i, ramp.length - 1)],
      points: ridge((backgroundId!.length + 1) * (i + 3), gg.baseY, gg.amp, gg.count),
    }));
    const stars = scene.kind === 'space'
      ? Array.from({ length: 26 }, (_, i) => ({
          x: noise(7.1, i) * 100,
          y: noise(3.3, i) * 62,
          r: 0.4 + noise(9.9, i) * 1.2,
        }))
      : [];
    return { layers, stars };
  }, [backgroundId, scene]);

  const hasDrawing = !!drawing && drawing.length > 0;
  if (!scene && !hasDrawing) return null;

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      {scene && geo ? (
        <>
          <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
            <Defs>
              <SvgGradient id="sky" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={scene.sky[0]} />
                <Stop offset="1" stopColor={scene.sky[1]} />
              </SvgGradient>
            </Defs>
            <Rect x="0" y="0" width="100" height="100" fill="url(#sky)" />
            {geo.stars.map((s, i) => (
              <Rect key={`st-${i}`} x={s.x} y={s.y} width={s.r} height={s.r} fill="#FFFFFF" opacity={0.85} />
            ))}
            {geo.layers.map((l, i) => (
              <Polygon key={`ly-${i}`} points={l.points} fill={l.color} />
            ))}
          </Svg>
          {/* Sun / moon — a REAL round RN circle (aspectRatio 1) so it stays
              circular on wide cards instead of squishing like an SVG ellipse. */}
          {scene.celestial ? (
            <View style={StyleSheet.absoluteFill} pointerEvents="none">
              {/* soft glow */}
              <View style={{ position: 'absolute', left: '60%', top: '8%', width: '22%', aspectRatio: 1, borderRadius: 999, backgroundColor: scene.celestialColor, opacity: 0.22 }} />
              <View style={{ position: 'absolute', left: `${scene.celestial === 'moon' ? 66 : 64}%`, top: `${scene.celestial === 'moon' ? 13 : 12}%`, width: scene.celestial === 'moon' ? '13%' : '16%', aspectRatio: 1, borderRadius: 999, backgroundColor: scene.celestialColor, opacity: 0.95 }} />
            </View>
          ) : null}
        </>
      ) : null}
      {/* User freehand drawing — same 0..100 space, on top of any landscape. */}
      {hasDrawing ? (
        <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
          {drawing!.map((s, i) => (
            <Path key={`dr-${i}`} d={s.d} stroke={s.color} strokeWidth={s.w} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          ))}
        </Svg>
      ) : null}
    </View>
  );
}

export const HeaderLandscape = memo(HeaderLandscapeComponent);

// ── MiniScene ────────────────────────────────────────────────────────────
// A CHEAP themed thumbnail for the background picker swatches, built entirely
// from plain RN Views (the lightest primitive) — no SVG, no native gradient
// modules. 14 of these mount/unmount far cheaper than 14 SVG/gradient views,
// which is what made the customize screen drop frames on open/close. Conveys
// the scene's theme (sky, sun/moon, mountains/water, stars) without detail.
const STAR_POS = [
  { x: 14, y: 12 }, { x: 32, y: 22 }, { x: 50, y: 10 }, { x: 78, y: 18 },
  { x: 88, y: 30 }, { x: 22, y: 34 }, { x: 64, y: 28 },
];

function MiniSceneComponent({ backgroundId }: { backgroundId?: string | null }) {
  const scene = backgroundScene(backgroundId);
  if (!scene) return null;
  const isSpace = scene.kind === 'space';
  const isWaves = scene.kind === 'waves';
  const groundTop = isWaves ? '66%' : scene.kind === 'hills' ? '60%' : '56%';
  return (
    <View style={{ flex: 1, backgroundColor: scene.sky[1], overflow: 'hidden' }}>
      {/* upper sky band */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '58%', backgroundColor: scene.sky[0] }} />
      {/* stars (space) */}
      {isSpace && STAR_POS.map((s, i) => (
        <View key={i} style={{ position: 'absolute', left: `${s.x}%`, top: `${s.y}%`, width: 2, height: 2, borderRadius: 1, backgroundColor: '#FFFFFF', opacity: 0.9 }} />
      ))}
      {/* sun / moon */}
      {scene.celestial ? (
        <View style={{ position: 'absolute', left: '58%', top: '12%', width: '26%', aspectRatio: 1, borderRadius: 999, backgroundColor: scene.celestialColor, opacity: 0.95 }} />
      ) : null}
      {/* back mountain peaks (skip for water / space) */}
      {!isSpace && !isWaves ? (
        <>
          <View style={{ position: 'absolute', left: '6%', top: groundTop, width: '50%', aspectRatio: 1, transform: [{ translateY: -8 }, { rotate: '45deg' }], backgroundColor: scene.layers[0] }} />
          <View style={{ position: 'absolute', left: '44%', top: groundTop, width: '56%', aspectRatio: 1, transform: [{ translateY: -10 }, { rotate: '45deg' }], backgroundColor: scene.layers[0] }} />
        </>
      ) : null}
      {/* front ground / water band */}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, top: groundTop, backgroundColor: scene.layers[1] }} />
      {isWaves ? (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '16%', backgroundColor: scene.layers[0], opacity: 0.6 }} />
      ) : null}
    </View>
  );
}

export const MiniScene = memo(MiniSceneComponent);
