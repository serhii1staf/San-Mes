// Render test for MiniAppsScreen — HTTPS legal links in the create/edit form
// (mini-app-content-policy-consent spec, Task 5.10).
//
// Example-based render test (NOT a property test). It mounts the real screen
// headlessly, reveals the create/edit form by pressing the header "+" toggle,
// and asserts the form renders exactly two tappable HTTPS legal links (Terms,
// Privacy) with accessibilityRole="link" and non-empty visible text, each
// opening the correct HTTPS URL via openLegalLink.
//
// Library: Jest + react-test-renderer (matches the repo convention used by
// MiniAppConsentDialog.test.tsx — no @testing-library/react-native dependency).
//
//   _Requirements: 9.1, 9.2_

import React from 'react';
import TestRenderer, { act, ReactTestInstance } from 'react-test-renderer';

import { ThemeProvider } from '../../src/theme';
import { useI18nStore, Locale } from '../../src/i18n/store';
import en from '../../src/i18n/locales/en';
import { openLegalLink } from '../../src/components/mini-apps/openLegalLink';

// ─── Mocks ──────────────────────────────────────────────────────────────────

// Record openLegalLink calls without touching real Linking/navigation.
jest.mock('../../src/components/mini-apps/openLegalLink', () => ({
  openLegalLink: jest.fn(() => Promise.resolve(true)),
}));

// Keep the consent dialog a no-op so the test stays focused on the form links.
jest.mock('../../src/components/mini-apps/MiniAppConsentDialog', () => ({
  MiniAppConsentDialog: () => null,
}));

// Safe-area context: static insets + pass-through provider, no native module.
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// expo-router: the screen only calls router.back / router.push on other paths.
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
}));

// The ui barrel (src/components/ui) transitively pulls in WebView/YouTube
// media viewers whose native modules aren't registered under jest — stub them.
jest.mock('react-native-webview', () => ({ WebView: () => null }));
jest.mock('react-native-youtube-iframe', () => ({ __esModule: true, default: () => null }));

// Heavy/native-only presentation modules → simple pass-throughs so the tree
// renders headlessly.
jest.mock('expo-linear-gradient', () => ({
  LinearGradient: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));
jest.mock('expo-blur', () => ({
  BlurView: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));
jest.mock('@expo/vector-icons', () => ({
  Feather: () => null,
}));
jest.mock('../../src/components/ui/LiquidGlass', () => ({
  useLiquidGlassActive: () => false,
  NativeGlassView: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));

// Auth store — return a logged-in user via the selector pattern the screen uses.
jest.mock('../../src/store', () => ({
  useAuthStore: (selector: (s: any) => any) => selector({ user: { id: 'user-1' } }),
}));

// Mini-apps store — empty list, not loading, action selectors as no-ops.
jest.mock('../../src/store/miniAppsStore', () => ({
  useMiniAppsStore: (selector: (s: any) => any) =>
    selector({
      apps: [],
      isLoading: false,
      loadApps: () => {},
      createApp: () => {},
      updateApp: () => {},
      deleteApp: () => {},
    }),
}));

import MiniAppsScreen from './mini-apps';

const mockedOpenLegalLink = openLegalLink as jest.MockedFunction<typeof openLegalLink>;

const TERMS_URL = 'https://legal.san-m-app.com/terms.html';
const PRIVACY_URL = 'https://legal.san-m-app.com/privacy.html';

// ─── Helpers ──────────────────────────────────────────────────────────────

function setLocale(locale: Locale) {
  act(() => {
    useI18nStore.getState().setLocale(locale);
  });
}

function renderScreen() {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <ThemeProvider>
        <MiniAppsScreen />
      </ThemeProvider>,
      { createNodeMock: () => ({}) },
    );
  });
  return renderer;
}

/** All composite Pressables with an onPress handler, in tree order. */
function allPressables(renderer: TestRenderer.ReactTestRenderer): ReactTestInstance[] {
  return renderer.root.findAll((n) => typeof n.props?.onPress === 'function');
}

function linksByRole(renderer: TestRenderer.ReactTestRenderer): ReactTestInstance[] {
  return renderer.root.findAll(
    (n) => typeof n.props?.onPress === 'function' && n.props?.accessibilityRole === 'link',
  );
}

/** Collect every direct string text child under an instance subtree. */
function visibleStrings(instance: ReactTestInstance): string[] {
  const out: string[] = [];
  instance.findAll(() => true).forEach((node) => {
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

/** Reveal the create/edit form by pressing the header "+" toggle. */
function openForm(renderer: TestRenderer.ReactTestRenderer) {
  // With showCreate=false the only Pressables are the two header buttons
  // (back, then the "+" toggle). Press the "+" toggle to mount the form.
  const before = allPressables(renderer);
  // The plus toggle is the last header pressable; press from the end until the
  // form's link controls appear, so we don't depend on an exact index.
  for (let i = before.length - 1; i >= 0; i--) {
    act(() => {
      before[i].props.onPress();
    });
    if (linksByRole(renderer).length === 2) return;
  }
}

// ─── Test ─────────────────────────────────────────────────────────────────

describe('MiniAppsScreen — HTTPS legal links (Task 5.10)', () => {
  beforeEach(() => {
    mockedOpenLegalLink.mockClear();
    mockedOpenLegalLink.mockResolvedValue(true);
    setLocale('en');
  });

  it('renders two tappable HTTPS Terms/Privacy links that open the correct URLs', () => {
    const renderer = renderScreen();

    // Links only mount once the create/edit form is shown.
    expect(linksByRole(renderer)).toHaveLength(0);

    openForm(renderer);

    const links = linksByRole(renderer);
    expect(links).toHaveLength(2);

    // Each link has non-empty visible text.
    links.forEach((link) => {
      const strings = visibleStrings(link).filter((s) => s.trim().length > 0);
      expect(strings.length).toBeGreaterThan(0);
    });

    // Visible labels come from the consent i18n keys.
    const termsText = visibleStrings(links[0]);
    const privacyText = visibleStrings(links[1]);
    expect(termsText).toContain(en['mini_apps.consent.terms_link']);
    expect(privacyText).toContain(en['mini_apps.consent.privacy_link']);

    // Press Terms → opens the HTTPS terms page.
    act(() => {
      links[0].props.onPress();
    });
    expect(mockedOpenLegalLink).toHaveBeenCalledWith(TERMS_URL);

    // Press Privacy → opens the HTTPS privacy page.
    act(() => {
      links[1].props.onPress();
    });
    expect(mockedOpenLegalLink).toHaveBeenCalledWith(PRIVACY_URL);

    act(() => renderer.unmount());
  });
});
