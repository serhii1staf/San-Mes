/**
 * Pins the two bugs that made the app-icon number wrong, both of which came from a single store
 * writing the whole number while only knowing part of it.
 */
import {
  setNotificationsBadgePart,
  setChatBadgePart,
  __resetOsBadgeForTests,
} from '../osBadge';

// Must be `mock`-prefixed: `jest.mock` is hoisted above these declarations and
// `babel-plugin-jest-hoist` only lets the factory close over identifiers starting with `mock`.
const mockSetOsBadgeCount = jest.fn<Promise<void>, [number]>(() => Promise.resolve());

jest.mock('../pushNotifications', () => ({
  setOsBadgeCount: (n: number) => mockSetOsBadgeCount(n),
}));

/** The native write is fire-and-forget, so let the queue drain before asserting. Kept even though the
 *  lazy `require` now records synchronously — it costs nothing and stops the assertions from silently
 *  depending on that staying true. */
const settle = () => new Promise<void>((r) => setImmediate(r));

beforeEach(() => {
  mockSetOsBadgeCount.mockClear();
  __resetOsBadgeForTests();
});

describe('osBadge', () => {
  it('adds unread DMs to the icon — the count the notifications feed cannot carry', async () => {
    // `NotificationKind` is 'like' | 'comment' | 'follow', so this is the messenger's main case:
    // unread messages, nothing else. It used to produce no number at all.
    setChatBadgePart(3);
    await settle();
    expect(mockSetOsBadgeCount).toHaveBeenCalledWith(3);
  });

  it('sums the two components', async () => {
    setNotificationsBadgePart(2);
    setChatBadgePart(3);
    await settle();
    expect(mockSetOsBadgeCount).toHaveBeenLastCalledWith(5);
  });

  it('clearing notifications does not wipe unread DMs from the icon', async () => {
    setChatBadgePart(4);
    setNotificationsBadgePart(2);
    await settle();
    expect(mockSetOsBadgeCount).toHaveBeenLastCalledWith(6);

    // What `markAllSeen()` does when the notifications screen is opened. It used to push a hard 0.
    setNotificationsBadgePart(0);
    await settle();
    expect(mockSetOsBadgeCount).toHaveBeenLastCalledWith(4);
  });

  it('does not call the OS when the total is unchanged', async () => {
    setChatBadgePart(1);
    await settle();
    expect(mockSetOsBadgeCount).toHaveBeenCalledTimes(1);

    // `clear` on an already-zero conversation re-persists and re-reports the same total.
    setChatBadgePart(1);
    await settle();
    expect(mockSetOsBadgeCount).toHaveBeenCalledTimes(1);
  });

  it('writes a first value of 0 so a restored-empty icon is actively cleared', async () => {
    setChatBadgePart(0);
    await settle();
    expect(mockSetOsBadgeCount).toHaveBeenCalledWith(0);
  });

  it('treats negative and non-finite reports as 0 rather than corrupting the total', async () => {
    setNotificationsBadgePart(5);
    await settle();
    setChatBadgePart(Number.NaN);
    setNotificationsBadgePart(-2);
    await settle();
    expect(mockSetOsBadgeCount).toHaveBeenLastCalledWith(0);
  });
});
