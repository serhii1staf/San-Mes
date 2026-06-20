import React, { forwardRef, useImperativeHandle, useState, useRef, useCallback, useEffect, memo } from 'react';
import { View, Animated, Easing, StyleSheet } from 'react-native';

// ─── EmojiDeleteBurst ───────────────────────────────────────────────────────
//
// A "dissolve into emojis" effect for deleting chat messages: when a message is
// deleted, a small burst of emoji rises out of the message's container and
// drifts sideways while fading out. Telegram-gift vibes.
//
// Performance is the whole point here — the user deletes messages rapidly, so:
//   • ONE `Animated.timing` (native driver) drives each burst. Every particle
//     in that burst derives its motion from that single value via cheap
//     `interpolate` calls — zero per-frame JS, zero re-renders while animating.
//   • Transforms + opacity only → fully offloaded to the native/UI thread.
//   • Concurrent bursts are capped (MAX_BURSTS); the oldest is dropped if the
//     user spams delete. Particles per burst are capped (PARTICLE_COUNT).
//   • The host renders `null` when idle (no overlay cost between deletes), and
//     each burst self-removes the moment its animation finishes.
//
// Usage: mount once as a screen-level overlay (pointerEvents="none") and call
// `ref.current.burst(x, y, width, height)` with the deleted bubble's window
// rect (measured on the UI thread via Reanimated `measure`).

const MAX_BURSTS = 8;
const PARTICLE_COUNT = 5;
const DURATION = 950;

// Mixed emoji pool — "разные форматы", combined. Picked at random per particle.
const EMOJI_POOL = [
  '✨', '💥', '🔥', '💫', '⭐', '🎉', '🫧', '💨',
  '🌟', '❤️', '😶‍🌫️', '🥲', '👾', '🌀', '🍃', '💔',
  '🎈', '🪄', '🌸', '⚡',
];

function pickEmoji(): string {
  return EMOJI_POOL[Math.floor(Math.random() * EMOJI_POOL.length)];
}

interface Particle {
  k: number;
  emoji: string;
  startX: number;
  startY: number;
  drift: number; // horizontal px (signed) at end
  rise: number; // vertical px upward at end
  spin: string; // end rotation, e.g. "28deg"
  size: number;
}

interface BurstData {
  id: number;
  particles: Particle[];
}

export interface EmojiBurstHandle {
  burst: (x: number, y: number, width: number, height: number) => void;
}

// One particle. Pure transform/opacity interpolations off a shared progress
// Animated.Value — nothing here runs on the JS thread per frame.
const ParticleView = memo(function ParticleView({ progress, p }: { progress: Animated.Value; p: Particle }) {
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [0, -p.rise] });
  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [0, p.drift] });
  const opacity = progress.interpolate({ inputRange: [0, 0.12, 0.7, 1], outputRange: [0, 1, 1, 0] });
  const scale = progress.interpolate({ inputRange: [0, 0.25, 1], outputRange: [0.4, 1, 0.85] });
  const rotate = progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', p.spin] });
  return (
    <Animated.Text
      allowFontScaling={false}
      style={{
        position: 'absolute',
        left: p.startX,
        top: p.startY,
        fontSize: p.size,
        opacity,
        transform: [{ translateX }, { translateY }, { scale }, { rotate }],
      }}
    >
      {p.emoji}
    </Animated.Text>
  );
});

const Burst = memo(function Burst({ data, onDone }: { data: BurstData; onDone: (id: number) => void }) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: DURATION,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    anim.start(() => onDone(data.id));
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <>
      {data.particles.map((p) => (
        <ParticleView key={p.k} progress={progress} p={p} />
      ))}
    </>
  );
});

export const EmojiDeleteBurst = forwardRef<EmojiBurstHandle>(function EmojiDeleteBurst(_props, ref) {
  const [bursts, setBursts] = useState<BurstData[]>([]);
  const idRef = useRef(0);

  useImperativeHandle(ref, () => ({
    burst: (x: number, y: number, width: number, height: number) => {
      const id = ++idRef.current;
      const w = Math.max(width, 24);
      const particles: Particle[] = [];
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        particles.push({
          k: i,
          emoji: pickEmoji(),
          // Spread across the bubble width, originate around its vertical middle.
          startX: x + Math.random() * Math.max(w - 22, 8),
          startY: y + height * 0.25 + Math.random() * height * 0.5,
          drift: (Math.random() * 2 - 1) * 48,
          rise: 80 + Math.random() * 70,
          spin: `${Math.round((Math.random() * 2 - 1) * 40)}deg`,
          size: 18 + Math.round(Math.random() * 8),
        });
      }
      setBursts((prev) => {
        const next = [...prev, { id, particles }];
        // Cap concurrent bursts — drop the oldest if the user spams delete.
        return next.length > MAX_BURSTS ? next.slice(next.length - MAX_BURSTS) : next;
      });
    },
  }), []);

  const handleDone = useCallback((id: number) => {
    setBursts((prev) => prev.filter((b) => b.id !== id));
  }, []);

  // Zero overlay cost when idle.
  if (bursts.length === 0) return null;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {bursts.map((b) => (
        <Burst key={b.id} data={b} onDone={handleDone} />
      ))}
    </View>
  );
});
