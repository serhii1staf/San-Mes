// Render tests for MiniAppConsentDialog (mini-app-content-policy-consent spec, Task 3.4).
//
// Example-based render tests (NOT property tests). They assert the dialog
// presents the content-policy rules, exposes accessible Terms/Privacy links
// that open the correct HTTPS URLs, exposes labelled Accept/Decline controls
// wired to the callbacks, localises strings (ru vs en) without leaking raw key
// identifiers, and performs the on-open accessibility behaviour (focus the
// title + modal containment).
//
// Library: Jest + react-test-renderer (matches the project's existing test
// convention — no @testing-library/react-native dependency in this repo).
//
//   _Requirements: 1.3, 3.1, 3.2, 3.3, 3.4, 3.5, 5.1, 5.5, 6.1, 6.2, 6.3, 6.4, 6.5_

import React from 'react';
import * as RN from 'react-native';
import TestRenderer, { act, ReactTestInstance } from 'react-test-renderer';

// The compiled component reads named exports from the real module object
// returned by require('react-native'). The `import * as RN` above is an interop
// copy, so getter-only exports (e.g. findNodeHandle) must be patched on this
// underlying object for the component to observe them.
const RNActual = require('react-native');

import { MiniAppConsentDialog, MiniAppConsentDialogProps } from './MiniAppConsentDialog';
import { openLegalLink } from './openLegalLink';
import { ThemeProvider } from '../../theme';
import { useI18nStore, Locale } from '../../i18n/store';
import en from '../../i18n/locales/en';
import ru from '../../i18n/locales/ru';

// ─── Mocks ──────────────────────────────────────────────────────────────────

// Mock openLegalLink so tapping the Terms/Privacy links records the call
// without triggering real Linking/navigation.
jest.mock('./openLegalLink', () => ({
  openLegalLink: jest.fn(() => Promise.resolve(true)),
}));

// Safe-area context: the component reads insets via useSafeAreaInsets; provide
// a static value and a pass-through provider so no native module is needed.
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
}));

const mockedOpenLegalLink = openLegalLink as jest.MockedFunction<typeof openLegalLink>;

const TERMS_URL = 'https://legal.san-m-app.com/terms.html';
const PRIVACY_URL = 'https://legal.san-m-app.com/privacy.html';

// ─── Helpers ──────────────────────────────────────────────────────────────

function setLocale(locale: Locale) {
  act(() => {
    useI18nStore.getState().setLocale(locale);
  });
}

function renderDialog(props: Partial<MiniAppConsentDialogProps> = {}) {
  const onAccept = props.onAccept ?? jest.fn();
  const onDecline = props.onDecline ?? jest.fn();
  const full: MiniAppConsentDialogProps = {
    visible: props.visible ?? true,
    mode: props.mode ?? 'publish',
    onAccept,
    onDecline,
  };
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <ThemeProvider>
        <MiniAppConsentDialog {...full} />
      </ThemeProvider>,
    );
  });
  return { renderer, onAccept, onDecline };
}

/** Collect every string that appears as the direct text child of a node. */
function collectStrings(renderer: TestRenderer.ReactTestRenderer): string[] {
  const out: string[] = [];
  renderer.root.findAll(() => true).forEach((node) => {
    const children = node.props?.children;
    if (typeof children === 'string') out.push(children);
    else if (Array.isArray(children)) {
      children.forEach((c) => {
        if (typeof c === 'string') out.push(c);
      });
    }
  });
  return out;
}

function hasText(renderer: TestRenderer.ReactTestRenderer, text: string): boolean {
  return collectStrings(renderer).includes(text);
}

/** Find pressable instances (composite) by accessibilityRole. */
function pressablesByRole(renderer: TestRenderer.ReactTestRenderer, role: string): ReactTestInstance[] {
  return renderer.root.findAll(
    (n) => typeof n.props?.onPress === 'function' && n.props?.accessibilityRole === role,
  );
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('MiniAppConsentDialog — render tests', () => {
  let imSpy: jest.SpyInstance;

  beforeEach(() => {
    mockedOpenLegalLink.mockClear();
    mockedOpenLegalLink.mockResolvedValue(true);
    setLocale('en');
    // Run the on-open accessibility-focus task synchronously so no
    // InteractionManager immediate stays pending past the test (which would
    // otherwise fire after the Jest environment is torn down).
    imSpy = jest
      .spyOn(RNActual.InteractionManager, 'runAfterInteractions')
      .mockImplementation((task?: any) => {
        if (typeof task === 'function') task();
        else if (task && typeof task.gen === 'function') task.gen();
        return { then: () => {}, done: () => {}, cancel: () => {} } as any;
      });
  });

  afterEach(() => {
    imSpy.mockRestore();
  });

  it('1. renders Accept, Decline and the rules text (title, prohibited body, stores, san_policies)', () => {
    const { renderer } = renderDialog({ mode: 'publish' });

    // Accept (publish label) + Decline.
    expect(hasText(renderer, en['mini_apps.consent.accept'])).toBe(true);
    expect(hasText(renderer, en['mini_apps.consent.decline'])).toBe(true);

    // Rules text.
    expect(hasText(renderer, en['mini_apps.consent.title'])).toBe(true);
    expect(hasText(renderer, en['mini_apps.consent.prohibited_body'])).toBe(true);
    expect(hasText(renderer, en['mini_apps.consent.stores'])).toBe(true);
    expect(hasText(renderer, en['mini_apps.consent.san_policies'])).toBe(true);
  });

  it('2. Terms/Privacy links have role=link, non-empty labels, and open the correct HTTPS URLs', () => {
    const { renderer } = renderDialog();

    const links = pressablesByRole(renderer, 'link');
    expect(links).toHaveLength(2);

    // Non-empty accessibility labels.
    links.forEach((link) => {
      expect(typeof link.props.accessibilityLabel).toBe('string');
      expect(link.props.accessibilityLabel.length).toBeGreaterThan(0);
    });

    // Match links to their target by visible label text.
    const termsLink = links.find((l) => l.props.accessibilityLabel === en['mini_apps.consent.terms_link_a11y']);
    const privacyLink = links.find((l) => l.props.accessibilityLabel === en['mini_apps.consent.privacy_link_a11y']);
    expect(termsLink).toBeDefined();
    expect(privacyLink).toBeDefined();

    act(() => {
      termsLink!.props.onPress();
    });
    expect(mockedOpenLegalLink).toHaveBeenCalledWith(TERMS_URL, expect.any(Function));

    act(() => {
      privacyLink!.props.onPress();
    });
    expect(mockedOpenLegalLink).toHaveBeenCalledWith(PRIVACY_URL, expect.any(Function));
  });

  it('3. Accept/Decline have non-empty labels and pressing them invokes onAccept/onDecline', () => {
    const { renderer, onAccept, onDecline } = renderDialog();

    const buttons = pressablesByRole(renderer, 'button');
    const acceptBtn = buttons.find((b) => b.props.accessibilityLabel === en['mini_apps.consent.accept_a11y']);
    const declineBtn = buttons.find((b) => b.props.accessibilityLabel === en['mini_apps.consent.decline_a11y']);

    expect(acceptBtn).toBeDefined();
    expect(declineBtn).toBeDefined();
    expect(acceptBtn!.props.accessibilityLabel.length).toBeGreaterThan(0);
    expect(declineBtn!.props.accessibilityLabel.length).toBeGreaterThan(0);

    act(() => {
      acceptBtn!.props.onPress();
    });
    expect(onAccept).toHaveBeenCalledTimes(1);

    act(() => {
      declineBtn!.props.onPress();
    });
    expect(onDecline).toHaveBeenCalledTimes(1);
  });

  it('4. ru vs en locale yields different strings and no raw key identifiers leak', () => {
    // Both renderers subscribe to the same i18n store, so capture each
    // locale's strings and unmount before switching to avoid re-rendering the
    // first tree into the new locale.
    setLocale('en');
    const enRender = renderDialog().renderer;
    const enStrings = collectStrings(enRender);
    act(() => enRender.unmount());

    setLocale('ru');
    const ruRender = renderDialog().renderer;
    const ruStrings = collectStrings(ruRender);
    act(() => ruRender.unmount());

    // Localised title is present in each locale's render and differs.
    expect(enStrings).toContain(en['mini_apps.consent.title']);
    expect(ruStrings).toContain(ru['mini_apps.consent.title']);
    expect(en['mini_apps.consent.title']).not.toBe(ru['mini_apps.consent.title']);

    // No raw key identifiers ('mini_apps.consent.') should be visible in either.
    const leaks = [...enStrings, ...ruStrings].filter((s) => s.includes('mini_apps.consent.'));
    expect(leaks).toEqual([]);
  });

  it('5. on open, AccessibilityInfo.setAccessibilityFocus is called and the card is accessibilityViewIsModal', () => {
    const focusSpy = jest.spyOn(RNActual.AccessibilityInfo, 'setAccessibilityFocus').mockImplementation(() => {});
    // findNodeHandle is a getter-only export on the react-native module object;
    // patch the underlying getter so the title ref resolves to a non-null
    // handle and the focus branch runs.
    const origDesc = Object.getOwnPropertyDescriptor(RNActual, 'findNodeHandle');
    Object.defineProperty(RNActual, 'findNodeHandle', { configurable: true, get: () => () => 1 });

    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ThemeProvider>
          <MiniAppConsentDialog visible mode="publish" onAccept={jest.fn()} onDecline={jest.fn()} />
        </ThemeProvider>,
        // react-test-renderer returns null for host refs by default; provide a
        // node mock so the title ref is non-null and the focus branch runs.
        { createNodeMock: () => ({}) },
      );
    });

    expect(focusSpy).toHaveBeenCalledWith(1);

    const modalContainer = renderer.root.findAll((n) => n.props?.accessibilityViewIsModal === true);
    expect(modalContainer.length).toBeGreaterThanOrEqual(1);

    act(() => renderer.unmount());
    focusSpy.mockRestore();
    if (origDesc) Object.defineProperty(RNActual, 'findNodeHandle', origDesc);
  });

  it('renders the edit-mode accept label when mode="edit"', () => {
    const { renderer } = renderDialog({ mode: 'edit' });
    expect(hasText(renderer, en['mini_apps.consent.accept_edit'])).toBe(true);
  });
});
