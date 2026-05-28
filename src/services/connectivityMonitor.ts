import { create } from 'zustand';

// ─── Constants ───────────────────────────────────────────────────────────────

const PING_URL = 'https://ycwadqglcykcpucembjn.supabase.co/rest/v1/';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inljd2FkcWdsY3lrY3B1Y2VtYmpuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4Mjc2OTYsImV4cCI6MjA5NTQwMzY5Nn0.ZUr1YfN6pBp_AaUC1pZLKGApwgEXEiVw_w6w-yQjE_U';
const PING_TIMEOUT = 5000;
const POLL_INTERVAL = 30000;

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
      headers: { apikey: SUPABASE_ANON_KEY },
    });
    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    // AbortError, TypeError, or any other error → offline
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
