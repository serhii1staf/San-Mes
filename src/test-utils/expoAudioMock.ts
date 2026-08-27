/**
 * ONE shared `expo-audio` mock, replacing nine hand-rolled `jest.mock('expo-av', ...)` blocks.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * Nine test files each carried their own copy of an `expo-av` mock. They had already drifted: some
 * tracked `callbacks`, some did not; one implemented `setStatusAsync`'s independent-fields semantics
 * faithfully and the rest stubbed it; the per-sound `playing` seed differed. Migrating nine divergent
 * copies to a new API is nine chances to encode a different idea of what the player does.
 *
 * So the mock lives here once, and each test does:
 *
 *     jest.mock('expo-audio', () => require('<path>/test-utils/expoAudioMock').createExpoAudioMock());
 *
 * `require` rather than an import because `jest.mock` factories are hoisted above imports.
 *
 * ── THE OBSERVABLE CONTRACT IS DELIBERATELY UNCHANGED ───────────────────────
 *
 * The tests inspect `globalThis.__audioMock` as `{ active, maxActive, created, callbacks }`, and that
 * shape is preserved exactly so the assertions keep meaning what they meant. In particular:
 *
 *   `active` still counts players that have been created and not yet removed, so the central invariant
 *   these suites exist to protect — never more than one sound alive at a time — is measured the same
 *   way against `remove()` as it used to be against `unloadAsync()`.
 *
 *   `callbacks` still accumulates and is NEVER spliced, even though the real subscription's `remove()`
 *   does drop the listener. The old mock had no way to unsubscribe, so tests reach for
 *   `callbacks[0]` and fire it by hand — sometimes deliberately AFTER a stop, to reproduce an orphaned
 *   status update. Honouring `remove()` here would silently turn those tests into no-ops instead of
 *   failing them, which is the worst possible outcome for a regression test.
 *
 * ── UNITS ───────────────────────────────────────────────────────────────────
 *
 * expo-audio is in SECONDS where expo-av was in milliseconds. `duration` is 1 second, which is the
 * same value the old mocks expressed as `durationMillis: 1000`.
 */
export function createExpoAudioMock() {
  const state: any = { active: 0, maxActive: 0, created: 0, callbacks: [] };
  (globalThis as any).__audioMock = state;

  const makePlayer = () => {
    // `false` initially, unlike the old mock's `true`. That is not a behaviour change: expo-av's
    // `createAsync` took `shouldPlay: true` and started playing itself, whereas `createAudioPlayer`
    // has no such option and the store calls `play()` explicitly straight after. So the player becomes
    // playing through the mocked `play()` below, one call later.
    let playing = false;
    let position = 0; // seconds

    const player: any = {
      isLoaded: true,
      duration: 1, // seconds — the old mocks' `durationMillis: 1000`
      volume: 1,
      get playing() {
        return playing;
      },
      get currentTime() {
        return position;
      },
      play: jest.fn(() => {
        playing = true;
      }),
      pause: jest.fn(() => {
        playing = false;
      }),
      seekTo: jest.fn((seconds: number) => {
        position = seconds;
      }),
      remove: jest.fn(() => {
        state.active = Math.max(0, state.active - 1);
      }),
      // Lock-screen controls are a no-op here, but they must EXIST: the store calls
      // `setActiveForLockScreen` on every successful load and again on teardown, and a missing method
      // would throw inside the store's try/catch and silently skip the rest of that block.
      setActiveForLockScreen: jest.fn(() => {}),
      clearLockScreenControls: jest.fn(() => {}),
      updateLockScreenMetadata: jest.fn(() => {}),
      replace: jest.fn(() => {}),
      setPlaybackRate: jest.fn(() => {}),
      addListener: jest.fn((_event: string, cb: any) => {
        state.callbacks.push(cb);
        // Returns a subscription whose `remove` is a real jest.fn (so a test can assert it was called)
        // but which does NOT drop the callback from `state.callbacks` — see the note above.
        return { remove: jest.fn(() => {}) };
      }),
    };
    return player;
  };

  return {
    createAudioPlayer: jest.fn((_source?: any, _options?: any) => {
      state.active += 1;
      state.created += 1;
      if (state.active > state.maxActive) state.maxActive = state.active;
      return makePlayer();
    }),
    setAudioModeAsync: jest.fn(async () => {}),
    setIsAudioActiveAsync: jest.fn(async () => {}),
    getRecordingPermissionsAsync: jest.fn(async () => ({ granted: false, status: 'undetermined' })),
    requestRecordingPermissionsAsync: jest.fn(async () => ({ granted: false, status: 'denied' })),
    RecordingPresets: { HIGH_QUALITY: {}, LOW_QUALITY: {} },
  };
}

/**
 * A status payload in the shape `AudioStatus` has, for tests that fire the `playbackStatusUpdate`
 * callback by hand.
 *
 * Takes MILLISECONDS and converts, because every one of these tests was written against expo-av and
 * reasons in milliseconds throughout (the store's own public surface still does too). Converting in one
 * helper keeps the tests readable and stops each call site from having to remember the unit change —
 * which is exactly the kind of detail that turns into a silently-passing test.
 */
export function audioStatus(opts: {
  positionMs?: number;
  durationMs?: number;
  didJustFinish?: boolean;
  isLoaded?: boolean;
}) {
  return {
    isLoaded: opts.isLoaded !== false,
    currentTime: (opts.positionMs ?? 0) / 1000,
    duration: (opts.durationMs ?? 1000) / 1000,
    didJustFinish: !!opts.didJustFinish,
    playing: true,
    isBuffering: false,
    mute: false,
    loop: false,
    playbackRate: 1,
    id: 'mock',
  };
}
