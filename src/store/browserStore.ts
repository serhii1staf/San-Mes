import { create } from 'zustand';

interface BrowserStore {
  minimizedUrl: string | null;
  minimizedDomain: string | null;
  minimizedFavicon: string | null;
  isMiniApp: boolean;
  setMinimized: (url: string, domain: string, isMiniApp?: boolean) => void;
  clearMinimized: () => void;
}

export const useBrowserStore = create<BrowserStore>((set) => ({
  minimizedUrl: null,
  minimizedDomain: null,
  minimizedFavicon: null,
  isMiniApp: false,
  setMinimized: (url, domain, isMiniApp = false) => set({
    minimizedUrl: url,
    minimizedDomain: domain,
    minimizedFavicon: isMiniApp ? null : `https://www.google.com/s2/favicons?domain=${domain}&sz=32`,
    isMiniApp,
  }),
  clearMinimized: () => set({ minimizedUrl: null, minimizedDomain: null, minimizedFavicon: null, isMiniApp: false }),
}));
