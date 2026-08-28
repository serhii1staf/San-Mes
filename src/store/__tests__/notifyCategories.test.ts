/**
 * Pins the per-category alert gate.
 *
 * The important cases are the two fail-open ones. A preference that cannot be read must never
 * swallow a notification — that is the same rule `shouldPresent` follows for an unrecognised payload
 * type, and it is what stops a storage hiccup from silently muting the whole app.
 */
import { useSettingsStore, isAlertCategoryEnabled } from '../settingsStore';

const ALL_ON = { message: true, comment: true, follow: true, like: true };

beforeEach(() => {
  useSettingsStore.setState({ notifyCategories: { ...ALL_ON } });
});

describe('isAlertCategoryEnabled', () => {
  it('defaults every category to on, so adding the field changes nothing', () => {
    for (const k of ['message', 'comment', 'follow', 'like'] as const) {
      expect(isAlertCategoryEnabled(k)).toBe(true);
    }
  });

  it('reports a muted category as disabled', () => {
    useSettingsStore.getState().setNotifyCategory('like', false);
    expect(isAlertCategoryEnabled('like')).toBe(false);
  });

  it('mutes only the category asked for', () => {
    useSettingsStore.getState().setNotifyCategory('comment', false);
    expect(isAlertCategoryEnabled('comment')).toBe(false);
    expect(isAlertCategoryEnabled('message')).toBe(true);
    expect(isAlertCategoryEnabled('follow')).toBe(true);
    expect(isAlertCategoryEnabled('like')).toBe(true);
  });

  it('re-enabling restores it', () => {
    const s = useSettingsStore.getState();
    s.setNotifyCategory('message', false);
    expect(isAlertCategoryEnabled('message')).toBe(false);
    useSettingsStore.getState().setNotifyCategory('message', true);
    expect(isAlertCategoryEnabled('message')).toBe(true);
  });

  it('fails OPEN when the whole map is missing — a storage hiccup must not mute the app', () => {
    useSettingsStore.setState({ notifyCategories: undefined as any });
    expect(isAlertCategoryEnabled('message')).toBe(true);
  });

  it('fails OPEN for a key the stored map does not carry', () => {
    // What an install persisted before a future category was added.
    useSettingsStore.setState({ notifyCategories: { message: false } as any });
    expect(isAlertCategoryEnabled('message')).toBe(false);
    expect(isAlertCategoryEnabled('like')).toBe(true);
  });

  it('treats only an explicit false as off, not any falsy value', () => {
    useSettingsStore.setState({ notifyCategories: { ...ALL_ON, follow: undefined } as any });
    expect(isAlertCategoryEnabled('follow')).toBe(true);
  });
});
