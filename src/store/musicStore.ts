import { create } from 'zustand';
import type { AudioPlayer, AudioStatus } from 'expo-audio';
import { Track } from '../services/musicService';

// ── THE RUNTIME IMPORT IS GUARDED, AND THAT IS NOT DEFENSIVE PADDING ────────
//
// `expo-audio` is a NEW NATIVE MODULE. The types above are `import type` and erase at compile time, so
// they cost nothing; the two runtime functions are reached through this lazy accessor instead of a
// static import for one specific reason.
//
// This repository publishes over-the-air JS updates (`.github/workflows/ota-update.yml`, and the
// `eas update --branch production` path). An OTA replaces the JS bundle inside an ALREADY-INSTALLED
// binary. A static `import { createAudioPlayer } from 'expo-audio'` in this file would therefore be
// evaluated on binaries that do not contain the module — and this store is not obscure: the floating
// mini-player is mounted globally from `app/_layout.tsx`, so a throw here takes down every screen. The
// app would be unopenable until a new native build shipped.
//
// With the accessor, that same accidental OTA degrades to "music does not play" and everything else
// keeps working. `src/utils/sounds.ts` was already written this way; this file was the hole.
//
// This does NOT mean the migration can ship over the air. It means shipping it over the air by mistake
// is recoverable instead of fatal. The change still requires a native build to actually function.
let AudioMod: any = null;
function audio(): any {
  if (AudioMod) return AudioMod;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    AudioMod = require('expo-audio');
  } catch {
    AudioMod = null;
  }
  return AudioMod;
}
// Resolve it once at module load. This is safe on a binary that lacks the native module — `audio()` is
// try/catch'd and simply latches `null`, which is the whole point of it — so the OTA protection above is
// untouched. It is here for two reasons: the resolution cost is paid at import rather than on the frame
// where the user taps play, and it restores eager module resolution, which the test suites depend on
// (they read `globalThis.__audioMock`, and a jest mock factory does not run until something requires the
// module — with a purely lazy accessor that was not until the first `play()`, long after `beforeEach`).
audio();

// ── MIGRATED FROM expo-av TO expo-audio ─────────────────────────────────────
//
// `expo-av` was removed in Expo SDK 55 and stopped receiving patches before that, so this migration is
// a hard prerequisite for any SDK upgrade rather than a preference.
//
// The API differences that actually matter here, because getting any of them wrong is a silent bug:
//
//   TIME IS IN SECONDS, NOT MILLISECONDS. `AudioPlayer.currentTime`, `.duration` and `.seekTo()` are
//   all seconds; expo-av's `positionMillis` / `durationMillis` / `setPositionAsync` were milliseconds.
//   This store's public interface is milliseconds (`positionMs`, `durationMs`, `seek(ms)`) and stays
//   that way, so every boundary crossing converts explicitly. The seek de-jitter constants below are
//   in milliseconds and keep comparing against millisecond values.
//
//   PLAY/PAUSE ARE SYNCHRONOUS. `player.play()` and `player.pause()` return void, not a Promise.
//
//   THERE IS NO `getStatusAsync()` OR `setStatusAsync()`. State is read from properties on the player
//   (`playing`, `isLoaded`, `currentTime`, `duration`) and written by calling methods. `toggle()` used
//   `setStatusAsync` deliberately, for its atomic "set desired state" semantics; that primitive no
//   longer exists, so the rewind-at-end case is now an explicit `seekTo(0)` before `play()`.
//
//   THE STATUS CALLBACK IS AN EVENT SUBSCRIPTION, not a third argument to a factory. It must be
//   removed when the player is torn down or it leaks.
//
//   AUDIO MODE KEYS WERE RENAMED. `playsInSilentModeIOS` -> `playsInSilentMode`,
//   `staysActiveInBackground` -> `shouldPlayInBackground`, and `shouldDuckAndroid` is replaced by
//   `interruptionMode`. We use `'doNotMix'`: a music player wants exclusive audio focus, and the docs
//   additionally require `doNotMix` for lock-screen controls to bind to the player at all.
//
//   ANDROID BACKGROUND PLAYBACK NOW NEEDS LOCK-SCREEN CONTROLS. The docs are explicit that without
//   `setActiveForLockScreen` Android stops background audio after roughly three minutes, which would
//   be a regression against the previous `staysActiveInBackground: true`. So it is called on play with
//   the track's real metadata, and cleared on teardown.
//
// Global music playback. A single expo-audio player instance is shared app-wide so
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
  // Every track ever surfaced in the music chat (search results + manually
  // played). Capped at 200 so the full-screen player can show the user's
  // entire library, not just the last 12 plays. Persisted via the music chat's
  // own MMKV history; we just mirror it in-memory for fast access from the
  // player which is mounted globally outside the chat.
  discovered: Track[];
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
  isLoading: boolean;
  // True when the full-screen player is presented over the app.
  playerOpen: boolean;
  // Set by the music chat screen via useFocusEffect — the bottom indicator
  // hides while this is true so the user never sees BOTH the chat's inline
  // player UI AND the floating widget at once. More reliable than a pathname
  // check because focus events fire AFTER the screen is actually visible
  // and BEFORE it disappears, eliminating route-transition races.
  inMusicChat: boolean;
  setInMusicChat: (v: boolean) => void;
  openPlayer: () => void;
  closePlayer: () => void;
  addDiscovered: (tracks: Track[]) => void;
  play: (track: Track) => Promise<void>;
  toggle: () => Promise<void>;
  seek: (ms: number) => Promise<void>;
  stop: () => Promise<void>;
}

let sound: AudioPlayer | null = null;
// The `playbackStatusUpdate` subscription belonging to `sound`. expo-av took the status callback as an
// argument to the factory and disposed of it with the Sound; expo-audio makes it a separate event
// subscription, so it has to be removed by hand or every track load leaks a listener.
let soundSub: { remove: () => void } | null = null;
let audioModeSet = false;

// Monotonic token: every play()/stop() bumps it. Any async continuation or
// status callback whose captured token != playGen is stale and must no-op.
let playGen = 0;
// Serializes async playback transitions so unload→create can't interleave.
let playChain: Promise<void> = Promise.resolve();

// Seek de-jitter: after a seek() call, the audio engine takes ~200–500 ms to
// actually move. During that window the status callback still reports the OLD
// position, which would snap the slider backwards before the engine catches up
// and snaps it forward again. We track the last seek and ignore status updates
// that wildly disagree with the requested target inside the cooldown window.
let lastSeekTs = 0;
let lastSeekTarget = 0;
const SEEK_COOLDOWN_MS = 800;
const SEEK_TOLERANCE_MS = 600;

async function ensureAudioMode() {
  if (audioModeSet) return;
  try {
    await audio()?.setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true, // paired with the expo-audio plugin's enableBackgroundPlayback
      // Exclusive focus. `shouldDuckAndroid: true` used to ask other apps to lower their volume and
      // keep playing, which is right for a notification sound and wrong for a music player. It is also
      // a hard requirement for `setActiveForLockScreen` below to bind to this player.
      interruptionMode: 'doNotMix',
    });
    audioModeSet = true;
  } catch {}
}

// Fully tear down the active sound. Safe to call repeatedly.
async function unloadActiveSound() {
  const s = sound;
  const sub = soundSub;
  sound = null;
  soundSub = null;
  // Drop the status subscription FIRST. A `playbackStatusUpdate` arriving between the pause and the
  // remove below would run against a player being torn down; the generation token already makes such a
  // callback a no-op, but not receiving it at all is cheaper and removes the window entirely.
  if (sub) { try { sub.remove(); } catch {} }
  if (s) {
    // Give up the lock screen before the player goes away, or the OS keeps showing now-playing
    // metadata for a track that no longer exists.
    try { s.setActiveForLockScreen(false); } catch {}
    try { s.pause(); } catch {}
    // `remove()` replaces expo-av's stopAsync + unloadAsync pair and is synchronous. The function stays
    // async because every call site awaits it inside the serialised play chain.
    try { s.remove(); } catch {}
  }
}

// Idle-release the audio session so the OS can suspend the app when nothing is
// playing. ensureAudioMode() latches `audioModeSet` + `staysActiveInBackground`
// forever; once the sound is unloaded that background-active session keeps the
// app awake and drains battery for no reason. We drop back to a non-background
// mode and reset the latch so the next play() re-arms bg-audio via
// ensureAudioMode(). Guarded by `sound` (only release when nothing is loaded)
// so it can never interrupt an in-progress play. Never throws.
async function releaseAudioSessionIfIdle() {
  if (sound) return; // a (re)load won the race — keep the session armed
  try {
    await audio()?.setAudioModeAsync({
      shouldPlayInBackground: false,
      playsInSilentMode: true,
      interruptionMode: 'mixWithOthers',
    });
    audioModeSet = false;
  } catch {}
}

export const useMusicStore = create<MusicState>((set, get) => ({
  current: null,
  recent: [],
  discovered: [],
  isPlaying: false,
  positionMs: 0,
  durationMs: 0,
  isLoading: false,
  playerOpen: false,
  inMusicChat: false,

  setInMusicChat: (v) => set({ inMusicChat: v }),
  openPlayer: () => set({ playerOpen: true }),
  closePlayer: () => set({ playerOpen: false }),

  // Append-and-dedupe; preserves the order tracks were first seen so the
  // full-screen player's queue feels stable as the user scrolls. Cap of 200
  // is a tradeoff: enough to cover heavy usage, light enough that the queue
  // stays snappy on weak devices.
  addDiscovered: (tracks) => {
    if (!tracks || tracks.length === 0) return;
    set((s) => {
      const seen = new Set(s.discovered.map((t) => t.id));
      const additions: Track[] = [];
      for (const t of tracks) {
        if (t && t.id && !seen.has(t.id)) { seen.add(t.id); additions.push(t); }
      }
      if (additions.length === 0) return s;
      const next = [...s.discovered, ...additions].slice(-200);
      return { discovered: next };
    });
  },

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
        // `updateInterval` is expo-audio's name for `progressUpdateIntervalMillis`, and it is still
        // milliseconds. Unlike `createAsync` there is no `shouldPlay` option, so playback is started
        // explicitly below once the generation check has passed.
        const mod = audio();
        if (!mod?.createAudioPlayer) throw new Error('expo-audio unavailable');
        const s: AudioPlayer = mod.createAudioPlayer({ uri: track.streamUrl }, { updateInterval: 500 });
        const sub = s.addListener('playbackStatusUpdate', (status: AudioStatus) => {
            // Stale callback from a superseded track → ignore entirely.
            if (myGen !== playGen) return;
            if (!status.isLoaded) return;
            // SECONDS -> MILLISECONDS. This store's whole public surface is milliseconds, and so are
            // the de-jitter constants compared against these two values below.
            const reportedPos = Math.round((status.currentTime || 0) * 1000);
            const reportedDur = status.duration ? Math.round(status.duration * 1000) : track.durationMs;
            // Seek de-jitter: ignore the position update if the engine hasn't
            // caught up to a recent seek (would otherwise flicker the slider
            // back to the old position for ~500 ms before snapping forward).
            // Duration always passes through.
            const now = Date.now();
            const justSeeked = now - lastSeekTs < SEEK_COOLDOWN_MS;
            const farFromTarget = Math.abs(reportedPos - lastSeekTarget) > SEEK_TOLERANCE_MS;
            if (justSeeked && farFromTarget) {
              if (reportedDur !== get().durationMs) set({ durationMs: reportedDur });
            } else {
              // Only reflect POSITION/DURATION from the native callback. We do
              // NOT mirror `status.isPlaying` because the callback fires with a
              // delay (~50–200 ms) and would clobber the optimistic UI state set
              // synchronously by toggle()/play(). The store's `isPlaying` is the
              // single source of truth and is updated by play/toggle/stop only.
              set({ positionMs: reportedPos, durationMs: reportedDur });
            }
            if (status.didJustFinish) {
              set({ isPlaying: false, positionMs: 0 });
              // FIX 1: tear down the finished sound so native decode buffers and
              // the (bg-active) audio session don't persist after playback ends.
              // Fire-and-forget — this callback belongs to the active sound
              // (myGen === playGen was checked above), so the unload targets the
              // right Sound and can't race the generation-token logic. The next
              // toggle()/play() handles a null `sound` by reloading `current`.
              const finishedGen = myGen;
              void unloadActiveSound()
                .then(() => {
                  // FIX 2: only release the session if no newer play() started
                  // and nothing got reloaded in the meantime.
                  if (finishedGen === playGen && !sound) return releaseAudioSessionIfIdle();
                })
                .catch(() => {});
            }
        });

        // A newer play() won the race while we were creating → discard this one.
        if (myGen !== playGen) {
          try { sub.remove(); } catch {}
          try { s.remove(); } catch {}
          return;
        }

        sound = s;
        soundSub = sub;
        // Lock-screen / notification controls. Required on Android for sustained background playback
        // (without it the OS kills background audio after ~3 minutes), and a genuine improvement on
        // iOS. Metadata comes straight off the Track — `artwork` is already a remote URL.
        try {
          s.setActiveForLockScreen(true, {
            title: track.title,
            artist: track.artist,
            artworkUrl: track.artwork || undefined,
          });
        } catch {}
        // No `shouldPlay` option on `createAudioPlayer`, so start playback explicitly. Synchronous.
        try { s.play(); } catch {}
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
      // expo-av's atomic `setStatusAsync({ shouldPlay, positionMillis })` has no expo-audio
      // equivalent, so the two things it did are now two calls. State is read from properties on the
      // player rather than an awaited status object.
      if (!sound.isLoaded) {
        // Player was implicitly unloaded (e.g. audio focus loss) — reload.
        const cur = get().current;
        if (cur) {
          set({ isPlaying: false });
          await get().play(cur);
        }
        return;
      }
      // Both in SECONDS here, so the 200 ms end tolerance is 0.2.
      const atEnd = sound.currentTime >= (sound.duration || 0.001) - 0.2;
      if (wantPlay) {
        // Rewind first when the previous playthrough ran to the end, which is what the old
        // `positionMillis: 0` alongside `shouldPlay: true` achieved in one call.
        if (atEnd) sound.seekTo(0);
        sound.play();
      } else {
        sound.pause();
      }
    } catch {
      set({ isPlaying: !wantPlay });
    }
  },

  seek: async (ms: number) => {
    const target = Math.max(0, Math.floor(ms));
    // Mark the seek before mutating state so the in-flight status callback
    // (if any) can recognise this is a fresh seek and ignore stale positions.
    lastSeekTs = Date.now();
    lastSeekTarget = target;
    // Update the visible position immediately so the slider/labels jump
    // exactly to the requested point — without this, the UI would only catch
    // up on the next progressUpdate (~500 ms).
    set({ positionMs: target });
    if (!sound) return;
    try {
      // `seekTo` takes SECONDS. `target` is milliseconds — this store's public unit — so it converts
      // here. Unlike expo-av's `setStatusAsync`, seeking does not touch the play/pause state at all,
      // so there is nothing to preserve and no `shouldPlay` to pass: a seek while paused stays paused
      // and a seek while playing keeps playing, which is exactly what the old call was arranging.
      sound.seekTo(target / 1000);
    } catch {}
  },

  stop: async () => {
    // Invalidate any in-flight play() so a pending load won't resurrect playback.
    playGen++;
    await unloadActiveSound();
    set({ current: null, isPlaying: false, positionMs: 0, durationMs: 0, playerOpen: false });
    // FIX 2: with nothing loaded, drop the bg-active audio session so the OS can
    // suspend the app. Guarded by `sound` inside the helper; next play() re-arms.
    await releaseAudioSessionIfIdle();
  },
}));
