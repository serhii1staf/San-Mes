// HeaderLandscape
// ---------------
// Draws a profile-header background as a simple LANDSCAPE (sky + optional
// sun/moon + one or two layered silhouettes) rather than a flat colour
// gradient. Implemented with react-native-svg on a 0..100 viewBox and
// `preserveAspectRatio="none"`, so it stretches to fill whatever box it's
// placed in and renders IDENTICALLY in the picker swatch, the editor preview
// and the live profile card (which all share the card's aspect ratio).
//
// Read-only, memoized, pointerEvents off. Returns null for unknown ids.

import React, { memo, useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, {
  Defs, LinearGradient as SvgGradient, Stop, Rect, Circle, Polygon,
} from 'react-native-svg';
import { backgroundScene, LandscapeKind } from '../../services/headerScene';

// Deterministic 0..1 noise so a given (seed, i) always yields the same ridge —
// silhouettes never "jump" between renders or between swatch and card.
function noise(seed: number, i: number): number {
  const v = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

// One silhouette ridge as an SVG polygon points string, closed to the bottom.
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

// Per-kind ridge geometry (back layer first, front layer second).
const GEOMETRY: Record<LandscapeKind, { baseY: number; amp: number; count: number }[]> = {
  mountains: [
    { baseY: 56, amp: 28, count: 7 },
    { baseY: 72, amp: 34, count: 5 },
  ],
  hills: [
    { baseY: 66, amp: 12, count: 9 },
    { baseY: 80, amp: 16, count: 7 },
  ],
  waves: [
    { baseY: 70, amp: 6, count: 13 },
    { baseY: 84, amp: 7, count: 11 },
  ],
  space: [
    { baseY: 86, amp: 8, count: 6 },
  ],
};

function HeaderLandscapeComponent({
  backgroundId,
  style,
}: {
  backgroundId: string | null | undefined;
  style?: any;
}) {
  const scene = backgroundScene(backgroundId);

  // Precompute ridges + stars once per background id.
  const geo = useMemo(() => {
    if (!scene) return null;
    const layers = GEOMETRY[scene.kind].map((g, i) => ({
      color: scene.layers[Math.min(i, scene.layers.length - 1)],
      points: ridge((backgroundId!.length + 1) * (i + 3), g.baseY, g.amp, g.count),
    }));
    // Stars only for the "space" kind — a sparse deterministic field.
    const stars = scene.kind === 'space'
      ? Array.from({ length: 22 }, (_, i) => ({
          x: noise(7.1, i) * 100,
          y: noise(3.3, i) * 60,
          r: 0.5 + noise(9.9, i) * 1.1,
        }))
      : [];
    return { layers, stars };
  }, [backgroundId, scene]);

  if (!scene || !geo) return null;

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
        <Defs>
          <SvgGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={scene.sky[0]} />
            <Stop offset="1" stopColor={scene.sky[1]} />
          </SvgGradient>
        </Defs>
        {/* Sky */}
        <Rect x="0" y="0" width="100" height="100" fill="url(#sky)" />
        {/* Stars (space) */}
        {geo.stars.map((s, i) => (
          <Circle key={`st-${i}`} cx={s.x} cy={s.y} r={s.r} fill="#FFFFFF" opacity={0.85} />
        ))}
        {/* Sun / moon */}
        {scene.celestial ? (
          <Circle cx={70} cy={26} r={scene.celestial === 'moon' ? 9 : 12} fill={scene.celestialColor} opacity={0.92} />
        ) : null}
        {/* Layered silhouettes, back → front */}
        {geo.layers.map((l, i) => (
          <Polygon key={`ly-${i}`} points={l.points} fill={l.color} />
        ))}
      </Svg>
    </View>
  );
}

export const HeaderLandscape = memo(HeaderLandscapeComponent);
