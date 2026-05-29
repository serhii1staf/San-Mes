import { create } from 'zustand';

interface ToastStore {
  message: string;
  icon: string;
  visible: boolean;
  show: (message: string, icon?: string) => void;
  hide: () => void;
}

export const useToastStore = create<ToastStore>((set) => ({
  message: '',
  icon: 'check',
  visible: false,
  show: (message, icon = 'check') => set({ message, icon, visible: true }),
  hide: () => set({ visible: false }),
}));

/** Quick helper to show a toast from anywhere */
export function showToast(message: string, icon?: string) {
  useToastStore.getState().show(message, icon);
}
