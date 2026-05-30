import { create } from 'zustand';

interface BrowserStore {
  minimizedUrl: string | null;
  minimizedDomain: string | null;
  minimizedFavicon: string | null;
  minimizedEmoji: string | null;
  isMiniApp: boolean;
  setMinimized: (url: string, domain: string, isMiniApp?: boolean, emoji?: string) => void;
  clearMinimized: () => void;
}

export const useBrowserStore = create<BrowserStore>((set) => ({
  minimizedUrl: null,
  minimizedDomain: null,
  minimizedFavicon: null,
  minimizedEmoji: null,
  isMiniApp: false,
  setMinimized: (url, domain, isMiniApp = false, emoji) => {
    let favicon = '';
    if (!isMiniApp) {
      try { favicon = `https://www.google.com/s2/favicons?domain=${new URL(url.startsWith('http') ? url : 'https://' + url).hostname}&sz=32`; } catch {}
    }
    set({
      minimizedUrl: url,
      minimizedDomain: domain,
      minimizedFavicon: favicon,
      minimizedEmoji: emoji || null,
      isMiniApp,
    });
  },
  clearMinimized: () => set({ minimizedUrl: null, minimizedDomain: null, minimizedFavicon: null, minimizedEmoji: null, isMiniApp: false }),
}));
