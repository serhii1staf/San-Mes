import { create } from 'zustand';
import { Audio, AVPlaybackStatus } from 'expo-av';
import { Track } from '../services/musicService';

// Global music playback. A single expo-av Sound instance is shared app-wide so
// playback continues while the user navigates between screens, and the floating
// mini-player (MusicMiniBar) can control it from anywhere.
//
// Performance: only ONE Sound is ever loaded at a time (previous is unloaded
// before the next loads), status updates are throttled by expo-av itself, and
// the store holds primitives so subscribers re-render minimally.

interface MusicState {
  current: Track | null;
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
  isLoading: boolean;
  play: (track: Track) => Promise<void>;
  toggle: () => Promise<void>;
  seek: (ms: number) => Promise<void>;
  stop: () => Promise<void>;
}

let sound: Audio.Sound | null = null;
let audioModeSet = false;

async function ensureAudioMode() {
  if (audioModeSet) return;
  try {
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: true, // honoured once the native build enables the bg-audio mode
      shouldDuckAndroid: true,
    });
    audioModeSet = true;
  } catch {}
}

export const useMusicStore = create<MusicState>((set, get) => ({
  current: null,
  isPlaying: false,
  positionMs: 0,
  durationMs: 0,
  isLoading: false,

  play: async (track: Track) => {
    // Same track tapped again → just toggle.
    if (get().current?.id === track.id && sound) {
      await get().toggle();
      return;
    }
    set({ isLoading: true, current: track, positionMs: 0, durationMs: track.durationMs });
    await ensureAudioMode();
    // Unload the previous sound before loading a new one (only one in memory).
    if (sound) {
      try { await sound.unloadAsync(); } catch {}
      sound = null;
    }
    try {
      const { sound: s } = await Audio.Sound.createAsync(
        { uri: track.previewUrl },
        { shouldPlay: true },
        (status: AVPlaybackStatus) => {
          if (!status.isLoaded) return;
          set({
            isPlaying: status.isPlaying,
            positionMs: status.positionMillis || 0,
            durationMs: status.durationMillis || track.durationMs,
          });
          if (status.didJustFinish) {
            set({ isPlaying: false, positionMs: 0 });
          }
        }
      );
      sound = s;
      set({ isLoading: false, isPlaying: true });
    } catch {
      set({ isLoading: false, isPlaying: false });
    }
  },

  toggle: async () => {
    if (!sound) {
      // Nothing loaded but we have a current track → (re)load and play it.
      const cur = get().current;
      if (cur) await get().play(cur);
      return;
    }
    try {
      const status = await sound.getStatusAsync();
      if (!status.isLoaded) {
        const cur = get().current;
        if (cur) await get().play(cur);
        return;
      }
      if (status.isPlaying) { await sound.pauseAsync(); set({ isPlaying: false }); }
      else {
        // Preview finished → restart from 0.
        if (status.positionMillis >= (status.durationMillis || 1) - 200) {
          await sound.setPositionAsync(0);
        }
        await sound.playAsync();
        set({ isPlaying: true });
      }
    } catch {}
  },

  seek: async (ms: number) => {
    if (!sound) return;
    try { await sound.setPositionAsync(Math.max(0, ms)); } catch {}
  },

  stop: async () => {
    if (sound) {
      try { await sound.stopAsync(); await sound.unloadAsync(); } catch {}
      sound = null;
    }
    set({ current: null, isPlaying: false, positionMs: 0, durationMs: 0 });
  },
}));
