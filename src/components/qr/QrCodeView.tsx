/**
 * A QR code drawn with react-native-svg from a matrix made on the device (see src/utils/qrMatrix.ts).
 *
 * Two paths, whatever the size: every data module in one, the finder and alignment patterns in the
 * other. Optional `center` content (an emoji, a logo) sits in a cleared square in the middle; the code
 * uses error-correction level H, which recovers 30 % of the modules, and the hole clears under 6 %.
 *
 * ── A LINK NEVER ENCODED BEFORE IS ENCODED A FRAME LATER ─────────────────────
 * Encoding costs about 110 ms on the emulator (see qrMatrix.ts), and the QR screen mounts this in the
 * commit that starts its open animation. When the matrix is not in memory or on disk yet, the square
 * is drawn empty first, the code is encoded on the next frame and fades in, so the screen opens at
 * once. Every later open, including after a restart, draws it immediately.
 */
import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { isQrCached, qrPaths } from '../../utils/qrMatrix';

/** The hole in the middle, as a fraction of the side, when there is something to put in it. */
const CENTER_FRACTION = 0.23;

export const QrCodeView = memo(function QrCodeView({
  value,
  size,
  color,
  center,
  centerBackground = '#FFFFFF',
}: {
  value: string;
  /** Side in points. */
  size: number;
  color: string;
  center?: React.ReactNode;
  centerBackground?: string;
}) {
  const hasCenter = !!center;
  const fraction = hasCenter ? CENTER_FRACTION : 0;
  const [ready, setReady] = useState(() => isQrCached(value, 'H'));
  // Only a deferred code fades in; one drawn on the first frame is simply there.
  const deferred = useRef(!ready).current;
  const fade = useRef(new Animated.Value(ready ? 1 : 0)).current;

  useEffect(() => {
    if (ready) return;
    const raf = requestAnimationFrame(() => {
      qrPaths(value, 'H', fraction);
      setReady(true);
    });
    return () => cancelAnimationFrame(raf);
  }, [ready, value, fraction]);

  useEffect(() => {
    if (ready && deferred) {
      Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    }
  }, [ready, deferred, fade]);

  // Cached per text for the session inside `qrPaths`, so a reopen is a map lookup.
  const paths = useMemo(() => (ready ? qrPaths(value, 'H', fraction) : null), [ready, value, fraction]);
  if (!paths) return <View style={{ width: size, height: size }} />;
  const cell = size / paths.size;
  const hole = paths.clear * cell;
  return (
    <Animated.View style={{ width: size, height: size, opacity: fade }} accessibilityRole="image">
      <Svg width={size} height={size} viewBox={`0 0 ${paths.size} ${paths.size}`}>
        <Path d={paths.dots} fill={color} />
        <Path d={paths.finders} fill={color} fillRule="evenodd" />
      </Svg>
      {center && hole > 0 ? (
        <View
          pointerEvents="none"
          style={[
            styles.center,
            {
              width: hole - cell * 0.6,
              height: hole - cell * 0.6,
              left: (size - hole) / 2 + cell * 0.3,
              top: (size - hole) / 2 + cell * 0.3,
              borderRadius: hole * 0.28,
              backgroundColor: centerBackground,
            },
          ]}
        >
          {center}
        </View>
      ) : null}
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  center: { position: 'absolute', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
