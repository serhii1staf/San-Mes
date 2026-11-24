/**
 * Mounted once at the app root. Draws the profile QR screen while one is requested, and keeps it
 * mounted for its close animation after the request is cleared.
 *
 * The screen itself (the QR encoder, the emoji field, the scanner) is required the first time it is
 * opened, not at launch: this host is in the root layout, and most sessions never open a QR.
 */
import React, { useCallback, useState } from 'react';
import { useProfileQrStore, type ProfileQrTarget } from '../../store/profileQrStore';

type OverlayComponent = typeof import('./ProfileQrOverlay').default;
let Overlay: OverlayComponent | null = null;

export function ProfileQrHost() {
  const target = useProfileQrStore((s) => s.target);
  const [shown, setShown] = useState<ProfileQrTarget | null>(null);
  // A new request replaces what is shown; clearing it lets the open one animate out first.
  if (target && target !== shown) setShown(target);
  const onHidden = useCallback(() => {
    if (!useProfileQrStore.getState().target) setShown(null);
  }, []);
  if (!shown) return null;
  if (!Overlay) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    Overlay = (require('./ProfileQrOverlay') as typeof import('./ProfileQrOverlay')).default;
  }
  return <Overlay key={shown.id} target={shown} visible={!!target} onHidden={onHidden} />;
}
