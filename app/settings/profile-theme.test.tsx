// Example / render tests for the Theme_Selection_Screen — `app/settings/profile-theme.tsx`
// (seasonal-profile-themes spec, Task 7.4). Example-based, NOT property tests.
//
// These mount the real screen headlessly and assert the three behaviours the
// task calls out:
//
//   * Renders one selectable preview per BUILT_IN_THEME_LIST entry — six
//     previews, one per built-in theme (Req 2.1).
//   * Marks exactly one preview as selected: the persisted Theme_Id when one is
//     stored, otherwise (no persisted id) the Default_Theme `default-dark`
//     (Req 2.2, 2.3) — including falling back through the auth user's stored
//     `themeId` and collapsing an unknown stored id to the default.
//   * Mirrors `appearance.tsx`'s deferred-mount + virtualized-FlatList config:
//     the carousel mounts only after `InteractionManager` interactions settle
//     (the `cardsReady` gate), and the FlatList carries the tight
//     virtualization props (Req 9.4, 2.7).
//
// Library: Jest + react-test-renderer (the repo convention — there is no
// @testing-library/react-native dependency; see mini-apps.test.tsx and
// ProfileThemeContext.property.test.tsx).
//
//   _Requirements: 2.1, 2.2, 2.3, 9.4_

import React from 'react';
import { ActivityIndicator, FlatList, InteractionManager } from 'react-native';
import TestRenderer, { act, ReactTestInstance } from 'react-test-renderer';

import {
  BUILT_IN_THEME_LIST,
  DEFAULT_THEME_ID,
  type ProfileTheme,
} from '../../src/theme/profileThemes';
import { ProfileThemePreviewCard } from '../../src/components/profile/ProfileThemePreviewCard';

// ─── Controllable mock state ─────────────────────────────────────────────────
// (jest.mock factories may only close over vars prefixed `mock*`.)

let mockActiveThemeId: string | undefined; // per-account stored Theme_Id mirror
let mockUserThemeId: string | undefined; // auth user's row `themeId`
const mockSetThemeId = jest.fn();
const mockRevertThemeId = jest.fn();
const mockGetThemeId = jest.fn(() => mockActiveThemeId);
const mockUpdateProfile = jest.fn(() => Promise.resolve({ error: null }));

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Per-account owner-theme store: drive what the screen treats as the persisted
// selection without touching MMKV/AsyncStorage.
jest.mock('../../src/store/profileThemeStore', () => {
  const store = (selector: (s: any) => any) =>
    selector({
      setThemeId: mockSetThemeId,
      revertThemeId: mockRevertThemeId,
      getThemeId: mockGetThemeId,
    });
  (store as any).getState = () => ({
    setThemeId: mockSetThemeId,
    revertThemeId: mockRevertThemeId,
    getThemeId: mockGetThemeId,
  });
  return {
    useProfileThemeStore: store,
    useActiveProfileThemeId: () => mockActiveThemeId,
  };
});

// Auth store: a logged-in account whose row `themeId` is controllable.
jest.mock('../../src/store/authStore', () => ({
  useAuthStore: (selector: (s: any) => any) =>
    selector({
      user: { id: 'acc-1', themeId: mockUserThemeId },
      updateProfile: jest.fn(),
    }),
}));

// Profile persistence: never hit the network.
jest.mock('../../src/lib/supabase', () => ({
  updateProfile: (...args: unknown[]) => mockUpdateProfile(...(args as [])),
}));

// Safe-area context: static insets + pass-through provider.
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// expo-router: the screen only calls router.back().
jest.mock('expo-router', () => ({
  router: { back: jest.fn() },
}));

// Heavy / native-only presentation modules → simple pass-throughs so the tree
// renders headlessly and deterministically (the preview card uses
// expo-linear-gradient + expo-image; the ui barrel transitively pulls in the
// WebView/YouTube media viewers and the liquid-glass native view).
jest.mock('expo-linear-gradient', () => ({
  LinearGradient: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));
jest.mock('expo-image', () => ({
  Image: () => null,
}));
jest.mock('@expo/vector-icons', () => ({
  Feather: () => null,
}));
jest.mock('react-native-webview', () => ({ WebView: () => null }));
jest.mock('react-native-youtube-iframe', () => ({ __esModule: true, default: () => null }));
jest.mock('../../src/components/ui/LiquidGlass', () => ({
  useLiquidGlassActive: () => false,
  NativeGlassView: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));

import { ThemeProvider } from '../../src/theme';
import ProfileThemeScreen from './profile-theme';

// ─── Deferred-mount control ───────────────────────────────────────────────────
// Capture the InteractionManager callback the screen schedules for `cardsReady`
// so we can flush it deterministically and assert the pre/post-defer states.

let interactionCallbacks: Array<() => void> = [];
let runAfterInteractionsSpy: jest.SpyInstance;

beforeEach(() => {
  mockActiveThemeId = undefined;
  mockUserThemeId = undefined;
  interactionCallbacks = [];
  mockSetThemeId.mockClear();
  mockRevertThemeId.mockClear();
  mockUpdateProfile.mockClear();

  runAfterInteractionsSpy = jest
    .spyOn(InteractionManager, 'runAfterInteractions')
    .mockImplementation((cb?: any) => {
      if (typeof cb === 'function') interactionCallbacks.push(cb);
      return { cancel: jest.fn(), then: jest.fn(), done: jest.fn() } as any;
    });
});

afterEach(() => {
  runAfterInteractionsSpy.mockRestore();
});

// ─── Helpers ───────────────────────────────────────────────────────────────-

function renderScreen(): TestRenderer.ReactTestRenderer {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <ThemeProvider>
        <ProfileThemeScreen />
      </ThemeProvider>,
      // FlatList ref needs a node with scrollToIndex so the auto-center effect
      // doesn't trip on a null ref.
      { createNodeMock: () => ({ scrollToIndex: jest.fn() }) },
    );
  });
  return renderer;
}

/** Run the deferred `cardsReady` interaction callback(s) → mounts the carousel. */
function flushInteractions() {
  act(() => {
    interactionCallbacks.splice(0).forEach((cb) => cb());
  });
}

function getFlatList(renderer: TestRenderer.ReactTestRenderer): ReactTestInstance {
  return renderer.root.findByType(FlatList);
}

/**
 * Invoke the FlatList's `renderItem` for one entry and return the
 * ProfileThemePreviewCard element it produces (renderItem wraps the card in a
 * spacing <View>). This reads the screen's real per-item config — theme +
 * isSelected — independently of how many items the virtualized list happens to
 * mount under the test renderer.
 */
function previewFor(
  flat: ReactTestInstance,
  item: ProfileTheme,
  index: number,
): { type: unknown; theme: ProfileTheme; isSelected: boolean } {
  const wrapper: any = flat.props.renderItem({ item, index, separators: {} as any });
  const card = wrapper.props.children;
  return {
    type: card.type,
    theme: card.props.theme,
    isSelected: card.props.isSelected,
  };
}

/** The dots-indicator views (height 6, borderRadius 3); selected dot is wider. */
function dotViews(renderer: TestRenderer.ReactTestRenderer): ReactTestInstance[] {
  return renderer.root.findAll((n) => {
    if (typeof n.type !== 'string') return false;
    const s: any = n.props?.style;
    return !!s && !Array.isArray(s) && s.height === 6 && s.borderRadius === 3;
  });
}

/** Index of the single selected (wide) dot, or -1. */
function selectedDotIndex(renderer: TestRenderer.ReactTestRenderer): number {
  return dotViews(renderer).findIndex((d: any) => d.props.style.width === 20);
}

// ─── Tests ─────────────────────────────────────────────────────────────────-

describe('ProfileThemeScreen — deferred-mount + virtualized carousel (Req 9.4, 2.7)', () => {
  it('defers the carousel behind InteractionManager: spinner first, FlatList after interactions settle', () => {
    const renderer = renderScreen();

    // Before interactions settle: the cards are NOT mounted; a spinner stands
    // in (the same `cardsReady` gate appearance.tsx uses).
    expect(renderer.root.findAllByType(FlatList)).toHaveLength(0);
    expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(1);
    expect(runAfterInteractionsSpy).toHaveBeenCalled();

    // After the deferred callback runs: the carousel mounts, spinner gone.
    flushInteractions();
    expect(renderer.root.findAllByType(FlatList)).toHaveLength(1);
    expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(0);

    act(() => renderer.unmount());
  });

  it('configures the FlatList with the tight virtualization props mirroring appearance.tsx', () => {
    mockActiveThemeId = 'winter'; // index 4 → initialScrollIndex should match
    const renderer = renderScreen();
    flushInteractions();

    const flat = getFlatList(renderer);
    expect(flat.props.data).toBe(BUILT_IN_THEME_LIST);
    expect(flat.props.data).toHaveLength(6);
    expect(flat.props.horizontal).toBe(true);
    expect(flat.props.initialNumToRender).toBe(2);
    expect(flat.props.maxToRenderPerBatch).toBe(1);
    expect(flat.props.windowSize).toBe(3);
    expect(flat.props.removeClippedSubviews).toBe(true);
    expect(typeof flat.props.getItemLayout).toBe('function');
    // Opens centred on the persisted theme (winter = index 4), like appearance.tsx.
    expect(flat.props.initialScrollIndex).toBe(4);

    act(() => renderer.unmount());
  });
});

describe('ProfileThemeScreen — one preview per built-in theme (Req 2.1)', () => {
  it('renders a ProfileThemePreviewCard for each of the six BUILT_IN_THEME_LIST entries', () => {
    const renderer = renderScreen();
    flushInteractions();

    const flat = getFlatList(renderer);

    // The data set IS the full Built_In_Theme_Set, in stable order.
    expect(flat.props.data.map((t: ProfileTheme) => t.id)).toEqual(
      BUILT_IN_THEME_LIST.map((t) => t.id),
    );

    // Every entry maps to exactly one preview card for its own theme.
    BUILT_IN_THEME_LIST.forEach((theme, index) => {
      const preview = previewFor(flat, theme, index);
      expect(preview.type).toBe(ProfileThemePreviewCard);
      expect(preview.theme).toBe(theme);
    });

    // And the always-rendered dots indicator has one dot per theme.
    expect(dotViews(renderer)).toHaveLength(6);

    act(() => renderer.unmount());
  });
});

describe('ProfileThemeScreen — selected-preview marking (Req 2.2, 2.3)', () => {
  it('marks the persisted Theme_Id as the single selected preview', () => {
    mockActiveThemeId = 'autumn'; // index 3
    const expectedIndex = BUILT_IN_THEME_LIST.findIndex((t) => t.id === 'autumn');

    const renderer = renderScreen();
    flushInteractions();
    const flat = getFlatList(renderer);

    // Exactly one preview is selected, and it is the persisted theme.
    const selected = BUILT_IN_THEME_LIST.filter(
      (theme, index) => previewFor(flat, theme, index).isSelected,
    );
    expect(selected).toHaveLength(1);
    expect(selected[0].id).toBe('autumn');

    BUILT_IN_THEME_LIST.forEach((theme, index) => {
      expect(previewFor(flat, theme, index).isSelected).toBe(index === expectedIndex);
    });

    // The dots indicator agrees.
    expect(selectedDotIndex(renderer)).toBe(expectedIndex);

    act(() => renderer.unmount());
  });

  it('marks the Default_Theme (default-dark) when no Theme_Id is persisted', () => {
    mockActiveThemeId = undefined;
    mockUserThemeId = undefined;
    const expectedIndex = BUILT_IN_THEME_LIST.findIndex((t) => t.id === DEFAULT_THEME_ID);
    expect(expectedIndex).toBe(0);

    const renderer = renderScreen();
    flushInteractions();
    const flat = getFlatList(renderer);

    const selected = BUILT_IN_THEME_LIST.filter(
      (theme, index) => previewFor(flat, theme, index).isSelected,
    );
    expect(selected).toHaveLength(1);
    expect(selected[0].id).toBe(DEFAULT_THEME_ID);
    expect(selectedDotIndex(renderer)).toBe(expectedIndex);

    act(() => renderer.unmount());
  });

  it('falls back to the auth user row themeId when the per-account mirror is empty', () => {
    mockActiveThemeId = undefined;
    mockUserThemeId = 'spring'; // index 1
    const expectedIndex = BUILT_IN_THEME_LIST.findIndex((t) => t.id === 'spring');

    const renderer = renderScreen();
    flushInteractions();
    const flat = getFlatList(renderer);

    const selected = BUILT_IN_THEME_LIST.filter(
      (theme, index) => previewFor(flat, theme, index).isSelected,
    );
    expect(selected).toHaveLength(1);
    expect(selected[0].id).toBe('spring');
    expect(selectedDotIndex(renderer)).toBe(expectedIndex);

    act(() => renderer.unmount());
  });

  it('collapses an unknown persisted Theme_Id to the Default_Theme preview (Req 2.3)', () => {
    mockActiveThemeId = 'totally-unknown-theme';

    const renderer = renderScreen();
    flushInteractions();
    const flat = getFlatList(renderer);

    const selected = BUILT_IN_THEME_LIST.filter(
      (theme, index) => previewFor(flat, theme, index).isSelected,
    );
    expect(selected).toHaveLength(1);
    expect(selected[0].id).toBe(DEFAULT_THEME_ID);
    expect(selectedDotIndex(renderer)).toBe(0);

    act(() => renderer.unmount());
  });
});
