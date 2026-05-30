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
    let favicon = '';
    try { favicon = `https://www.google.com/s2/favicons?domain=${new URL(url.startsWith('http') ? url : 'https://' + url).hostname}&sz=32`; } catch {}
    set({
      minimizedUrl: url,
      minimizedDomain: domain, // For mini-apps this is the app name, for browser it's the hostname
      minimizedFavicon: favicon,
      isMiniApp,
    });
  },
  clearMinimized: () => set({ minimizedUrl: null, minimizedDomain: null, minimizedFavicon: null, isMiniApp: false }),
}));
