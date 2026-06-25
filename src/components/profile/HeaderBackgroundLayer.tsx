// HeaderBackgroundLayer
// ---------------------
// Renders a user-chosen DRAWN LANDSCAPE and/or the user's FREEHAND DRAWING as
// the profile header card backdrop (above the cover photo, below the identity
// content). Read-only + memoized; pointerEvents off via HeaderLandscape.
//
// Banner combination is now EXPLICIT: the landscape is drawn semi-transparently
// (so the banner photo shows through) only when the user turned on "blend"
// (`blend` + there's a banner). Otherwise it's fully opaque.

import React, { memo } from 'react';
import { HeaderLandscape } from './HeaderLandscape';
import { HeaderDrawStroke } from '../../services/headerScene';

function HeaderBackgroundLayerComponent({
  backgroundId,
  drawing,
  hasBanner,
  blend,
}: {
  backgroundId: string | null | undefined;
  drawing?: HeaderDrawStroke[] | null;
  hasBanner?: boolean;
  blend?: boolean;
}) {
  const dimmed = !!blend && !!hasBanner;
  return (
    <HeaderLandscape backgroundId={backgroundId} drawing={drawing} style={dimmed ? { opacity: 0.5 } : null} />
  );
}

export const HeaderBackgroundLayer = memo(HeaderBackgroundLayerComponent);
