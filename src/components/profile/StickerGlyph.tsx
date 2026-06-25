// StickerGlyph
// ------------
// Renders a single header sticker glyph at its REAL font size (crisp at any
// scale) and applies its static rotation PLUS an optional looping animation
// (float / pulse / spin / swing). One self-contained Animated driver per
// animated glyph, transforms only + useNativeDriver so it runs on the UI
// thread and costs ~nothing on the JS thread. Shared by the editor preview and
// the read-only HeaderSceneLayer so both look identical.

import React, { memo, useEffect, useRef } from 'react';
import { Animated, Easing, Text as RNText } from 'react-native';
import { HeaderItemAnim } from '../../services/headerScene';

function StickerGlyphComponent({
  value,
  size,
  rotation,
  anim,
}: {
  value: string;
  size: number;
  rotation: number;
  anim?: HeaderItemAnim;
}) {
  const v = useRef(new Animated.Value(0)).current;
  const active = !!anim && anim !== 'none';

  useEffect(() => {
    if (!active) {
      v.setValue(0);
      return;
    }
    v.setValue(0);
    const spin = anim === 'spin';
    const loop = Animated.loop(
      spin
        ? Animated.timing(v, { toValue: 1, duration: 3600, easing: Easing.linear, useNativeDriver: true })
        : Animated.sequence([
            Animated.timing(v, { toValue: 1, duration: anim === 'pulse' ? 900 : 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
            Animated.timing(v, { toValue: 0, duration: anim === 'pulse' ? 900 : 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, anim, v]);

  // Compose static rotation + the animation's own transform.
  const transform: any[] = [{ rotate: `${rotation}deg` }];
  if (active) {
    if (anim === 'float') {
      transform.push({ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [size * 0.08, -size * 0.08] }) });
    } else if (anim === 'pulse') {
      transform.push({ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.12] }) });
    } else if (anim === 'spin') {
      transform.push({ rotate: v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) });
    } else if (anim === 'swing') {
      transform.push({ rotate: v.interpolate({ inputRange: [0, 1], outputRange: ['-14deg', '14deg'] }) });
    }
  }

  return (
    <Animated.View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center', transform }}>
      <RNText allowFontScaling={false} style={{ fontSize: size * 0.82 }}>{value}</RNText>
    </Animated.View>
  );
}

export const StickerGlyph = memo(StickerGlyphComponent);
