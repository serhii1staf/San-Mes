import { create } from 'zustand';

interface BrowserStore {
  minimizedUrl: string | null;
  minimizedDomain: string | null;
  setMinimized: (url: string, domain: string) => void;
  clearMinimized: () => void;
}

export const useBrowserStore = create<BrowserStore>((set) => ({
  minimizedUrl: null,
  minimizedDomain: null,
  setMinimized: (url, domain) => set({ minimizedUrl: url, minimizedDomain: domain }),
  clearMinimized: () => set({ minimizedUrl: null, minimizedDomain: null }),
}));
