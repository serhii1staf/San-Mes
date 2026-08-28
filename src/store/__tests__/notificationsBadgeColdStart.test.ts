/**
 * Pins the cold-start hole: `AppState.addEventListener('change')` fires on a TRANSITION, and on a fresh
 * launch the app is already `active`, so the listener never fired and `reconcile` — reachable from
 * nowhere else in the codebase — never ran. The chat-list and bottom-bar counters were therefore
 * unreachable on launch, and backgrounding the app was the accidental workaround.
 */
type AppStateHandler = (state: string) => void;

const mockAddEventListener = jest.fn(
  (_type: string, _handler: AppStateHandler) => ({ remove: jest.fn() }),
);
const mockCurrentState = { value: 'active' as string };

jest.mock('react-native', () => ({
  AppState: {
    addEventListener: (type: string, handler: AppStateHandler) => mockAddEventListener(type, handler),
    get currentState() {
      return mockCurrentState.value;
    },
  },
}));

const mockRecompute = jest.fn();
const mockRefresh = jest.fn(() => Promise.resolve());

jest.mock('../notificationsBadgeStore', () => {
  const actual = jest.requireActual('../notificationsBadgeStore');
  return actual;
});

describe('installNotificationsBadgeForegroundRefresh', () => {
  beforeEach(() => {
    jest.resetModules();
    mockAddEventListener.mockClear();
    mockRecompute.mockClear();
    mockRefresh.mockClear();
    mockCurrentState.value = 'active';
  });

  function loadWithStubbedStore() {
    // The module computes its initial state at import, so it is loaded fresh per test and the store's
    // two mutators are stubbed afterwards — the assertion is about WHETHER the pass runs on launch,
    // not about what the pass computes.
    const mod = require('../notificationsBadgeStore');
    const st = mod.useNotificationsBadge.getState();
    mod.useNotificationsBadge.setState({
      ...st,
      recompute: mockRecompute,
      refresh: mockRefresh,
    });
    return mod;
  }

  // ── THE LAUNCH PASS MUST WAIT FOR AUTH ──────────────────────────────────────
  //
  // This test used to assert the pass runs unconditionally at install, and it passed while the feature
  // was still broken on device. That is the useful lesson: `installNotificationsBadgeForegroundRefresh`
  // is called at MODULE SCOPE from `app/_layout.tsx`, before `authStore` finishes rehydrating from
  // AsyncStorage, so `refreshChatUnreadOnResume` hit `if (!uid) return;` and did nothing — every launch.
  // "The pass ran" was true and worthless; what matters is whether it ran with a user id.

  it('does NOT run the launch pass while auth is still unhydrated', () => {
    const mod = loadWithStubbedStore();
    mod.installNotificationsBadgeForegroundRefresh();
    // No user id yet — running here is exactly the no-op that made two previous fixes ineffective.
    expect(mockRecompute).not.toHaveBeenCalled();
  });

  it('runs the launch pass once auth hydrates with a user id', () => {
    const mod = loadWithStubbedStore();
    mod.installNotificationsBadgeForegroundRefresh();
    expect(mockRecompute).not.toHaveBeenCalled();

    // What zustand's persist rehydration does a native round trip later.
    const auth = require('../authStore').useAuthStore;
    auth.setState({ user: { id: 'u1' }, hasHydrated: true });

    expect(mockRecompute).toHaveBeenCalled();
    expect(mockRefresh).toHaveBeenCalledWith({ force: true });
  });

  it('runs immediately when a user id is already present at install', () => {
    const auth = require('../authStore').useAuthStore;
    auth.setState({ user: { id: 'u1' }, hasHydrated: true });
    const mod = loadWithStubbedStore();
    mod.installNotificationsBadgeForegroundRefresh();
    expect(mockRecompute).toHaveBeenCalled();
  });

  it('fires the launch pass only ONCE even if auth changes again', () => {
    const mod = loadWithStubbedStore();
    mod.installNotificationsBadgeForegroundRefresh();
    const auth = require('../authStore').useAuthStore;
    auth.setState({ user: { id: 'u1' }, hasHydrated: true });
    const callsAfterFirst = mockRecompute.mock.calls.length;
    auth.setState({ user: { id: 'u2' }, hasHydrated: true });
    expect(mockRecompute.mock.calls.length).toBe(callsAfterFirst);
  });

  it('still registers the resume listener', () => {
    const mod = loadWithStubbedStore();
    mod.installNotificationsBadgeForegroundRefresh();
    expect(mockAddEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('does not run the launch pass when the app starts in the background', () => {
    mockCurrentState.value = 'background';
    const mod = loadWithStubbedStore();
    mod.installNotificationsBadgeForegroundRefresh();
    expect(mockRecompute).not.toHaveBeenCalled();
    // The listener is still armed, so the pass happens on the transition to active instead.
    expect(mockAddEventListener).toHaveBeenCalled();
  });

  // Deliberately NOT asserting the listener body's `next !== 'active'` guard here. That is pre-existing
  // code this change does not touch, and driving it through the module-level `react-native` mock tests
  // the mock more than the app. The behaviour this commit adds is the launch pass, which is what the
  // three cases above pin.
});
