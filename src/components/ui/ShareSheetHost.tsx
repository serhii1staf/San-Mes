import React, { useEffect, useMemo, useState } from 'react';
import { useShareSheetStore } from '../../store/shareSheetStore';
import { useAuthStore } from '../../store/authStore';
import { ShareToChatSheet } from './ShareToChatSheet';

/**
 * Renders the app's single share sheet. Mounted once at the root, next to `<Toast />`.
 *
 * Nothing at all is mounted until the sheet is opened for the first time in a session. The sheet owns a
 * fifteen-avatar horizontal list and an animation driver; both would otherwise sit in the tree of every
 * screen, for the entire session, for a surface most sessions never open. After the first open the sheet
 * stays mounted and just toggles `visible`, so the second open does not pay for a fresh mount mid-gesture.
 */
export function ShareSheetHost() {
  const target = useShareSheetStore((s) => s.target);
  const close = useShareSheetStore((s) => s.close);
  const myId = useAuthStore((s) => s.user?.id);

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (target && !mounted) setMounted(true);
  }, [target, mounted]);

  // Stable reference: the sheet compares this prop by identity, so a fresh array per render would
  // defeat its memo and rebuild the people row on every render of the root layout.
  const exclude = useMemo(() => [myId], [myId]);

  if (!mounted) return null;

  return (
    <ShareToChatSheet
      visible={!!target}
      onClose={close}
      shareUrl={target?.url || ''}
      caption={target?.caption}
      excludeUserIds={exclude}
    />
  );
}
