import { create } from 'zustand';

// Persistent mini-app state.
//
// The mini-app WebView lives in a single root-level host (MiniAppHost) that is
// NEVER unmounted while minimized — so collapsing then reopening a mini-app
// resumes the exact same page/section (Telegram-style), instead of reloading
// the URL from scratch the way the old per-route WebView did.
//
//   closed → nothing mounted (no WebView, zero cost).
//   full   → fullscreen overlay, interactive.
//   min    → WebView kept mounted but hidden behind the app; a small pill is
//            shown so the user can restore it. State (scroll, SPA route, form
//            input) is preserved because the WebView is never torn down.

export type MiniAppMode = 'closed' | 'full' | 'min';

interface MiniAppState {
  mode: MiniAppMode;
  url: string;
  name: string;
  emoji: string;
  id?: string;
  // A monotonically increasing token bumped every time a DIFFERENT mini-app is
  // opened. The host keys its WebView on it so opening a new app gets a fresh
  // WebView, while open→minimize→restore of the SAME app keeps the same one.
  sessionKey: number;
  open: (p: { url: string; name?: string; emoji?: string; id?: string }) => void;
  minimize: () => void;
  restore: () => void;
  close: () => void;
}

export const useMiniAppStore = create<MiniAppState>((set, get) => ({
  mode: 'closed',
  url: '',
  name: '',
  emoji: '',
  id: undefined,
  sessionKey: 0,
  open: ({ url, name, emoji, id }) => {
    const cur = get();
    // Already fullscreen on this exact app → no-op. The launcher route fires
    // open() on every navigation to `/mini-app`; without this guard a repeated
    // / double tap (or a duplicate launcher mount) re-commits the full state,
    // which restarts the slide-up animation and clears the widget for no
    // reason — the user reads that as a flicker / "open-close-open".
    if (cur.mode === 'full' && cur.url === url) return;
    // Same app currently minimized → bring it back to full, keeping the live
    // WebView (no reload). Different app (or none) → fresh session.
    const sameApp = cur.mode !== 'closed' && cur.url === url;
    set({
      mode: 'full',
      url,
      name: name || 'App',
      emoji: emoji || '📱',
      id,
      sessionKey: sameApp ? cur.sessionKey : cur.sessionKey + 1,
    });
  },
  minimize: () => set((s) => (s.mode === 'full' ? { mode: 'min' } : s)),
  restore: () => set((s) => (s.mode === 'min' ? { mode: 'full' } : s)),
  close: () => set({ mode: 'closed', url: '', name: '', emoji: '', id: undefined }),
}));
