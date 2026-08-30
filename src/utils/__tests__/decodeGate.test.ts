import {
  acquireDecodeSlot,
  __decodeGateStateForTests,
  __resetDecodeGateForTests,
} from '../decodeGate';

// The gate exists because image decodes started together are slow BECAUSE they are concurrent: ten
// GIF first frames at 275-306 ms each, and later a media-dense chat commit with eight-to-eleven at
// once stretching to 533 ms. These tests pin the properties that make this a concurrency gate rather
// than the frame pump that was deleted for making the screen visibly assemble itself — the first N
// are granted SYNCHRONOUSLY, and a release admits the next one immediately rather than on a clock.
//
// ── WHY THE CAP IS DISCOVERED RATHER THAN HARD-CODED ─────────────────────────
//
// It used to be written as a literal `3` in six places. When the gate's scope widened from GIFs only
// to every media bubble the constant moved to 4, and three tests failed for a reason that had nothing
// to do with the behaviour they were describing — they were asserting the tuning, not the contract.
//
// So `CAP` is probed from the module's own test seam. Every property below then holds for any cap,
// and one dedicated test asserts the current value so a change is still deliberate and visible in a
// diff rather than silent.
function probeCap(): number {
  __resetDecodeGateForTests();
  let n = 0;
  // Ask for far more than any plausible cap; the granted count IS the cap.
  for (let i = 0; i < 64; i++) acquireDecodeSlot(() => { n += 1; });
  const cap = n;
  __resetDecodeGateForTests();
  return cap;
}

const CAP = probeCap();

describe('decodeGate', () => {
  beforeEach(() => {
    __resetDecodeGateForTests();
    jest.useRealTimers();
  });

  it('has a cap of 4', () => {
    // Pinned deliberately. 3 was chosen when only animated GIFs queued here; the gate now covers
    // every media bubble, so the value was raised with that scope change. If this fails, the constant
    // moved — confirm that was intended and update the note in decodeGate.ts alongside it.
    expect(CAP).toBe(4);
  });

  it('grants up to the cap synchronously, with no timer involved', () => {
    const granted: number[] = [];
    for (let i = 0; i < CAP; i++) acquireDecodeSlot(() => granted.push(i));
    // Synchronous is the whole point: under the limit this module must be inert.
    expect(granted).toHaveLength(CAP);
    expect(__decodeGateStateForTests()).toEqual({ inFlight: CAP, queued: 0 });
  });

  it('queues past the limit and admits the next one the instant a slot frees', () => {
    const granted: number[] = [];
    const releases: (() => void)[] = [];
    for (let i = 0; i < CAP + 2; i++) releases.push(acquireDecodeSlot(() => granted.push(i)));

    expect(granted).toHaveLength(CAP);
    expect(__decodeGateStateForTests()).toEqual({ inFlight: CAP, queued: 2 });

    releases[0]();
    // No timer, no frame — releasing admits the next one right away. This is the assertion that
    // separates a gate from a pump.
    expect(granted).toHaveLength(CAP + 1);
    expect(granted[CAP]).toBe(CAP);

    releases[1]();
    expect(granted).toHaveLength(CAP + 2);
    expect(__decodeGateStateForTests().queued).toBe(0);
  });

  it('withdraws a still-queued request so an unmounted holder never takes a slot', () => {
    const granted: number[] = [];
    const releases: (() => void)[] = [];
    for (let i = 0; i < CAP + 2; i++) releases.push(acquireDecodeSlot(() => granted.push(i)));

    // The LAST requester goes away while still waiting.
    releases[CAP + 1]();
    expect(__decodeGateStateForTests().queued).toBe(1);

    releases[0]();
    expect(granted).toHaveLength(CAP + 1);
    releases[1]();
    // It withdrew, so nothing further is granted and the pool is not leaked.
    expect(granted).toHaveLength(CAP + 1);
    expect(__decodeGateStateForTests().queued).toBe(0);
  });

  it('is idempotent, so a double release cannot inflate the pool', () => {
    const releases: (() => void)[] = [];
    for (let i = 0; i < CAP; i++) releases.push(acquireDecodeSlot(() => {}));
    releases[0]();
    releases[0]();
    releases[0]();
    expect(__decodeGateStateForTests().inFlight).toBe(CAP - 1);
  });

  it('reclaims a slot whose holder never released, rather than deadlocking', () => {
    jest.useFakeTimers();
    const granted: number[] = [];
    for (let i = 0; i < CAP + 1; i++) acquireDecodeSlot(() => granted.push(i));
    expect(granted).toHaveLength(CAP);

    // Nobody releases. Without the timeout the extra one would never decode, and `CAP` such holders
    // would stall every gated image in the app for the rest of the session.
    jest.advanceTimersByTime(1300);
    expect(granted).toHaveLength(CAP + 1);
    jest.useRealTimers();
  });
});
