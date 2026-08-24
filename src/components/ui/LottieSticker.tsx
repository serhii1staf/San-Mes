import React, { useEffect, useState } from 'react';
import { View, StyleProp } from 'react-native';
import type { ImageStyle } from 'expo-image';

/**
 * An animated Telegram sticker, rendered at the size an image would have occupied.
 *
 * ── WHY THIS EXISTS AT ALL, AND WHY IT IS SO SMALL ──────────────────────────
 *
 * A Telegram `.tgs` is plain gzip around Lottie JSON. The container is packaging, not an encoding — so an
 * animated sticker never needed transcoding, rasterizing or a native converter. It needed `gunzip`, which
 * the Worker does with `DecompressionStream('gzip')`, and a Lottie renderer, which this app already
 * depends on (`lottie-react-native`).
 *
 * That is the answer to "surely there is something ready-made". There is, and it is not the converters:
 * every `.tgs`→GIF project rasterizes with rlottie, ffmpeg or headless Chrome, and none of those run in a
 * Cloudflare Worker. The reusable piece was the renderer we already shipped, which is why the whole
 * feature comes down to this file plus a gunzip.
 *
 * ── THE CARE THAT IS NOT OPTIONAL HERE ──────────────────────────────────────
 *
 * `CachedImage` delegates to this, and `CachedImage` renders essentially every image in the app. So this
 * must be incapable of breaking anything else:
 *
 *   • `lottie-react-native` is resolved LAZILY, so the require cost lands on the first sticker rather than
 *     on importing the image component that the whole app imports.
 *   • A resolve failure renders an empty box instead of throwing. If a build ever ships without the
 *     native module, one sticker is blank; no screen goes down.
 *
 * `autoPlay` + `loop`, because a sticker you have to tap to animate is not a sticker. `contain` rather
 * than `cover`, because stickers are drawn to their own edges and cropping cuts the character's head off.
 */
export function LottieSticker({
  uri,
  style,
  autoplay,
}: {
  uri: string;
  style?: StyleProp<ImageStyle>;
  /**
   * `false` holds the sticker on its first frame.
   *
   * This is not a nicety. The GIF grid renders up to sixty cells and already passes `autoplay={false}` to
   * keep them as single decodes instead of animating everything on screen at once — the note on those
   * cells records that a grid of animated GIFs was saturating the UI thread on weak devices. A Lottie that
   * ignored the flag would reintroduce exactly that, only worse: Lottie animates by RUNNING A VECTOR
   * ANIMATION per frame, not by stepping through decoded bitmaps.
   *
   * So the grid shows still stickers and motion happens where it was already allowed: the long-press
   * preview, and the message once it is sent.
   */
  autoplay?: boolean;
}) {
  const [Lottie, setLottie] = useState<any>(null);

  useEffect(() => {
    let alive = true;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('lottie-react-native');
      if (alive) setLottie(mod?.default || mod);
    } catch {
      // Deliberately swallowed — see the note above. Blank sticker, working app.
    }
    return () => {
      alive = false;
    };
  }, []);

  if (!Lottie) return <View style={style as any} />;
  const play = autoplay !== false;
  return (
    <Lottie
      source={{ uri }}
      autoPlay={play}
      loop={play}
      // Paused on frame 0 rather than merely not started: without an explicit progress, a non-autoplay
      // Lottie can render blank until something drives it, which in a grid is indistinguishable from a
      // sticker that failed to load.
      progress={play ? undefined : 0}
      resizeMode="contain"
      style={style as any}
    />
  );
}
