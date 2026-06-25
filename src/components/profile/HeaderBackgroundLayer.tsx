// HeaderBackgroundLayer
// ---------------------
// Renders a user-chosen background gradient for the profile header card. Placed
// ABOVE the cover photo but BELOW the identity content, so it acts as the card
// backdrop. Read-only + memoized; pointerEvents off. Renders nothing when no
// background is selected.
//
// Banner combination: when the card ALSO has a cover photo (`hasBanner`), the
// gradient is rendered at a reduced opacity so the banner shows through and the
// two read as a single combined backdrop (the user can pair a landscape
// gradient with their own photo). With no banner the gradient is fully opaque.
//
// Direction: rendered TOP→BOTTOM (vertical) so multi-stop palettes read as
// landscapes (sky → horizon → ground) and match the customize-header preview
// exactly.

import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { backgroundColors } from '../../services/headerScene';

function HeaderBackgroundLayerComponent({
  backgroundId,
  hasBanner,
}: {
  backgroundId: string | null | undefined;
  hasBanner?: boolean;
}) {
  const colors = backgroundColors(backgroundId);
  if (!colors) return null;
  return (
    <LinearGradient
      pointerEvents="none"
      colors={colors as any}
      start={{ x: 0.5, y: 0 }}
      end={{ x: 0.5, y: 1 }}
      style={[StyleSheet.absoluteFill, hasBanner ? { opacity: 0.55 } : null]}
    />
  );
}

export const HeaderBackgroundLayer = memo(HeaderBackgroundLayerComponent);
