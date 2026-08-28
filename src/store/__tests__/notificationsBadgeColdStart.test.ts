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

  it('runs a refresh pass at install when the app is already active (cold start)', () => {
    const mod = loadWithStubbedStore();
    mod.installNotificationsBadgeForegroundRefresh();
    expect(mockRecompute).toHaveBeenCalled();
    expect(mockRefresh).toHaveBeenCalledWith({ force: true });
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
