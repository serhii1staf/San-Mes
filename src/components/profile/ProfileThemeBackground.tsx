/**
 * ProfileThemeBackground
 * ----------------------
 * Layer 1 of the profile theme rendering stack (see design §"Rendering layer
 * stack"): the full-screen decorative Background_Illustration that sits behind
 * the glass profile content. It mirrors `ChatBackgroundLayer`'s
 * `StyleSheet.absoluteFill` approach (Req 9.2) but renders a *bundled*
 * `require()`'d image (a numeric asset module) rather than a remote URI — so
 * there is no network logic and the asset is offline-available by construction
 * (Req 1.3 / 9.2).
 *
 * Critically, this is a **background-only sibling layer**. It owns its own
 * fade-in (`transition`) and must NEVER wrap any glass view or profile content,
 * because animating the opacity of a parent of a glass view is forbidden by the
 * app's liquid-glass rule. The glass cards are siblings rendered *on top* of
 * this layer, never children of it.
 *
 * Fallback behavior (Req 4.5, 5.3, 7.7): when the illustration is `null` the
 * component renders nothing so the palette gradient beneath shows through
 * (palette-only path). When an asset is present but fails to load (`onError`)
 * or does not load within 5 seconds (`onTimeout`), the parent is notified so it
 * can flip to the palette-only render. The timer is cleared on unmount and as
 * soon as either load or error fires.
 */

import React, { useEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { Image } from 'expo-image';

/** Max time we wait for the bundled illustration to load before giving up. */
const LOAD_TIMEOUT_MS = 5000;

interface ProfileThemeBackgroundProps {
  /** Bundled `require()`'d image module, or null → palette-only (render nothing). */
  illustration: number | null;
  /** Fired when the image reports a load error (Req 4.5, 5.3). */
  onError?: () => void;
  /** Fired if neither load nor error occurs within 5 seconds (Req 4.5, 5.3, 7.7). */
  onTimeout?: () => void;
}

export function ProfileThemeBackground({
  illustration,
  onError,
  onTimeout,
}: ProfileThemeBackgroundProps) {
  // Tracks the pending 5 s timer so we can clear it on unmount / load / error.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guards against firing more than one terminal outcome (load XOR error XOR
  // timeout) for a single illustration — and against late callbacks after the
  // asset prop changes.
  const settledRef = useRef(false);

  const clearTimer = () => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => {
    // Reset for each new illustration. The palette-only (null) case never arms
    // a timer because there is nothing to load.
    settledRef.current = false;
    clearTimer();

    if (illustration == null) return;

    timerRef.current = setTimeout(() => {
      if (settledRef.current) return;
      settledRef.current = true;
      timerRef.current = null;
      onTimeout?.();
    }, LOAD_TIMEOUT_MS);

    return clearTimer;
    // onTimeout is intentionally not a dependency: it is a fire-and-forget
    // notification and re-arming the timer when a parent passes a new closure
    // would reset the 5 s budget on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [illustration]);

  // null illustration → render nothing so the palette gradient beneath shows
  // through (Req 4.5 / 5.3 palette-only path).
  if (illustration == null) return null;

  return (
    <Image
      source={illustration}
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      contentFit="cover"
      // The image owns its own fade-in. Safe here because this layer is a
      // sibling *under* the glass content — it never parents a glass view.
      transition={300}
      onLoad={() => {
        if (settledRef.current) return;
        settledRef.current = true;
        clearTimer();
      }}
      onError={() => {
        if (settledRef.current) return;
        settledRef.current = true;
        clearTimer();
        onError?.();
      }}
    />
  );
}
