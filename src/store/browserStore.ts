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
  setMinimized: (url, domain, isMiniApp = false) => {
    let faviconDomain = domain;
    try { faviconDomain = new URL(url.startsWith('http') ? url : `https://${url}`).hostname; } catch {}
    set({
      minimizedUrl: url,
      minimizedDomain: domain,
      minimizedFavicon: `https://www.google.com/s2/favicons?domain=${faviconDomain}&sz=32`,
      isMiniApp,
    });
  },
  clearMinimized: () => set({ minimizedUrl: null, minimizedDomain: null, minimizedFavicon: null, isMiniApp: false }),
}));
