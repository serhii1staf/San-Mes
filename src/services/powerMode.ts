// Low Power Mode awareness.
//
// WHY THIS MATTERS MORE THAN IT LOOKS
//   iOS Low Power Mode caps the display refresh rate (120 Hz → 60, and animation
//   callbacks effectively to 30) and throttles CPU/GPU. An app that keeps asking
//   for the same work per frame does not degrade proportionally — it degrades
//   catastrophically, because every frame now has roughly half the budget and any
//   JS-driven animation misses its deadline on most frames.
//
//   `expo-battery` was already in package.json and imported NOWHERE, so the app
//   had no idea this state existed. That is the whole reason the app "lags when the
//   battery is low": nothing adapted.
//
// THREE STATES, NOT A BOOLEAN
//   `unknown` is not the same as `off`. The native module is absent from every
//   binary currently installed, so an OTA-delivered bundle must behave EXACTLY as
//   before rather than guessing. Conflating unknown with off would be harmless
//   here; conflating it with on would silently degrade every existing install.
//
// DELIVERY
//   Reading the module requires a new native build. The `require` is wrapped so an
//   OTA bundle running on today's binaries resolves to `unknown` instead of
//   throwing and taking the whole bundle down. No new permission is involved — on
//   iOS this reads `ProcessInfo.isLowPowerModeEnabled`, which needs no
//   usage-description string.

export type PowerMode = 'unknown' | 'normal' | 'low_power';

type Listener = (mode: PowerMode) => void;

let current: PowerMode = 'unknown';
let installed = false;
const listeners = new Set<Listener>();

function setMode(next: PowerMode): void {
  if (next === current) return;
  current = next;
  // Copy before iterating: a listener may unsubscribe during notification.
  for (const l of Array.from(listeners)) {
    try {
      l(next);
    } catch {
      // A throwing consumer must not stop the others from being told.
    }
  }
}

/** Current mode. Safe from any context, including module scope. */
export function getPowerMode(): PowerMode {
  return current;
}

export function subscribePowerMode(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True only when we positively know the device is in Low Power Mode. */
export function isLowPower(): boolean {
  return current === 'low_power';
}

/**
 * Start watching Low Power Mode. Idempotent; returns a disposer.
 *
 * Every failure path lands on `unknown`, which means "behave exactly as before".
 */
export function installPowerMode(): () => void {
  if (installed) return () => {};
  installed = true;

  let Battery: {
    isLowPowerModeEnabledAsync?: () => Promise<boolean>;
    addLowPowerModeListener?: (cb: (e: { lowPowerMode: boolean }) => void) => { remove: () => void };
  } | null = null;

  try {
    // Deliberately a lazy require inside try/catch, not a top-level import: this
    // bundle can execute on a binary that does not contain the native module, and
    // a top-level import would fail at module-eval and break the whole app.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Battery = require('expo-battery');
  } catch {
    setMode('unknown');
    installed = false;
    return () => {};
  }

  if (!Battery?.isLowPowerModeEnabledAsync || !Battery?.addLowPowerModeListener) {
    setMode('unknown');
    installed = false;
    return () => {};
  }

  Battery.isLowPowerModeEnabledAsync()
    .then((on) => setMode(on ? 'low_power' : 'normal'))
    .catch(() => setMode('unknown'));

  let sub: { remove: () => void } | null = null;
  try {
    sub = Battery.addLowPowerModeListener(({ lowPowerMode }) =>
      setMode(lowPowerMode ? 'low_power' : 'normal'),
    );
  } catch {
    // Initial read still applies; we just won't see mid-session changes.
  }

  return () => {
    try {
      sub?.remove();
    } catch {
      /* nothing actionable */
    }
    installed = false;
  };
}
