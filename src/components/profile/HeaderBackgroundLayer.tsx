// HeaderBackgroundLayer
// ---------------------
// Renders a user-chosen background gradient for the profile header card. Placed
// ABOVE the cover photo but BELOW the identity content, so it acts as the card
// backdrop. Read-only + memoized; pointerEvents off. Renders nothing when no
// background is selected.

import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { backgroundColors } from '../../services/headerScene';

function HeaderBackgroundLayerComponent({ backgroundId }: { backgroundId: string | null | undefined }) {
  const colors = backgroundColors(backgroundId);
  if (!colors) return null;
  return (
    <LinearGradient
      pointerEvents="none"
      colors={colors as any}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={StyleSheet.absoluteFill}
    />
  );
}

export const HeaderBackgroundLayer = memo(HeaderBackgroundLayerComponent);
