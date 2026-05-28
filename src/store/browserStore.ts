import { create } from 'zustand';

interface BrowserStore {
  minimizedUrl: string | null;
  minimizedDomain: string | null;
  minimizedFavicon: string | null;
  setMinimized: (url: string, domain: string) => void;
  clearMinimized: () => void;
}

export const useBrowserStore = create<BrowserStore>((set) => ({
  minimizedUrl: null,
  minimizedDomain: null,
  minimizedFavicon: null,
  setMinimized: (url, domain) => set({
    minimizedUrl: url,
    minimizedDomain: domain,
    minimizedFavicon: `https://www.google.com/s2/favicons?domain=${domain}&sz=32`,
  }),
  clearMinimized: () => set({ minimizedUrl: null, minimizedDomain: null, minimizedFavicon: null }),
}));
