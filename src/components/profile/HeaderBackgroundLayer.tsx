// HeaderBackgroundLayer
// ---------------------
// Renders a user-chosen DRAWN LANDSCAPE (sky + sun/moon + layered silhouettes,
// see HeaderLandscape) as the profile header card backdrop. Placed ABOVE the
// cover photo but BELOW the identity content. Read-only + memoized;
// pointerEvents off. Renders nothing when no background is selected.
//
// Banner combination: when the card ALSO has a cover photo (`hasBanner`), the
// landscape is rendered at a reduced opacity so the banner shows through and
// the two read as a single combined backdrop. With no banner it's fully opaque.

import React, { memo } from 'react';
import { HeaderLandscape } from './HeaderLandscape';

function HeaderBackgroundLayerComponent({
  backgroundId,
  hasBanner,
}: {
  backgroundId: string | null | undefined;
  hasBanner?: boolean;
}) {
  return (
    <HeaderLandscape backgroundId={backgroundId} style={hasBanner ? { opacity: 0.55 } : null} />
  );
}

export const HeaderBackgroundLayer = memo(HeaderBackgroundLayerComponent);
