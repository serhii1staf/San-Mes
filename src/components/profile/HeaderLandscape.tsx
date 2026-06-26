// HeaderLandscape
// ---------------
// Draws a profile-header background as a themed scene. Each LandscapeKind has a
// DISTINCT composition (city skyline with lit windows, forest with trees,
// desert with dunes + cactus, space with a planet + stars, or layered
// mountains / hills / waves) so different backgrounds don't all look alike.
// Built with react-native-svg on a 0..100 viewBox (preserveAspectRatio="none")
// so it renders identically in the picker swatch, the editor preview and the
// live profile card. The sun/moon is a real round RN View so it never squishes.
//
// Read-only, memoized, pointerEvents off. Also renders the user's freehand
// drawing on top. Returns null when there's nothing to draw.

import React, { memo, useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, {
  Defs, LinearGradient as SvgGradient, Stop, Rect, Polygon, Circle, Path,
} from 'react-native-svg';
import { backgroundScene, LandscapeKind, HeaderDrawStroke, brushLayers } from '../../services/headerScene';

function noise(seed: number, i: number): number {
  const v = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

function mix(a: string, b: string, t: number): string {
  const pa = a.replace('#', ''); const pb = b.replace('#', '');
  const ra = parseInt(pa.slice(0, 2), 16), ga = parseInt(pa.slice(2, 4), 16), ba = parseInt(pa.slice(4, 6), 16);
  const rb = parseInt(pb.slice(0, 2), 16), gb = parseInt(pb.slice(2, 4), 16), bb = parseInt(pb.slice(4, 6), 16);
  const r = Math.round(ra + (rb - ra) * t), g = Math.round(ga + (gb - ga) * t), bl = Math.round(ba + (bb - ba) * t);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bl.toString(16).padStart(2, '0')}`;
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

// Sharp triangular MOUNTAIN range: alternating valley/apex points so the
// silhouette reads as pointed peaks (clearly distinct from the soft `ridge`
// used elsewhere). Returns both the filled polygon points and the apex
// positions so the caller can drop snow caps on the tallest peaks.
function peaks(seed: number, baseY: number, maxH: number, count: number): { points: string; apex: { x: number; y: number; h: number }[] } {
  const step = 100 / count;
  const pts: string[] = ['0,101', `0,${baseY.toFixed(1)}`];
  const apex: { x: number; y: number; h: number }[] = [];
  for (let i = 0; i < count; i++) {
    const vx = i * step;
    const px = vx + step / 2;
    const h = maxH * (0.55 + 0.45 * noise(seed, i));
    const py = baseY - h;
    pts.push(`${vx.toFixed(1)},${baseY.toFixed(1)}`, `${px.toFixed(1)},${py.toFixed(1)}`);
    apex.push({ x: px, y: py, h });
  }
  pts.push(`100,${baseY.toFixed(1)}`, '100,101');
  return { points: pts.join(' '), apex };
}

// Smooth rolling HILLS as a closed SVG path built from quadratic segments
// through midpoints — gives soft rounded humps instead of jagged ridges.
function smoothHills(seed: number, baseY: number, amp: number, count: number): string {
  const p: { x: number; y: number }[] = [];
  for (let i = 0; i <= count; i++) p.push({ x: (i / count) * 100, y: baseY - amp * noise(seed, i) });
  let d = `M0 101 L0 ${p[0].y.toFixed(1)} L${p[0].x.toFixed(1)} ${p[0].y.toFixed(1)}`;
  for (let i = 0; i < p.length - 1; i++) {
    const xc = ((p[i].x + p[i + 1].x) / 2).toFixed(1);
    const yc = ((p[i].y + p[i + 1].y) / 2).toFixed(1);
    d += ` Q${p[i].x.toFixed(1)} ${p[i].y.toFixed(1)} ${xc} ${yc}`;
  }
  const last = p[p.length - 1];
  d += ` L${last.x.toFixed(1)} ${last.y.toFixed(1)} L100 101 Z`;
  return d;
}

type RectSpec = { x: number; y: number; w: number; h: number; fill: string; opacity?: number };
type CircleSpec = { cx: number; cy: number; r: number; fill: string; opacity?: number };
type PolySpec = { points: string; fill: string };
type PathSpec = { d: string; fill: string; opacity?: number };

interface SceneGeo { polys: PolySpec[]; rects: RectSpec[]; circles: CircleSpec[]; paths: PathSpec[] }

function buildGeo(kind: LandscapeKind, seed: number, sky: [string, string], layers: string[]): SceneGeo {
  const back = layers[0];
  const front = layers[Math.min(1, layers.length - 1)];
  const haze = mix(sky[1], back, 0.5);
  const polys: PolySpec[] = [];
  const rects: RectSpec[] = [];
  const circles: CircleSpec[] = [];
  const paths: PathSpec[] = [];

  if (kind === 'mountains') {
    // Soft distant haze, then two ranges of SHARP snow-capped peaks.
    polys.push({ points: ridge(seed + 3, 50, 12, 9), fill: haze });
    const mid = peaks(seed + 6, 64, 30, 5);
    polys.push({ points: mid.points, fill: back });
    const frontR = peaks(seed + 9, 80, 40, 4);
    polys.push({ points: frontR.points, fill: front });
    // Snow caps on the tallest front peaks — instantly distinguishes a
    // mountain from a hill/dune.
    const snow = mix(front, '#FFFFFF', 0.82);
    for (const a of frontR.apex) {
      if (a.h < 24) continue;
      const cap = Math.min(6, a.h * 0.22);
      polys.push({ points: `${(a.x - cap).toFixed(1)},${(a.y + cap).toFixed(1)} ${a.x.toFixed(1)},${a.y.toFixed(1)} ${(a.x + cap).toFixed(1)},${(a.y + cap).toFixed(1)}`, fill: snow });
    }
  } else if (kind === 'hills') {
    // Smooth rounded humps (quadratic curves), not jagged ridges.
    paths.push({ d: smoothHills(seed + 3, 60, 9, 6), fill: haze });
    paths.push({ d: smoothHills(seed + 6, 72, 13, 5), fill: back });
    paths.push({ d: smoothHills(seed + 9, 84, 15, 4), fill: front });
  } else if (kind === 'waves') {
    // Calm water: a flat sea, gentle smooth ripple bands, then a bright
    // horizon + sun-glint on top — reads as an ocean, not green hills.
    paths.push({ d: 'M0 60 L100 60 L100 101 L0 101 Z', fill: back }); // sea fill
    paths.push({ d: smoothHills(seed + 4, 70, 3, 14), fill: mix(back, front, 0.5) });
    paths.push({ d: smoothHills(seed + 7, 80, 3.5, 12), fill: front });
    paths.push({ d: smoothHills(seed + 11, 90, 3, 10), fill: mix(front, '#000000', 0.18) });
    rects.push({ x: 0, y: 59, w: 100, h: 1.4, fill: '#FFFFFF', opacity: 0.4 }); // horizon shimmer
    rects.push({ x: 58, y: 66, w: 24, h: 1.4, fill: '#FFFFFF', opacity: 0.28 });
    rects.push({ x: 62, y: 72, w: 16, h: 1.2, fill: '#FFFFFF', opacity: 0.2 });
    rects.push({ x: 64, y: 78, w: 11, h: 1, fill: '#FFFFFF', opacity: 0.15 });
  } else if (kind === 'space') {
    // stars
    for (let i = 0; i < 30; i++) {
      const s = 0.4 + noise(seed + 5, i) * 1.3;
      rects.push({ x: noise(7.1, i) * 100, y: noise(3.3, i) * 70, w: s, h: s, fill: '#FFFFFF', opacity: 0.85 });
    }
    // a planet with a ring
    circles.push({ cx: 26, cy: 30, r: 12, fill: front });
    circles.push({ cx: 26, cy: 30, r: 12.5, fill: mix(front, '#FFFFFF', 0.3), opacity: 0.25 });
    // distant ground band
    polys.push({ points: ridge(seed + 9, 88, 6, 6), fill: front });
  } else if (kind === 'city') {
    const baseY = 64;
    polys.push({ points: ridge(seed + 2, 58, 5, 10), fill: haze }); // distant skyline haze
    rects.push({ x: 0, y: baseY + 22, w: 100, h: 40, fill: front }); // ground
    const n = 8;
    const WIN = mix(front, '#FFE08A', 0.85);
    for (let i = 0; i < n; i++) {
      const bw = (100 / n) * (0.74 + noise(seed + 1, i) * 0.2);
      const bx = (i / n) * 100 + (100 / n - bw) / 2;
      const bh = 16 + noise(seed + 2, i) * 34;
      const topY = baseY - bh;
      const fill = i % 2 ? mix(front, back, 0.5) : front;
      rects.push({ x: bx, y: topY, w: bw, h: 101 - topY, fill });
      const rows = Math.min(5, Math.max(2, Math.floor(bh / 8)));
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < 2; c++) {
          if (noise(seed + i * 4 + 11, r * 2 + c) > 0.5) {
            rects.push({ x: bx + bw * (0.22 + c * 0.42), y: topY + 3 + r * 6, w: bw * 0.2, h: 2.6, fill: WIN, opacity: 0.9 });
          }
        }
      }
    }
  } else if (kind === 'forest') {
    const baseY = 66;
    polys.push({ points: ridge(seed + 2, 58, 7, 9), fill: haze });
    rects.push({ x: 0, y: baseY, w: 100, h: 40, fill: front }); // ground
    const n = 6;
    const trunk = mix(front, '#3A2414', 0.6);
    const c1 = back;
    const c2 = mix(back, '#FFFFFF', 0.18);
    for (let i = 0; i < n; i++) {
      const tx = (i / n) * 100 + (100 / n) * 0.5 + (noise(seed + 1, i) - 0.5) * 4;
      const size = 11 + noise(seed + 2, i) * 9;
      rects.push({ x: tx - 1.1, y: baseY - size * 0.45, w: 2.2, h: size * 0.6, fill: trunk });
      circles.push({ cx: tx, cy: baseY - size * 0.7, r: size * 0.62, fill: c1 });
      circles.push({ cx: tx - size * 0.22, cy: baseY - size * 0.85, r: size * 0.42, fill: c2, opacity: 0.9 });
    }
  } else if (kind === 'desert') {
    polys.push({ points: ridge(seed + 3, 62, 7, 7), fill: haze });
    polys.push({ points: ridge(seed + 6, 74, 9, 6), fill: back });
    polys.push({ points: ridge(seed + 9, 86, 8, 5), fill: front });
    // a cactus
    const cx = 72;
    const cac = mix(front, '#2E7D32', 0.55);
    rects.push({ x: cx, y: 70, w: 3, h: 22, fill: cac });
    rects.push({ x: cx - 5, y: 76, w: 5, h: 2.6, fill: cac });
    rects.push({ x: cx - 5, y: 70, w: 2.6, h: 8, fill: cac });
    rects.push({ x: cx + 3, y: 73, w: 5, h: 2.6, fill: cac });
    rects.push({ x: cx + 5.4, y: 67, w: 2.6, h: 8.6, fill: cac });
  }

  return { polys, rects, circles, paths };
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
    // Per-id hash seed (NOT id.length — same-length ids like "snow"/"fire"
    // would otherwise share a noise pattern and produce identical silhouettes,
    // which is exactly what made every background look the same).
    let h = 0;
    for (let i = 0; i < backgroundId!.length; i++) h = (h * 31 + backgroundId!.charCodeAt(i)) >>> 0;
    return buildGeo(scene.kind, (h % 997) + 1, scene.sky, scene.layers);
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
            {geo.paths.map((p, i) => (
              <Path key={`pa-${i}`} d={p.d} fill={p.fill} opacity={p.opacity ?? 1} />
            ))}
            {geo.polys.map((p, i) => (
              <Polygon key={`p-${i}`} points={p.points} fill={p.fill} />
            ))}
            {geo.rects.map((r, i) => (
              <Rect key={`r-${i}`} x={r.x} y={r.y} width={r.w} height={r.h} fill={r.fill} opacity={r.opacity ?? 1} />
            ))}
            {geo.circles.map((c, i) => (
              <Circle key={`c-${i}`} cx={c.cx} cy={c.cy} r={c.r} fill={c.fill} opacity={c.opacity ?? 1} />
            ))}
          </Svg>
          {/* Sun / moon — round RN View so it never squishes on wide cards.
              Hidden for city / space (planet) / forest where it doesn't fit. */}
          {scene.celestial && scene.kind !== 'space' && scene.kind !== 'city' ? (
            <View style={StyleSheet.absoluteFill} pointerEvents="none">
              <View style={{ position: 'absolute', left: '60%', top: '8%', width: '22%', aspectRatio: 1, borderRadius: 999, backgroundColor: scene.celestialColor, opacity: 0.22 }} />
              <View style={{ position: 'absolute', left: `${scene.celestial === 'moon' ? 66 : 64}%`, top: `${scene.celestial === 'moon' ? 13 : 12}%`, width: scene.celestial === 'moon' ? '13%' : '16%', aspectRatio: 1, borderRadius: 999, backgroundColor: scene.celestialColor, opacity: 0.95 }} />
            </View>
          ) : null}
        </>
      ) : null}
      {hasDrawing ? (
        <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
          {drawing!.flatMap((s, i) => brushLayers(s.brush).map((L, li) => (
            <Path key={`dr-${i}-${li}`} d={s.d} stroke={s.color} strokeWidth={s.w * L.widthMul} strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={L.opacity} strokeDasharray={L.dash} />
          )))}
        </Svg>
      ) : null}
    </View>
  );
}

export const HeaderLandscape = memo(HeaderLandscapeComponent);
