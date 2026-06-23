/**
 * ProfileThemeScene
 * -----------------
 * The real, vector-drawn landscape behind a profile theme. Pure
 * `react-native-svg` — NO bitmap assets, NO animation, NO particles:
 *   - owned/original art (Apple §3.3.4 safe — nothing to license);
 *   - fully STATIC → GPU-cheap, max performance on weak devices;
 *   - drawn in a fixed `viewBox`, so the SAME component fills a full-screen
 *     background AND a tiny preview card and looks IDENTICAL (preview is 1:1).
 *
 * Each theme is a detailed flat-illustration scene.
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
  Line,
  G,
} from 'react-native-svg';
import type { ProfileTheme, ProfileThemeId } from '../../theme/profileThemes';

const VB_W = 120;
const VB_H = 170;
const BOT = VB_H;

// ── Reusable atoms ──────────────────────────────────────────────────────────

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

function Sun({ cx, cy, r, core, halo }: { cx: number; cy: number; r: number; core: string; halo: string }) {
  return (
    <G>
      <Circle cx={cx} cy={cy} r={r * 1.9} fill={halo} opacity={0.3} />
      <Circle cx={cx} cy={cy} r={r * 1.35} fill={halo} opacity={0.35} />
      <Circle cx={cx} cy={cy} r={r} fill={core} />
    </G>
  );
}

function Cloud({ x, y, s = 1, o = 0.85, color = '#FFFFFF' }: { x: number; y: number; s?: number; o?: number; color?: string }) {
  return (
    <G opacity={o}>
      <Ellipse cx={x} cy={y} rx={11 * s} ry={5.5 * s} fill={color} />
      <Ellipse cx={x + 8 * s} cy={y + 1.5 * s} rx={8 * s} ry={4.5 * s} fill={color} />
      <Ellipse cx={x - 8 * s} cy={y + 2 * s} rx={7 * s} ry={4 * s} fill={color} />
    </G>
  );
}

function Bird({ x, y, s = 1, color = 'rgba(0,0,0,0.45)' }: { x: number; y: number; s?: number; color?: string }) {
  return (
    <Path d={`M${x},${y} q ${2.5 * s},${-2.5 * s} ${5 * s},0 q ${2.5 * s},${-2.5 * s} ${5 * s},0`} stroke={color} strokeWidth={1} fill="none" strokeLinecap="round" />
  );
}

function Star({ x, y, r = 1, color = 'rgba(255,255,255,0.9)' }: { x: number; y: number; r?: number; color?: string }) {
  return <Circle cx={x} cy={y} r={r} fill={color} />;
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
            {snow && <Polygon points={`${x - hw * 0.6},${bot - (bot - top) * 0.45} ${x + hw * 0.6},${bot - (bot - top) * 0.45} ${x},${top}`} fill="rgba(255,255,255,0.85)" />}
          </G>
        );
      })}
    </G>
  );
}

function Mountain({ x, baseY, w, h, color, snow = true }: { x: number; baseY: number; w: number; h: number; color: string; snow?: boolean }) {
  const left = x - w / 2;
  const right = x + w / 2;
  const peakY = baseY - h;
  return (
    <G>
      <Polygon points={`${left},${baseY} ${x},${peakY} ${right},${baseY}`} fill={color} />
      {snow && <Polygon points={`${x - w * 0.16},${peakY + h * 0.22} ${x + w * 0.16},${peakY + h * 0.22} ${x},${peakY}`} fill="#FFFFFF" />}
    </G>
  );
}

function MoonGlow({ id, cx, cy, r, glow = '#FFFFFF', body = '#EDE3FB', craters = true }: { id: string; cx: number; cy: number; r: number; glow?: string; body?: string; craters?: boolean }) {
  return (
    <G>
      <Defs>
        <RadialGradient id={`moon-${id}`} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={glow} stopOpacity="0.5" />
          <Stop offset="1" stopColor={glow} stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Circle cx={cx} cy={cy} r={r * 1.9} fill={`url(#moon-${id})`} />
      <Circle cx={cx} cy={cy} r={r} fill={body} />
      {craters && (
        <>
          <Circle cx={cx - r * 0.35} cy={cy - r * 0.25} r={r * 0.18} fill="rgba(0,0,0,0.08)" />
          <Circle cx={cx + r * 0.3} cy={cy + r * 0.3} r={r * 0.24} fill="rgba(0,0,0,0.08)" />
          <Circle cx={cx + r * 0.15} cy={cy - r * 0.4} r={r * 0.12} fill="rgba(0,0,0,0.08)" />
        </>
      )}
    </G>
  );
}

const STARFIELD = [
  [12, 18], [26, 30], [40, 14], [54, 26], [68, 12], [82, 28], [96, 16], [108, 34],
  [18, 48], [44, 44], [74, 52], [100, 54], [34, 62], [60, 60], [90, 66], [50, 16],
];

// ── Scenes ──────────────────────────────────────────────────────────────────

function SpringScene() {
  return (
    <>
      <Sky id="spring" from="#BFE3F5" to="#EAF7E9" />
      <Sun cx={99} cy={28} r={13} core="#FFE57A" halo="#FFF3C4" />
      <Cloud x={30} y={26} o={0.9} />
      <Cloud x={66} y={18} s={0.8} o={0.8} />
      <Cloud x={92} y={50} s={0.7} o={0.7} />
      <Bird x={44} y={40} /><Bird x={58} y={36} s={0.8} /><Bird x={72} y={44} s={0.9} />
      <Path d={`M0,96 C30,80 64,104 120,86 L120,${BOT} L0,${BOT} Z`} fill="#BCE2AE" />
      <Path d={`M0,116 C40,100 84,124 120,106 L120,${BOT} L0,${BOT} Z`} fill="#86C97E" />
      <Path d={`M0,138 C34,124 88,146 120,128 L120,${BOT} L0,${BOT} Z`} fill="#57AC57" />
      <RoundTree x={22} baseY={150} r={7} canopy="#3F9447" />
      <RoundTree x={96} baseY={152} r={6} canopy="#479A4E" />
      <RoundTree x={62} baseY={158} r={5} canopy="#52A356" />
      {[14, 40, 58, 74, 104, 88].map((fx, i) => (
        <Circle key={i} cx={fx} cy={150 + (i % 2) * 7} r={1.4} fill={['#FF6F91', '#FFD93D', '#FFFFFF', '#FF6F91', '#FFD93D', '#FFFFFF'][i]} />
      ))}
    </>
  );
}

function BeachScene() {
  return (
    <>
      <Sky id="beach" from="#BFE9F2" to="#FFE3CB" />
      <Sun cx={92} cy={30} r={12} core="#FFD27A" halo="#FFE9B8" />
      <Cloud x={32} y={24} s={0.9} />
      <Cloud x={70} y={16} s={0.7} o={0.75} />
      <Bird x={20} y={40} s={0.9} color="rgba(90,70,60,0.5)" /><Bird x={34} y={46} s={0.8} color="rgba(90,70,60,0.5)" />
      <Path d={`M0,90 C30,84 92,98 120,88 L120,124 L0,124 Z`} fill="#54C7C6" />
      <Path d={`M0,100 C30,96 92,108 120,99`} stroke="rgba(255,255,255,0.5)" strokeWidth={1} fill="none" />
      <Path d={`M0,112 C40,108 90,118 120,110`} stroke="rgba(255,255,255,0.35)" strokeWidth={1} fill="none" />
      <Rect x={88} y={90} width={8} height={30} fill="rgba(255,255,255,0.25)" />
      <Path d={`M0,118 C40,108 84,126 120,114 L120,${BOT} L0,${BOT} Z`} fill="#FBD9A8" />
      <G>
        <Path d="M30,150 C29,140 31,134 30,128" stroke="#7A5230" strokeWidth={2.2} fill="none" />
        <Path d="M30,128 C22,124 16,126 12,130" stroke="#3E8E43" strokeWidth={2} fill="none" />
        <Path d="M30,128 C38,123 46,125 51,129" stroke="#3E8E43" strokeWidth={2} fill="none" />
        <Path d="M30,128 C24,121 24,116 26,112" stroke="#46974B" strokeWidth={2} fill="none" />
        <Path d="M30,128 C36,121 38,117 40,113" stroke="#46974B" strokeWidth={2} fill="none" />
      </G>
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
      <Bird x={66} y={30} color="rgba(70,40,20,0.55)" /><Bird x={80} y={26} s={0.8} color="rgba(70,40,20,0.55)" />
      <Path d={`M0,94 C30,80 64,102 120,86 L120,${BOT} L0,${BOT} Z`} fill="#D08A4E" />
      <Path d={`M0,116 C40,102 84,124 120,108 L120,${BOT} L0,${BOT} Z`} fill="#9A4F26" />
      <Path d={`M0,138 C34,126 88,146 120,130 L120,${BOT} L0,${BOT} Z`} fill="#5C2E0D" />
      <RoundTree x={24} baseY={150} r={7} canopy="#C75B2A" trunk="#5A3A1E" />
      <RoundTree x={92} baseY={152} r={6} canopy="#E0892F" trunk="#5A3A1E" />
      <PineTree x={56} baseY={146} h={16} w={11} color="#7A3F1C" />
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
      <Mountain x={26} baseY={104} w={52} h={32} color="#8FB7D8" />
      <Mountain x={70} baseY={104} w={60} h={38} color="#A8C9E6" />
      <Path d={`M0,108 C40,96 84,120 120,104 L120,${BOT} L0,${BOT} Z`} fill="#E6F2FC" />
      <Path d={`M0,130 C34,120 88,142 120,126 L120,${BOT} L0,${BOT} Z`} fill="#FFFFFF" />
      <PineTree x={22} baseY={150} h={16} w={11} color="#2F6B4A" snow />
      <PineTree x={40} baseY={156} h={13} w={9} color="#2F6B4A" snow />
      <PineTree x={98} baseY={152} h={15} w={10} color="#2F6B4A" snow />
      {[[16, 50], [54, 40], [82, 56], [108, 44], [36, 64]].map(([sx, sy], i) => (
        <Circle key={i} cx={sx} cy={sy} r={1} fill="rgba(255,255,255,0.85)" />
      ))}
    </>
  );
}

function PixelScene() {
  return (
    <>
      <Sky id="pixel" from="#241538" to="#5C4090" />
      {STARFIELD.map(([sx, sy], i) => <Star key={i} x={sx} y={sy} r={i % 3 === 0 ? 1.2 : 0.8} />)}
      <Path d="M70,22 L82,16" stroke="rgba(255,255,255,0.7)" strokeWidth={1} strokeLinecap="round" />
      <MoonGlow id="pixel" cx={92} cy={30} r={11} glow="#E7D8FB" body="#EDE3FB" />
      <Path d={`M0,110 C30,86 64,116 120,92 L120,${BOT} L0,${BOT} Z`} fill="#553C82" />
      <Path d={`M0,134 C34,118 88,144 120,124 L120,${BOT} L0,${BOT} Z`} fill="#3A2860" />
      {/* pixel sparkles */}
      {[[20, 120], [50, 132], [86, 126]].map(([px, py], i) => (
        <Rect key={i} x={px} y={py} width={2} height={2} fill="rgba(255,255,255,0.4)" />
      ))}
    </>
  );
}

function DefaultScene() {
  return (
    <>
      <Defs>
        <SvgGradient id="sky-default" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#1C1C20" />
          <Stop offset="1" stopColor="#0F0F12" />
        </SvgGradient>
      </Defs>
      <Rect x="0" y="0" width={VB_W} height={VB_H} fill="url(#sky-default)" />
      <MoonGlow id="default" cx={96} cy={30} r={12} glow="#FFFFFF" body="rgba(255,255,255,0.22)" craters={false} />
      {STARFIELD.slice(0, 9).map(([sx, sy], i) => <Star key={i} x={sx} y={sy} r={i % 2 ? 0.7 : 1} color="rgba(255,255,255,0.5)" />)}
      <Path d={`M0,112 C30,98 64,118 120,104 L120,${BOT} L0,${BOT} Z`} fill="#23232B" />
      <Path d={`M0,136 C34,124 88,146 120,130 L120,${BOT} L0,${BOT} Z`} fill="#17171D" />
    </>
  );
}

function NightScene() {
  return (
    <>
      <Sky id="night" from="#0B1E3D" to="#2E5A8F" />
      {STARFIELD.map(([sx, sy], i) => <Star key={i} x={sx} y={sy} r={i % 4 === 0 ? 1.3 : 0.8} />)}
      <MoonGlow id="night" cx={90} cy={30} r={13} glow="#CFE0FF" body="#EAF2FF" />
      <Path d="M58,20 L70,14" stroke="rgba(255,255,255,0.6)" strokeWidth={0.8} strokeLinecap="round" />
      <Path d={`M0,116 C30,100 64,122 120,104 L120,${BOT} L0,${BOT} Z`} fill="#163058" />
      <Path d={`M0,138 C34,126 88,146 120,130 L120,${BOT} L0,${BOT} Z`} fill="#0C2142" />
      {/* fireflies */}
      {[[20, 150], [44, 156], [70, 150], [100, 158], [56, 162]].map(([fx, fy], i) => (
        <Circle key={i} cx={fx} cy={fy} r={1.2} fill="#FFE9A8" opacity={0.9} />
      ))}
    </>
  );
}

function SunsetScene() {
  return (
    <>
      <Sky id="sunset" from="#FFC18A" to="#7A4A86" />
      <Cloud x={30} y={24} s={1} o={0.55} color="#FFD7C0" />
      <Cloud x={80} y={18} s={0.8} o={0.5} color="#F7C2C8" />
      {/* big setting sun on the horizon */}
      <Circle cx={60} cy={92} r={30} fill="#FF8A5C" opacity={0.25} />
      <Circle cx={60} cy={92} r={19} fill="#FF7043" />
      <Bird x={30} y={48} color="rgba(60,30,50,0.5)" /><Bird x={44} y={42} s={0.8} color="rgba(60,30,50,0.5)" />
      {/* sea with sun reflection */}
      <Path d={`M0,98 L120,98 L120,${BOT} L0,${BOT} Z`} fill="#9C5A7E" />
      <Rect x={54} y={98} width={12} height={60} fill="rgba(255,140,90,0.4)" />
      <Path d="M0,110 C40,106 92,116 120,108" stroke="rgba(255,200,170,0.4)" strokeWidth={1} fill="none" />
      {/* dark foreground hill */}
      <Path d={`M0,136 C40,124 84,144 120,130 L120,${BOT} L0,${BOT} Z`} fill="#3A2440" />
    </>
  );
}

function OceanScene() {
  return (
    <>
      <Sky id="ocean" from="#CDEFFF" to="#9FD8F2" />
      <Sun cx={96} cy={28} r={11} core="#FFF4C2" halo="#FFFBE0" />
      <Cloud x={28} y={24} s={0.9} />
      <Cloud x={66} y={18} s={0.7} o={0.8} />
      <Bird x={20} y={40} s={0.9} color="rgba(40,80,110,0.5)" /><Bird x={36} y={46} s={0.8} color="rgba(40,80,110,0.5)" />
      {/* sea */}
      <Path d={`M0,86 L120,86 L120,${BOT} L0,${BOT} Z`} fill="#3FA9DA" />
      <Path d={`M0,86 C30,80 92,94 120,84 L120,110 L0,110 Z`} fill="#5FC0E8" />
      {[96, 108, 120, 132, 144].map((wy, i) => (
        <Path key={i} d={`M0,${wy} C30,${wy - 4} 90,${wy + 5} 120,${wy - 3}`} stroke="rgba(255,255,255,0.35)" strokeWidth={1} fill="none" />
      ))}
      {/* sailboat */}
      <G>
        <Polygon points="58,92 58,76 72,92" fill="#FFFFFF" />
        <Polygon points="56,92 56,80 48,92" fill="#E8F4FB" />
        <Path d="M48,92 L74,92 L70,98 L52,98 Z" fill="#C0392B" />
        <Line x1={58} y1={76} x2={58} y2={92} stroke="#7A5230" strokeWidth={1} />
      </G>
    </>
  );
}

function DesertScene() {
  return (
    <>
      <Sky id="desert" from="#FCE8BE" to="#E89A52" />
      <Sun cx={92} cy={32} r={13} core="#FFE08A" halo="#FFF0C4" />
      <Cloud x={34} y={22} s={0.7} o={0.5} color="#FFF0D8" />
      {/* pyramids */}
      <Polygon points={`6,118 30,84 54,118`} fill="#D9A05B" />
      <Polygon points={`44,118 64,92 84,118`} fill="#C98C46" />
      {/* dunes */}
      <Path d={`M0,116 C40,104 84,124 120,110 L120,${BOT} L0,${BOT} Z`} fill="#F4C56E" />
      <Path d={`M0,138 C34,128 88,148 120,132 L120,${BOT} L0,${BOT} Z`} fill="#DC8A3C" />
      {/* cacti */}
      <G>
        <Rect x={22} y={140} width={5} height={20} rx={2.5} fill="#3E8E43" />
        <Rect x={16} y={146} width={4} height={9} rx={2} fill="#3E8E43" />
        <Rect x={16} y={146} width={9} height={4} rx={2} fill="#3E8E43" />
        <Rect x={27} y={143} width={4} height={9} rx={2} fill="#3E8E43" />
        <Rect x={24} y={143} width={9} height={4} rx={2} fill="#3E8E43" />
      </G>
      <Rect x={98} y={148} width={4} height={14} rx={2} fill="#3E8E43" />
    </>
  );
}

function ForestScene() {
  return (
    <>
      <Sky id="forest" from="#CFE9C7" to="#9FD08C" />
      <Sun cx={92} cy={28} r={10} core="#FFF6C8" halo="#FFFBE0" />
      {/* sun rays */}
      {[[92, 28, 70, 70], [92, 28, 100, 76], [92, 28, 84, 78]].map(([x1, y1, x2, y2], i) => (
        <Line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(255,255,255,0.25)" strokeWidth={2} />
      ))}
      {/* mist bands */}
      <Rect x={0} y={92} width={VB_W} height={8} fill="rgba(255,255,255,0.25)" />
      {/* dense pines, back→front */}
      <Path d={`M0,96 C40,86 84,104 120,92 L120,${BOT} L0,${BOT} Z`} fill="#5E9A57" />
      {[10, 26, 42, 58, 74, 90, 106].map((px, i) => <PineTree key={`b${i}`} x={px} baseY={120} h={18} w={12} color="#3E7E3F" />)}
      {[2, 18, 34, 50, 66, 82, 98, 114].map((px, i) => <PineTree key={`f${i}`} x={px} baseY={150} h={24} w={16} color="#27531F" />)}
    </>
  );
}

function SakuraScene() {
  return (
    <>
      <Sky id="sakura" from="#FFE9F0" to="#F7B9CF" />
      <Sun cx={94} cy={28} r={11} core="#FFF1C8" halo="#FFF6E2" />
      <Cloud x={30} y={22} s={0.8} o={0.7} color="#FFF0F4" />
      <Bird x={64} y={34} s={0.8} color="rgba(120,60,90,0.4)" />
      <Path d={`M0,118 C40,106 84,126 120,112 L120,${BOT} L0,${BOT} Z`} fill="#9FCD7A" />
      <Path d={`M0,140 C34,130 88,150 120,134 L120,${BOT} L0,${BOT} Z`} fill="#7FB86A" />
      {/* cherry trees: trunk + blossom clusters */}
      {[[24, 150], [96, 152]].map(([tx, by], i) => (
        <G key={i}>
          <Path d={`M${tx},${by} C${tx - 1},${by - 12} ${tx + 1},${by - 16} ${tx},${by - 22}`} stroke="#6E4A30" strokeWidth={2.4} fill="none" />
          {[[0, -26], [-7, -22], [7, -22], [-4, -30], [5, -30]].map(([dx, dy], j) => (
            <Circle key={j} cx={tx + dx} cy={by + dy} r={5} fill={['#FBC4D6', '#F7A8C4', '#FFD3E2'][j % 3]} />
          ))}
        </G>
      ))}
      {/* falling petals (static) */}
      {[[14, 60], [40, 50], [70, 64], [104, 56], [54, 80], [88, 86]].map(([px, py], i) => (
        <Ellipse key={i} cx={px} cy={py} rx={2} ry={1.1} fill="#F7A8C4" transform={`rotate(${i * 35} ${px} ${py})`} />
      ))}
    </>
  );
}

function AuroraScene() {
  return (
    <>
      <Sky id="aurora" from="#06121F" to="#123048" />
      {STARFIELD.slice(0, 12).map(([sx, sy], i) => <Star key={i} x={sx} y={sy} r={0.8} />)}
      {/* aurora bands */}
      <Path d="M-10,46 C30,20 80,60 130,30" stroke="#5FE0B0" strokeWidth={7} fill="none" opacity={0.35} strokeLinecap="round" />
      <Path d="M-10,58 C34,34 86,70 130,42" stroke="#7FE0C8" strokeWidth={5} fill="none" opacity={0.3} strokeLinecap="round" />
      <Path d="M-10,50 C40,30 90,64 130,36" stroke="#A07FE0" strokeWidth={4} fill="none" opacity={0.28} strokeLinecap="round" />
      <MoonGlow id="aurora" cx={102} cy={26} r={7} glow="#CFFBEA" body="#EAFDF5" craters={false} />
      {/* snowy hills + silhouettes */}
      <Path d={`M0,116 C40,104 84,126 120,110 L120,${BOT} L0,${BOT} Z`} fill="#16404A" />
      <Path d={`M0,136 C34,126 88,146 120,130 L120,${BOT} L0,${BOT} Z`} fill="#0C2A33" />
      <PineTree x={20} baseY={150} h={15} w={10} color="#08222A" />
      <PineTree x={40} baseY={156} h={12} w={8} color="#08222A" />
      <PineTree x={100} baseY={152} h={14} w={9} color="#08222A" />
    </>
  );
}

function CityScene() {
  return (
    <>
      <Sky id="city" from="#16203A" to="#4E5E96" />
      {STARFIELD.slice(0, 8).map(([sx, sy], i) => <Star key={i} x={sx} y={sy} r={0.8} />)}
      <MoonGlow id="city" cx={96} cy={26} r={9} glow="#FFE9B8" body="#FFF3D6" craters={false} />
      {/* back skyline */}
      {[[2, 96], [16, 84], [30, 100], [44, 78], [60, 92], [76, 82], [92, 98], [106, 86]].map(([bx, by], i) => (
        <Rect key={`bk${i}`} x={bx} y={by} width={12} height={BOT - by} fill="#27314F" />
      ))}
      {/* front skyline with lit windows */}
      {[[6, 110], [24, 100], [42, 116], [62, 104], [82, 118], [100, 108]].map(([bx, by], i) => (
        <G key={`fr${i}`}>
          <Rect x={bx} y={by} width={16} height={BOT - by} fill="#161E36" />
          {[0, 1, 2].map((c) => [0, 1, 2, 3].map((rIdx) => (
            <Rect key={`${c}-${rIdx}`} x={bx + 2 + c * 5} y={by + 4 + rIdx * 8} width={2.4} height={3} fill={(c + rIdx + i) % 3 === 0 ? '#FFD56B' : 'rgba(255,213,107,0.25)'} />
          )))}
        </G>
      ))}
    </>
  );
}

function GalaxyScene() {
  return (
    <>
      <Defs>
        <RadialGradient id="nebula" cx="40%" cy="42%" r="55%">
          <Stop offset="0" stopColor="#C56BD6" stopOpacity="0.5" />
          <Stop offset="0.5" stopColor="#6B3FA0" stopOpacity="0.25" />
          <Stop offset="1" stopColor="#0A0420" stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Sky id="galaxy" from="#0A0420" to="#3A1E70" />
      <Rect x="0" y="0" width={VB_W} height={VB_H} fill="url(#nebula)" />
      {STARFIELD.map(([sx, sy], i) => <Star key={i} x={sx} y={sy} r={i % 5 === 0 ? 1.4 : 0.8} />)}
      {[[20, 100], [60, 120], [96, 96], [40, 140], [108, 130]].map(([sx, sy], i) => (
        <Star key={`b${i}`} x={sx} y={sy} r={i % 2 ? 1 : 0.7} />
      ))}
      <Path d="M64,30 L80,22" stroke="rgba(255,255,255,0.7)" strokeWidth={1} strokeLinecap="round" />
      {/* ringed planet */}
      <G>
        <Circle cx={40} cy={70} r={16} fill="#B388FF" />
        <Circle cx={34} cy={64} r={5} fill="rgba(255,255,255,0.18)" />
        <Ellipse cx={40} cy={70} rx={26} ry={7} fill="none" stroke="#E0CBFF" strokeWidth={2} opacity={0.7} />
      </G>
    </>
  );
}

function LavenderScene() {
  return (
    <>
      <Sky id="lavender" from="#ECE3F7" to="#C7B0EA" />
      <Sun cx={94} cy={28} r={12} core="#FFF1C8" halo="#FFF8E4" />
      <Cloud x={30} y={22} s={0.9} o={0.7} color="#F3ECFB" />
      <Cloud x={68} y={16} s={0.7} o={0.6} color="#F3ECFB" />
      {/* green base + converging lavender rows (perspective) */}
      <Path d={`M0,104 C40,96 84,112 120,100 L120,${BOT} L0,${BOT} Z`} fill="#A8C58E" />
      {[0, 1, 2, 3, 4, 5].map((row) => {
        const y = 112 + row * 9;
        const inset = 50 - row * 9;
        return (
          <Line key={row} x1={inset} y1={y} x2={VB_W - inset} y2={y} stroke="#8E6FC4" strokeWidth={3.5} strokeLinecap="round" opacity={0.9} />
        );
      })}
      {/* lavender tips dots */}
      {[[40, 116], [80, 116], [30, 130], [92, 130], [54, 146], [70, 146]].map(([lx, ly], i) => (
        <Circle key={i} cx={lx} cy={ly} r={1.6} fill="#7E57C2" />
      ))}
      {/* bee */}
      <Circle cx={60} cy={96} r={2} fill="#FFD54F" />
      <Circle cx={60} cy={96} r={2} fill="none" stroke="#5A3A12" strokeWidth={0.6} />
    </>
  );
}

function SceneFor(id: ProfileThemeId) {
  switch (id) {
    case 'spring': return <SpringScene />;
    case 'summer-beach': return <BeachScene />;
    case 'autumn': return <AutumnScene />;
    case 'winter': return <WinterScene />;
    case 'purple-pixel': return <PixelScene />;
    case 'night': return <NightScene />;
    case 'sunset': return <SunsetScene />;
    case 'ocean': return <OceanScene />;
    case 'desert': return <DesertScene />;
    case 'forest': return <ForestScene />;
    case 'sakura': return <SakuraScene />;
    case 'aurora': return <AuroraScene />;
    case 'city': return <CityScene />;
    case 'galaxy': return <GalaxyScene />;
    case 'lavender': return <LavenderScene />;
    case 'default-dark':
    default: return <DefaultScene />;
  }
}

interface ProfileThemeSceneProps {
  theme: ProfileTheme;
  style?: StyleProp<ViewStyle>;
}

export const ProfileThemeScene = React.memo(
  function ProfileThemeScene({ theme, style }: ProfileThemeSceneProps) {
    return (
      <View
        style={[StyleSheet.absoluteFill, style]}
        pointerEvents="none"
        // The scene is fully STATIC, so flatten it to a single GPU texture and
        // never re-rasterize it while the profile list scrolls above it. This
        // keeps the detailed SVG off the per-frame raster path on weak devices.
        renderToHardwareTextureAndroid
        shouldRasterizeIOS
        collapsable={false}
      >
        <Svg width="100%" height="100%" viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="xMidYMid slice">
          {SceneFor(theme.id)}
        </Svg>
      </View>
    );
  },
  (prev, next) => prev.theme.id === next.theme.id,
);

export default ProfileThemeScene;
