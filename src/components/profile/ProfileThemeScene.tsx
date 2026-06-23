/**
 * ProfileThemeScene
 * -----------------
 * The real, vector-drawn landscape behind a profile theme. Pure
 * `react-native-svg` (sky gradient + sun/moon, clouds/stars, layered hills or
 * sea+sand) — NO bitmap assets, NO animation, NO particles. That means:
 *   - it is owned/original art (Apple §3.3.4 safe — nothing to license);
 *   - it is GPU-cheap and static (max performance on weak devices);
 *   - it renders through a fixed `viewBox`, so the SAME component fills a
 *     full-screen background AND a tiny preview card and looks IDENTICAL —
 *     the Theme_Selection_Screen preview is therefore 1:1 with the live render.
 *
 * Scenes are intentionally clean, flat illustrations (matching the mockups)
 * rather than the previous cheesy snow/leaf particle gimmick, which has been
 * removed.
 */

import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, {
  Defs,
  LinearGradient as SvgGradient,
  Stop,
  Rect,
  Circle,
  Ellipse,
  Path,
} from 'react-native-svg';
import type { ProfileTheme, ProfileThemeId } from '../../theme/profileThemes';

// Fixed drawing space; `slice` makes it cover any aspect ratio like a photo.
const VB_W = 120;
const VB_H = 170;

interface SceneSpec {
  sky: [string, string];
  sun?: { color: string; cx: number; cy: number; r: number };
  moon?: { color: string; cx: number; cy: number; r: number };
  clouds?: boolean;
  stars?: boolean;
  /** Back→front hill fill colors (0–3). */
  hills?: string[];
  /** Beach mode: sea band + sand foreground. */
  sea?: string;
  sand?: string;
}

const SCENES: Record<ProfileThemeId, SceneSpec> = {
  'default-dark': {
    sky: ['#1C1C20', '#101013'],
    moon: { color: 'rgba(255,255,255,0.16)', cx: 96, cy: 30, r: 13 },
    stars: true,
    hills: ['#23232A', '#191920'],
  },
  spring: {
    sky: ['#CDEBF7', '#E9F6EA'],
    sun: { color: '#FFE7A0', cx: 96, cy: 32, r: 16 },
    clouds: true,
    hills: ['#A5D6A7', '#79C47C', '#4FA856'],
  },
  'summer-beach': {
    sky: ['#BFE9F2', '#FFE3CB'],
    sun: { color: '#FFD98A', cx: 95, cy: 30, r: 15 },
    clouds: true,
    sea: '#5FD0CF',
    sand: '#FBD9A8',
  },
  autumn: {
    sky: ['#F3CDA0', '#E89A4D'],
    sun: { color: '#FFE0B0', cx: 30, cy: 36, r: 14 },
    hills: ['#C9743C', '#9A4F26', '#5C2E0D'],
  },
  winter: {
    sky: ['#E7F4FE', '#9CCDF6'],
    sun: { color: 'rgba(255,255,255,0.85)', cx: 95, cy: 30, r: 14 },
    hills: ['#FFFFFF', '#E0F0FB', '#BBDDF5'],
  },
  'purple-pixel': {
    sky: ['#2A1A3D', '#5C4090'],
    moon: { color: '#E7D8FB', cx: 92, cy: 30, r: 12 },
    stars: true,
    hills: ['#5A3F86', '#3E2A63'],
  },
};

// Smooth layered hill silhouettes (back→front). Each is a closed path filling
// to the bottom of the viewBox.
const HILL_PATHS = [
  `M0,86 C30,70 64,98 120,80 L120,${VB_H} L0,${VB_H} Z`,
  `M0,108 C40,92 82,120 120,102 L120,${VB_H} L0,${VB_H} Z`,
  `M0,130 C34,116 88,140 120,122 L120,${VB_H} L0,${VB_H} Z`,
];

// A few decorative stars for night scenes (deterministic positions).
const STARS = [
  { x: 18, y: 24, r: 1.2 }, { x: 40, y: 14, r: 0.9 }, { x: 62, y: 30, r: 1.1 },
  { x: 78, y: 18, r: 0.8 }, { x: 28, y: 44, r: 0.9 }, { x: 54, y: 50, r: 1.0 },
  { x: 104, y: 52, r: 0.9 }, { x: 12, y: 64, r: 0.8 },
];

function SceneShapes({ id }: { id: ProfileThemeId }) {
  const s = SCENES[id];
  return (
    <>
      <Defs>
        <SvgGradient id={`sky-${id}`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={s.sky[0]} />
          <Stop offset="1" stopColor={s.sky[1]} />
        </SvgGradient>
      </Defs>
      <Rect x="0" y="0" width={VB_W} height={VB_H} fill={`url(#sky-${id})`} />

      {s.stars &&
        STARS.map((st, i) => (
          <Circle key={`st-${i}`} cx={st.x} cy={st.y} r={st.r} fill="rgba(255,255,255,0.85)" />
        ))}

      {s.moon && <Circle cx={s.moon.cx} cy={s.moon.cy} r={s.moon.r} fill={s.moon.color} />}
      {s.sun && <Circle cx={s.sun.cx} cy={s.sun.cy} r={s.sun.r} fill={s.sun.color} opacity={0.95} />}

      {s.clouds && (
        <>
          <Ellipse cx={26} cy={30} rx={17} ry={7} fill="rgba(255,255,255,0.75)" />
          <Ellipse cx={40} cy={34} rx={12} ry={6} fill="rgba(255,255,255,0.6)" />
          <Ellipse cx={70} cy={20} rx={13} ry={5.5} fill="rgba(255,255,255,0.55)" />
        </>
      )}

      {/* Beach: sea band + sand foreground. */}
      {s.sea && (
        <Path d={`M0,92 C30,86 92,100 120,90 L120,124 L0,124 Z`} fill={s.sea} />
      )}
      {s.sand && (
        <Path d={`M0,118 C40,108 84,126 120,114 L120,${VB_H} L0,${VB_H} Z`} fill={s.sand} />
      )}

      {/* Layered hills (back→front). */}
      {s.hills &&
        s.hills.map((color, i) => (
          <Path key={`h-${i}`} d={HILL_PATHS[i] ?? HILL_PATHS[HILL_PATHS.length - 1]} fill={color} />
        ))}
    </>
  );
}

interface ProfileThemeSceneProps {
  theme: ProfileTheme;
  style?: StyleProp<ViewStyle>;
}

/**
 * Absolute-fill (by default) vector scene for `theme`. Memoized — the scene is
 * fully static, so it only re-renders when the theme id changes.
 */
export const ProfileThemeScene = React.memo(function ProfileThemeScene({
  theme,
  style,
}: ProfileThemeSceneProps) {
  return (
    <View style={[StyleSheet.absoluteFill, style]} pointerEvents="none">
      <Svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="xMidYMid slice"
      >
        <SceneShapes id={theme.id} />
      </Svg>
    </View>
  );
}, (prev, next) => prev.theme.id === next.theme.id);

export default ProfileThemeScene;
