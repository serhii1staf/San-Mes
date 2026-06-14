import { create } from 'zustand';

// ─── Constants ───────────────────────────────────────────────────────────────

const PING_URL = 'https://www.google.com/generate_204';
const PING_TIMEOUT = 3000;
const POLL_INTERVAL = 20000;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ConnectivityState {
  isOnline: boolean;
  lastChecked: string | null;
  start: () => void;
  stop: () => void;
  checkNow: () => Promise<boolean>;
}

// ─── Module State ────────────────────────────────────────────────────────────

let intervalId: ReturnType<typeof setInterval> | null = null;

// ─── Connectivity Check ──────────────────────────────────────────────────────

async function checkConnectivity(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PING_TIMEOUT);
    const response = await fetch(PING_URL, {
      method: 'HEAD',
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timeoutId);
    // Google's generate_204 returns 204, any response means online
    return response.status === 204 || response.ok;
  } catch {
    return false;
  }
}

// ─── Lazy import to avoid circular dependency ────────────────────────────────

async function triggerProcessQueue(): Promise<void> {
  try {
    const { processQueue } = await import('./offlineQueue');
    await processQueue();
  } catch {
    // offlineQueue may not be available yet or processQueue failed — ignore
  }
}

// ─── Store ───────────────────────────────────────────────────────────────────

export const useConnectivityStore = create<ConnectivityState>((set, get) => ({
  isOnline: true,
  lastChecked: null,

  start: () => {
    if (intervalId) return;

    // Drain any leftover queue from a previous session immediately. The
    // queue can carry mutations from a session that was killed before
    // it ever transitioned offline → online (the only edge the polling
    // loop below reacts to). Without this kick the items would sit in
    // AsyncStorage until the next time the device actually goes
    // offline-and-back, which on a stable connection might never happen.
    triggerProcessQueue();

    // Check immediately on start
    checkConnectivity().then((online) => {
      const prev = get().isOnline;
      set({ isOnline: online, lastChecked: new Date().toISOString() });
      if (!prev && online) {
        triggerProcessQueue();
      }
    });

    // Poll every 30 seconds
    intervalId = setInterval(async () => {
      const prev = get().isOnline;
      const online = await checkConnectivity();
      set({ isOnline: online, lastChecked: new Date().toISOString() });
      if (!prev && online) {
        triggerProcessQueue();
      }
    }, POLL_INTERVAL);
  },

  stop: () => {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  },

  checkNow: async () => {
    const prev = get().isOnline;
    const online = await checkConnectivity();
    set({ isOnline: online, lastChecked: new Date().toISOString() });
    if (!prev && online) {
      triggerProcessQueue();
    }
    return online;
  },
}));
