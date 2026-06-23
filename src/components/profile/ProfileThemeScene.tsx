/**
 * ProfileThemeScene
 * -----------------
 * The real, vector-drawn landscape behind a profile theme. Pure
 * `react-native-svg` — NO bitmap assets, NO animation, NO particles:
 *   - owned/original art (Apple §3.3.4 safe — nothing to license);
 *   - fully STATIC → GPU-cheap, max performance on weak devices;
 *   - drawn in a fixed `viewBox`, so the SAME component fills a full-screen
 *     background AND a tiny preview card and looks IDENTICAL — the
 *     Theme_Selection_Screen preview is therefore 1:1 with the live render.
 *
 * Each scene is a detailed flat illustration (sky + sun/moon, clouds/stars,
 * layered hills/mountains, trees, birds, sea, etc.) tuned per theme.
 */

import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, {
  Defs,
  LinearGradient as SvgGradient,
  RadialGradient,
  Stop,
  Rect,
  Circle,
  Ellipse,
  Path,
  Polygon,
  G,
} from 'react-native-svg';
import type { ProfileTheme, ProfileThemeId } from '../../theme/profileThemes';

// Fixed drawing space; `slice` covers any aspect ratio like a photo.
const VB_W = 120;
const VB_H = 170;

// ── Reusable scene atoms ────────────────────────────────────────────────────

function Cloud({ x, y, s = 1, o = 0.85 }: { x: number; y: number; s?: number; o?: number }) {
  return (
    <G opacity={o}>
      <Ellipse cx={x} cy={y} rx={11 * s} ry={5.5 * s} fill="#FFFFFF" />
      <Ellipse cx={x + 8 * s} cy={y + 1.5 * s} rx={8 * s} ry={4.5 * s} fill="#FFFFFF" />
      <Ellipse cx={x - 8 * s} cy={y + 2 * s} rx={7 * s} ry={4 * s} fill="#FFFFFF" />
    </G>
  );
}

function Bird({ x, y, s = 1, color = 'rgba(0,0,0,0.45)' }: { x: number; y: number; s?: number; color?: string }) {
  return (
    <Path
      d={`M${x},${y} q ${2.5 * s},${-2.5 * s} ${5 * s},0 q ${2.5 * s},${-2.5 * s} ${5 * s},0`}
      stroke={color}
      strokeWidth={1}
      fill="none"
      strokeLinecap="round"
    />
  );
}

function RoundTree({ x, baseY, r = 6, trunk = '#7A4A22', canopy = '#3E8E43' }: { x: number; baseY: number; r?: number; trunk?: string; canopy?: string }) {
  return (
    <G>
      <Rect x={x - 1} y={baseY - r * 0.7} width={2} height={r * 0.9} fill={trunk} />
      <Circle cx={x} cy={baseY - r} r={r} fill={canopy} />
      <Circle cx={x - r * 0.5} cy={baseY - r * 0.7} r={r * 0.7} fill={canopy} />
      <Circle cx={x + r * 0.5} cy={baseY - r * 0.7} r={r * 0.7} fill={canopy} />
    </G>
  );
}

function PineTree({ x, baseY, h = 14, w = 9, color = '#2F6B33', snow = false }: { x: number; baseY: number; h?: number; w?: number; color?: string; snow?: boolean }) {
  const tiers = [0, 1, 2];
  return (
    <G>
      <Rect x={x - 0.9} y={baseY - 2} width={1.8} height={3} fill="#5A3A1E" />
      {tiers.map((i) => {
        const top = baseY - 2 - h * (1 - i * 0.28);
        const bot = baseY - 2 - h * (0.5 - i * 0.28);
        const hw = (w / 2) * (1 - i * 0.22);
        return (
          <G key={i}>
            <Polygon points={`${x - hw},${bot} ${x + hw},${bot} ${x},${top}`} fill={color} />
            {snow && (
              <Polygon points={`${x - hw * 0.6},${bot - (bot - top) * 0.45} ${x + hw * 0.6},${bot - (bot - top) * 0.45} ${x},${top}`} fill="rgba(255,255,255,0.85)" />
            )}
          </G>
        );
      })}
    </G>
  );
}

function Star({ x, y, r = 1 }: { x: number; y: number; r?: number }) {
  return <Circle cx={x} cy={y} r={r} fill="rgba(255,255,255,0.9)" />;
}

function Sun({ cx, cy, r, core, halo }: { cx: number; cy: number; r: number; core: string; halo: string }) {
  return (
    <G>
      <Circle cx={cx} cy={cy} r={r * 1.9} fill={halo} opacity={0.35} />
      <Circle cx={cx} cy={cy} r={r * 1.4} fill={halo} opacity={0.35} />
      <Circle cx={cx} cy={cy} r={r} fill={core} />
    </G>
  );
}

function Sky({ id, from, to }: { id: string; from: string; to: string }) {
  return (
    <>
      <Defs>
        <SvgGradient id={`sky-${id}`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={from} />
          <Stop offset="1" stopColor={to} />
        </SvgGradient>
      </Defs>
      <Rect x="0" y="0" width={VB_W} height={VB_H} fill={`url(#sky-${id})`} />
    </>
  );
}

const BOT = VB_H;

// ── Per-theme scenes ────────────────────────────────────────────────────────

function SpringScene() {
  return (
    <>
      <Sky id="spring" from="#BFE3F5" to="#EAF7E9" />
      <Sun cx={99} cy={28} r={13} core="#FFE57A" halo="#FFF3C4" />
      <Cloud x={30} y={26} s={1} o={0.9} />
      <Cloud x={66} y={18} s={0.8} o={0.8} />
      <Bird x={44} y={40} s={1} />
      <Bird x={58} y={36} s={0.8} />
      <Bird x={72} y={44} s={0.9} />
      {/* layered rolling hills */}
      <Path d={`M0,96 C30,80 64,104 120,86 L120,${BOT} L0,${BOT} Z`} fill="#BCE2AE" />
      <Path d={`M0,116 C40,100 84,124 120,106 L120,${BOT} L0,${BOT} Z`} fill="#86C97E" />
      <Path d={`M0,138 C34,124 88,146 120,128 L120,${BOT} L0,${BOT} Z`} fill="#57AC57" />
      {/* trees + flowers on the front hill */}
      <RoundTree x={22} baseY={150} r={7} canopy="#3F9447" />
      <RoundTree x={96} baseY={152} r={6} canopy="#479A4E" />
      {[14, 40, 58, 74, 104].map((fx, i) => (
        <Circle key={i} cx={fx} cy={150 + (i % 2) * 6} r={1.4} fill={['#FF6F91', '#FFD93D', '#FFFFFF', '#FF6F91', '#FFD93D'][i]} />
      ))}
    </>
  );
}

function BeachScene() {
  return (
    <>
      <Sky id="beach" from="#BFE9F2" to="#FFE3CB" />
      <Sun cx={92} cy={30} r={12} core="#FFD27A" halo="#FFE9B8" />
      <Cloud x={32} y={24} s={0.9} o={0.85} />
      <Bird x={20} y={40} s={0.9} color="rgba(90,70,60,0.5)" />
      <Bird x={34} y={46} s={0.8} color="rgba(90,70,60,0.5)" />
      {/* sea + wave lines + sun reflection */}
      <Path d={`M0,90 C30,84 92,98 120,88 L120,124 L0,124 Z`} fill="#54C7C6" />
      <Path d={`M0,100 C30,96 92,108 120,99`} stroke="rgba(255,255,255,0.5)" strokeWidth={1} fill="none" />
      <Path d={`M0,112 C40,108 90,118 120,110`} stroke="rgba(255,255,255,0.35)" strokeWidth={1} fill="none" />
      <Rect x={88} y={90} width={8} height={30} fill="rgba(255,255,255,0.25)" />
      {/* sand */}
      <Path d={`M0,118 C40,108 84,126 120,114 L120,${BOT} L0,${BOT} Z`} fill="#FBD9A8" />
      {/* palm */}
      <G>
        <Path d="M30,150 C29,140 31,134 30,128" stroke="#7A5230" strokeWidth={2.2} fill="none" />
        <Path d="M30,128 C22,124 16,126 12,130" stroke="#3E8E43" strokeWidth={2} fill="none" />
        <Path d="M30,128 C38,123 46,125 51,129" stroke="#3E8E43" strokeWidth={2} fill="none" />
        <Path d="M30,128 C24,121 24,116 26,112" stroke="#46974B" strokeWidth={2} fill="none" />
        <Path d="M30,128 C36,121 38,117 40,113" stroke="#46974B" strokeWidth={2} fill="none" />
      </G>
      {/* starfish + shells */}
      <Polygon points="92,150 94,155 99,155 95,158 97,163 92,160 87,163 89,158 85,155 90,155" fill="#FF8A65" />
      <Ellipse cx={70} cy={158} rx={3} ry={2} fill="#FFFFFF" opacity={0.8} />
      <Ellipse cx={108} cy={160} rx={2.5} ry={1.8} fill="#FFE0B2" />
    </>
  );
}

function AutumnScene() {
  return (
    <>
      <Sky id="autumn" from="#F6D2A6" to="#E79A4D" />
      <Sun cx={28} cy={34} r={12} core="#FFE0A8" halo="#FFEFD0" />
      <Bird x={66} y={30} s={1} color="rgba(70,40,20,0.55)" />
      <Bird x={80} y={26} s={0.8} color="rgba(70,40,20,0.55)" />
      <Path d={`M0,94 C30,80 64,102 120,86 L120,${BOT} L0,${BOT} Z`} fill="#D08A4E" />
      <Path d={`M0,116 C40,102 84,124 120,108 L120,${BOT} L0,${BOT} Z`} fill="#9A4F26" />
      <Path d={`M0,138 C34,126 88,146 120,130 L120,${BOT} L0,${BOT} Z`} fill="#5C2E0D" />
      {/* autumn trees */}
      <RoundTree x={24} baseY={150} r={7} canopy="#C75B2A" trunk="#5A3A1E" />
      <RoundTree x={92} baseY={152} r={6} canopy="#E0892F" trunk="#5A3A1E" />
      <PineTree x={56} baseY={146} h={16} w={11} color="#7A3F1C" />
      {/* scattered static leaves */}
      {[[14, 70], [44, 56], [74, 50], [100, 66], [34, 88], [88, 92]].map(([lx, ly], i) => (
        <Ellipse key={i} cx={lx} cy={ly} rx={2.2} ry={1.2} fill={['#E0892F', '#C75B2A', '#B8431E'][i % 3]} transform={`rotate(${i * 40} ${lx} ${ly})`} />
      ))}
    </>
  );
}

function WinterScene() {
  return (
    <>
      <Sky id="winter" from="#E9F5FE" to="#9CCDF6" />
      <Sun cx={94} cy={28} r={12} core="rgba(255,255,255,0.95)" halo="#FFFFFF" />
      <Cloud x={30} y={24} s={0.9} o={0.7} />
      {/* distant mountains with snow caps */}
      <Polygon points={`0,104 26,72 52,104`} fill="#8FB7D8" />
      <Polygon points={`18,72 26,72 34,84 10,84`} fill="#FFFFFF" />
      <Polygon points={`40,104 70,66 100,104`} fill="#A8C9E6" />
      <Polygon points={`62,66 70,66 80,82 52,82`} fill="#FFFFFF" />
      {/* snow hills */}
      <Path d={`M0,108 C40,96 84,120 120,104 L120,${BOT} L0,${BOT} Z`} fill="#E6F2FC" />
      <Path d={`M0,130 C34,120 88,142 120,126 L120,${BOT} L0,${BOT} Z`} fill="#FFFFFF" />
      {/* snowy pines */}
      <PineTree x={22} baseY={150} h={16} w={11} color="#2F6B4A" snow />
      <PineTree x={40} baseY={156} h={13} w={9} color="#2F6B4A" snow />
      <PineTree x={98} baseY={152} h={15} w={10} color="#2F6B4A" snow />
      {/* a few faint STATIC snow flecks (no animation) */}
      {[[16, 50], [54, 40], [82, 56], [108, 44], [36, 64]].map(([sx, sy], i) => (
        <Circle key={i} cx={sx} cy={sy} r={1} fill="rgba(255,255,255,0.85)" />
      ))}
    </>
  );
}

function PixelScene() {
  return (
    <>
      <Defs>
        <RadialGradient id="moonglow" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor="#E7D8FB" stopOpacity="0.5" />
          <Stop offset="1" stopColor="#E7D8FB" stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Sky id="pixel" from="#241538" to="#5C4090" />
      {/* starfield */}
      {[[12, 18], [26, 30], [40, 14], [54, 26], [68, 12], [82, 28], [96, 16], [108, 34], [18, 48], [44, 44], [74, 52], [100, 54], [34, 62], [60, 60], [90, 66]].map(([sx, sy], i) => (
        <Star key={i} x={sx} y={sy} r={i % 3 === 0 ? 1.2 : 0.8} />
      ))}
      {/* shooting star */}
      <Path d="M70,22 L82,16" stroke="rgba(255,255,255,0.7)" strokeWidth={1} strokeLinecap="round" />
      {/* moon with glow + craters */}
      <Circle cx={92} cy={30} r={20} fill="url(#moonglow)" />
      <Circle cx={92} cy={30} r={11} fill="#EDE3FB" />
      <Circle cx={88} cy={27} r={2} fill="#D6C4F0" />
      <Circle cx={95} cy={33} r={2.6} fill="#D6C4F0" />
      <Circle cx={94} cy={25} r={1.4} fill="#D6C4F0" />
      {/* distant purple mountains */}
      <Path d={`M0,110 C30,86 64,116 120,92 L120,${BOT} L0,${BOT} Z`} fill="#553C82" />
      <Path d={`M0,134 C34,118 88,144 120,124 L120,${BOT} L0,${BOT} Z`} fill="#3A2860" />
    </>
  );
}

function DefaultScene() {
  return (
    <>
      <Defs>
        <RadialGradient id="dglow" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.10" />
          <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </RadialGradient>
        <SvgGradient id="sky-default" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#1C1C20" />
          <Stop offset="1" stopColor="#0F0F12" />
        </SvgGradient>
      </Defs>
      <Rect x="0" y="0" width={VB_W} height={VB_H} fill="url(#sky-default)" />
      <Circle cx={96} cy={30} r={26} fill="url(#dglow)" />
      <Circle cx={96} cy={30} r={12} fill="rgba(255,255,255,0.16)" />
      {[[14, 24], [40, 16], [62, 30], [78, 20], [28, 44], [54, 50], [104, 52], [12, 64], [88, 60]].map(([sx, sy], i) => (
        <Circle key={i} cx={sx} cy={sy} r={i % 2 ? 0.7 : 1} fill="rgba(255,255,255,0.5)" />
      ))}
      <Path d={`M0,112 C30,98 64,118 120,104 L120,${BOT} L0,${BOT} Z`} fill="#23232B" />
      <Path d={`M0,136 C34,124 88,146 120,130 L120,${BOT} L0,${BOT} Z`} fill="#17171D" />
    </>
  );
}

function SceneFor(id: ProfileThemeId) {
  switch (id) {
    case 'spring':
      return <SpringScene />;
    case 'summer-beach':
      return <BeachScene />;
    case 'autumn':
      return <AutumnScene />;
    case 'winter':
      return <WinterScene />;
    case 'purple-pixel':
      return <PixelScene />;
    case 'default-dark':
    default:
      return <DefaultScene />;
  }
}

interface ProfileThemeSceneProps {
  theme: ProfileTheme;
  style?: StyleProp<ViewStyle>;
}

/**
 * Absolute-fill (by default) vector scene for `theme`. Memoized — fully static,
 * so it only re-renders when the theme id changes.
 */
export const ProfileThemeScene = React.memo(
  function ProfileThemeScene({ theme, style }: ProfileThemeSceneProps) {
    return (
      <View style={[StyleSheet.absoluteFill, style]} pointerEvents="none">
        <Svg width="100%" height="100%" viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="xMidYMid slice">
          {SceneFor(theme.id)}
        </Svg>
      </View>
    );
  },
  (prev, next) => prev.theme.id === next.theme.id,
);

export default ProfileThemeScene;
