import { create } from 'zustand';
import { Audio, AVPlaybackStatus } from 'expo-av';
import { Track } from '../services/musicService';

// Global music playback. A single expo-av Sound instance is shared app-wide so
// playback continues while the user navigates between screens, and the floating
// mini-player (MusicBottomIndicator) can control it from anywhere.
//
// Performance & correctness: only ONE Sound is ever active. `play()` calls are
// SERIALIZED through a promise chain and guarded by a monotonic generation
// token, so rapid overlapping calls (re-entering the music chat, autoplay racing
// a manual tap) can never leave two sounds playing at once. Status callbacks are
// tagged with the generation that created them and ignored once stale, so an
// orphaned previous-track callback can't clobber the current track's state.

interface MusicState {
  current: Track | null;
  recent: Track[];
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
  isLoading: boolean;
  // True when the full-screen player is presented over the app.
  playerOpen: boolean;
  openPlayer: () => void;
  closePlayer: () => void;
  play: (track: Track) => Promise<void>;
  toggle: () => Promise<void>;
  seek: (ms: number) => Promise<void>;
  stop: () => Promise<void>;
}

let sound: Audio.Sound | null = null;
let audioModeSet = false;

// Monotonic token: every play()/stop() bumps it. Any async continuation or
// status callback whose captured token != playGen is stale and must no-op.
let playGen = 0;
// Serializes async playback transitions so unload→create can't interleave.
let playChain: Promise<void> = Promise.resolve();

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

// Fully tear down the active sound. Safe to call repeatedly.
async function unloadActiveSound() {
  const s = sound;
  sound = null;
  if (s) {
    try { await s.stopAsync(); } catch {}
    try { await s.unloadAsync(); } catch {}
  }
}

export const useMusicStore = create<MusicState>((set, get) => ({
  current: null,
  recent: [],
  isPlaying: false,
  positionMs: 0,
  durationMs: 0,
  isLoading: false,
  playerOpen: false,

  openPlayer: () => set({ playerOpen: true }),
  closePlayer: () => set({ playerOpen: false }),

  play: async (track: Track) => {
    // Same track tapped again → just toggle play/pause (no reload, no race).
    if (get().current?.id === track.id && sound) {
      await get().toggle();
      return;
    }

    // Claim a new generation up-front so any in-flight older play() bails out.
    const myGen = ++playGen;

    set({ isLoading: true, current: track, positionMs: 0, durationMs: track.durationMs });
    // Track recents (most-recent first, unique, capped at 12) for the widget.
    set((s) => ({ recent: [track, ...s.recent.filter((t) => t.id !== track.id)].slice(0, 12) }));

    // Serialize the actual load so two rapid play() calls run strictly in order;
    // each step re-checks `myGen` and aborts the moment a newer call supersedes it.
    playChain = playChain.then(async () => {
      if (myGen !== playGen) return; // superseded before we even started loading

      await ensureAudioMode();
      if (myGen !== playGen) return;

      // Always tear down the previous sound BEFORE creating the next one.
      await unloadActiveSound();
      if (myGen !== playGen) return;

      try {
        const { sound: s } = await Audio.Sound.createAsync(
          { uri: track.streamUrl },
          { shouldPlay: true, progressUpdateIntervalMillis: 500 },
          (status: AVPlaybackStatus) => {
            // Stale callback from a superseded track → ignore entirely.
            if (myGen !== playGen) return;
            if (!status.isLoaded) return;
            // Only reflect POSITION/DURATION from the native callback. We do
            // NOT mirror `status.isPlaying` because the callback fires with a
            // delay (~50–200 ms) and would clobber the optimistic UI state set
            // synchronously by toggle()/play(). The store's `isPlaying` is the
            // single source of truth and is updated by play/toggle/stop only.
            set({
              positionMs: status.positionMillis || 0,
              durationMs: status.durationMillis || track.durationMs,
            });
            if (status.didJustFinish) set({ isPlaying: false, positionMs: 0 });
          }
        );

        // A newer play() won the race while we were creating → discard this one.
        if (myGen !== playGen) {
          try { await s.stopAsync(); } catch {}
          try { await s.unloadAsync(); } catch {}
          return;
        }

        sound = s;
        set({ isLoading: false, isPlaying: true });
      } catch {
        if (myGen === playGen) set({ isLoading: false, isPlaying: false });
      }
    });

    await playChain;
  },

  toggle: async () => {
    if (!sound) {
      // Nothing loaded but we have a current track → (re)load and play it.
      const cur = get().current;
      if (cur) await get().play(cur);
      return;
    }
    // Optimistic UI flip BEFORE the native call so the icon responds the same
    // frame the user taps it. Rolled back on failure.
    const wantPlay = !get().isPlaying;
    set({ isPlaying: wantPlay });
    try {
      // Use a single setStatusAsync call instead of pause/playAsync — it's the
      // atomic API expo-av exposes for "set the desired playback state" and is
      // significantly more reliable across iOS / Android / Telegram WebView.
      // Also rewinds in the same call when the preview reached its end.
      const status = await sound.getStatusAsync();
      if (!status.isLoaded) {
        // Sound was implicitly unloaded (e.g., audio focus loss) — reload.
        const cur = get().current;
        if (cur) {
          set({ isPlaying: false });
          await get().play(cur);
        }
        return;
      }
      const atEnd = status.positionMillis >= (status.durationMillis || 1) - 200;
      await sound.setStatusAsync({
        shouldPlay: wantPlay,
        positionMillis: wantPlay && atEnd ? 0 : undefined,
      });
    } catch {
      set({ isPlaying: !wantPlay });
    }
  },

  seek: async (ms: number) => {
    const target = Math.max(0, Math.floor(ms));
    // Update the visible position immediately so the slider/labels jump
    // exactly to the requested point — without this, the UI would only catch
    // up on the next progressUpdate (~500 ms).
    set({ positionMs: target });
    if (!sound) return;
    try {
      // setStatusAsync is the atomic "set state" API — preserves shouldPlay
      // alongside the new position so seek() never accidentally pauses or
      // resumes playback.
      await sound.setStatusAsync({ positionMillis: target, shouldPlay: get().isPlaying });
    } catch {
      // Fallback for older expo-av builds where setStatusAsync rejects
      // without an error code.
      try { await sound.setPositionAsync(target); } catch {}
    }
  },

  stop: async () => {
    // Invalidate any in-flight play() so a pending load won't resurrect playback.
    playGen++;
    await unloadActiveSound();
    set({ current: null, isPlaying: false, positionMs: 0, durationMs: 0, playerOpen: false });
  },
}));
