import { create } from 'zustand';

/**
 * The profile QR screen, opened from anywhere by a module function, the way the share sheet is
 * (see shareSheetStore). One host at the root (`ProfileQrHost`) draws it over everything, the tab bar
 * included, without an RN `<Modal>`: the QR used to be a Modal opened from inside another Modal (the
 * profile menu), and two Modals presented together on iOS end with the second one never appearing.
 */
export interface ProfileQrTarget {
  id: string;
  username?: string | null;
  displayName?: string | null;
  emoji?: string | null;
}

interface ProfileQrStore {
  target: ProfileQrTarget | null;
  open: (target: ProfileQrTarget) => void;
  close: () => void;
}

export const useProfileQrStore = create<ProfileQrStore>((set) => ({
  target: null,
  open: (target) => set({ target }),
  close: () => set({ target: null }),
}));

export function openProfileQr(target: ProfileQrTarget): void {
  if (!target?.id) return;
  useProfileQrStore.getState().open(target);
}

export function closeProfileQr(): void {
  useProfileQrStore.getState().close();
}
