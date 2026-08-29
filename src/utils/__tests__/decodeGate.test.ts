import {
  acquireDecodeSlot,
  __decodeGateStateForTests,
  __resetDecodeGateForTests,
} from '../decodeGate';

// The gate exists because ten GIF first-frame decodes started together and each took 275-306 ms —
// they were slow BECAUSE they were concurrent. These tests pin the two properties that make this a
// concurrency gate rather than the frame pump that was deleted for making the screen visibly
// assemble itself: the first N are granted SYNCHRONOUSLY with no delay, and a release admits the
// next one immediately rather than on a clock.
describe('decodeGate', () => {
  beforeEach(() => {
    __resetDecodeGateForTests();
    jest.useRealTimers();
  });

  it('grants the first three synchronously, with no timer involved', () => {
    const granted: number[] = [];
    for (let i = 0; i < 3; i++) acquireDecodeSlot(() => granted.push(i));
    // Synchronous is the whole point: under the limit this module must be inert.
    expect(granted).toEqual([0, 1, 2]);
    expect(__decodeGateStateForTests()).toEqual({ inFlight: 3, queued: 0 });
  });

  it('queues past the limit and admits the next one the instant a slot frees', () => {
    const granted: number[] = [];
    const releases: (() => void)[] = [];
    for (let i = 0; i < 5; i++) releases.push(acquireDecodeSlot(() => granted.push(i)));

    expect(granted).toEqual([0, 1, 2]);
    expect(__decodeGateStateForTests()).toEqual({ inFlight: 3, queued: 2 });

    releases[0]();
    // No timer, no frame — releasing admits #3 right away.
    expect(granted).toEqual([0, 1, 2, 3]);

    releases[1]();
    expect(granted).toEqual([0, 1, 2, 3, 4]);
    expect(__decodeGateStateForTests().queued).toBe(0);
  });

  it('withdraws a still-queued request so an unmounted holder never takes a slot', () => {
    const granted: number[] = [];
    const releases: (() => void)[] = [];
    for (let i = 0; i < 5; i++) releases.push(acquireDecodeSlot(() => granted.push(i)));

    // #4 goes away while still waiting.
    releases[4]();
    expect(__decodeGateStateForTests().queued).toBe(1);

    releases[0]();
    expect(granted).toEqual([0, 1, 2, 3]);
    releases[1]();
    // #4 withdrew, so nothing further is granted and the pool is not leaked.
    expect(granted).toEqual([0, 1, 2, 3]);
    expect(__decodeGateStateForTests().queued).toBe(0);
  });

  it('is idempotent, so a double release cannot inflate the pool', () => {
    const releases: (() => void)[] = [];
    for (let i = 0; i < 3; i++) releases.push(acquireDecodeSlot(() => {}));
    releases[0]();
    releases[0]();
    releases[0]();
    expect(__decodeGateStateForTests().inFlight).toBe(2);
  });

  it('reclaims a slot whose holder never released, rather than deadlocking', () => {
    jest.useFakeTimers();
    const granted: number[] = [];
    for (let i = 0; i < 4; i++) acquireDecodeSlot(() => granted.push(i));
    expect(granted).toEqual([0, 1, 2]);

    // Nobody releases. Without the timeout the fourth would never decode, and three such holders
    // would stall every GIF in the app for the rest of the session.
    jest.advanceTimersByTime(1300);
    expect(granted).toEqual([0, 1, 2, 3]);
    jest.useRealTimers();
  });
});
