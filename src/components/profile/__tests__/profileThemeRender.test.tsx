// Render integration tests for Seasonal Profile Themes (task 6.4).
//
// These exercise the COMPOSED rendering path that both profile screens wire up
// — `app/(tabs)/profile.tsx` (own profile) and `app/profile/[id].tsx` (visitor)
// — without mounting those heavy screens (which pull in routing, stores, the
// real liquid-glass native module, FlatLists, etc.). Instead we reproduce the
// exact composition the screens use:
//
//     <ProfileThemeScope themeId={...}>            // Layer 0 palette gradient
//       <ProfileThemeBackground illustration={} /> // Layer 1 absoluteFill sibling
//       <GlassCard>                                // Layer 3 content (glass / fallback)
//         <ThemedLikeIcon /> <ThemedMenuTrigger />
//         <ThemedFollowButton /> <ThemedProfileText />
//       </GlassCard>
//     </ProfileThemeScope>
//
// What is covered:
//   * Own + visitor profiles apply the RESOLVED theme palette for a known
//     theme_id, and fall back to the default theme for unknown / missing ids
//     (Req 4.1, 4.2, 4.3).
//   * The themed Background_Illustration is an `absoluteFill` SIBLING rendered
//     beneath the content, above which the glass card sits; it is never an
//     ancestor of the glass card (Req 4.4, 9.2).
//   * `useLiquidGlassActive()` toggles glass vs. the non-glass fallback for the
//     content card (Req 7.4, 9.3).
//   * Emoji accents and the themed font appear ONLY inside a ProfileThemeScope
//     and never leak to elements outside it (Req 4.6, 4.7, 4.10).
//
// Library: Jest + react-test-renderer — the repo convention (there is no
// @testing-library/react-native dependency; see ambientWiring.test.tsx and
// ThemedControls.test.tsx).
//
//   _Requirements: 4.1, 4.2, 4.3, 4.4, 4.6, 4.7, 4.10, 7.4, 9.2, 9.3_

import React from 'react';
import { View, StyleSheet } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { Feather } from '@expo/vector-icons';

// ─── Mocks ────────────────────────────────────────────────────────────────

// Liquid glass: a controllable mock so we can flip glass on/off deterministically
// (the real `useLiquidGlassActive` depends on the native expo-glass-effect
// capability, which is always false in the test env). `NativeGlassView` becomes
// a plain host View that forwards props (incl. testID) so we can observe which
// branch the content card rendered.
let mockGlassActive = false;
jest.mock('../../ui/LiquidGlass', () => {
  const React_ = require('react');
  const { View: RNView } = require('react-native');
  return {
    __esModule: true,
    useLiquidGlassActive: () => mockGlassActive,
    NativeGlassView: ({ children, ...rest }: any) =>
      React_.createElement(RNView, rest, children),
  };
});

// expo-linear-gradient → a host View that carries the `colors` prop so the
// resolved palette is observable in the tree (Layer 0).
jest.mock('expo-linear-gradient', () => {
  const React_ = require('react');
  const { View: RNView } = require('react-native');
  return {
    __esModule: true,
    LinearGradient: ({ children, ...rest }: any) =>
      React_.createElement(RNView, rest, children),
  };
});

// expo-image → a host View that carries the `source` + `style` props so the
// Background_Illustration layer is observable (Layer 1).
jest.mock('expo-image', () => {
  const React_ = require('react');
  const { View: RNView } = require('react-native');
  return {
    __esModule: true,
    Image: ({ children, ...rest }: any) =>
      React_.createElement(RNView, rest, children),
  };
});

// The background is now a react-native-svg vector scene. Mock it to a host View
// that exposes the resolved theme id so the layering + palette assertions below
// can read which theme the scene is drawing (the live scene's sky gradient uses
// the same palette, so resolving id→palette keeps the existing expectations).
jest.mock('../ProfileThemeScene', () => {
  const React_ = require('react');
  const { View: RNView } = require('react-native');
  return {
    __esModule: true,
    ProfileThemeScene: ({ theme }: any) =>
      React_.createElement(RNView, { testID: 'scene', sceneThemeId: theme.id }),
  };
});

// Control themed-font load state deterministically (mirrors ThemedControls.test).
jest.mock('expo-font', () => ({ isLoaded: jest.fn(() => true) }));

import { isLoaded } from 'expo-font';
import { useLiquidGlassActive, NativeGlassView } from '../../ui/LiquidGlass';
import { ThemeProvider } from '../../../theme/ThemeProvider';
import { ProfileThemeScope } from '../ProfileThemeScope';
import { ProfileThemeBackground } from '../ProfileThemeBackground';
import {
  ProfileThemeProvider,
  type ProfileThemeContextValue,
} from '../ProfileThemeContext';
import { ThemedLikeIcon } from '../ThemedLikeIcon';
import { ThemedMenuTrigger } from '../ThemedMenuTrigger';
import { ThemedFollowButton } from '../ThemedFollowButton';
import { ThemedProfileText } from '../ThemedProfileText';
import {
  APP_DEFAULT_FONT,
  BUILT_IN_THEMES,
  DEFAULT_THEME,
  resolveProfileTheme,
  type ProfileTheme,
} from '../../../theme/profileThemes';

const mockIsLoaded = isLoaded as jest.Mock;

// A real numeric module id stands in for a bundled illustration `require()`.
const FAKE_ILLUSTRATION = 4242;

// ─── Test harness — mirrors the real profile-screen composition ─────────────

/**
 * The content card the profile screens render: a glass surface when liquid
 * glass is active, otherwise the existing non-glass fallback (Req 7.4, 9.3).
 */
function GlassCard({ children }: { children: React.ReactNode }) {
  const active = useLiquidGlassActive();
  return active ? (
    <NativeGlassView testID="glass-surface">{children}</NativeGlassView>
  ) : (
    <View testID="fallback-surface">{children}</View>
  );
}

/**
 * Reproduces the profile-screen theme composition. `themeId` is the only input
 * that differs between the own profile (sourced from the active account's
 * stored id) and a visitor profile (sourced from `profile.theme_id`) — both
 * flow through the identical ProfileThemeScope path.
 */
function ProfileHarness({
  themeId,
  illustration = null,
}: {
  themeId: string | null | undefined;
  illustration?: number | null;
}) {
  return (
    <ProfileThemeScope themeId={themeId} scrollActive={false} screenFocused>
      <ProfileThemeBackground illustration={illustration} />
      <GlassCard>
        <ThemedLikeIcon size={14} color="#fff" />
        <ThemedMenuTrigger size={18} color="#fff" />
        <ThemedFollowButton following={false} onPress={() => {}} label="Подписаться" />
        <ThemedProfileText>Profile content</ThemedProfileText>
      </GlassCard>
    </ProfileThemeScope>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const renderers: TestRenderer.ReactTestRenderer[] = [];

function render(node: React.ReactElement): TestRenderer.ReactTestRenderer {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<ThemeProvider>{node}</ThemeProvider>);
  });
  renderers.push(renderer);
  return renderer;
}

/** Flat list of the top-level host nodes (context providers are transparent). */
function topLevelHostNodes(renderer: TestRenderer.ReactTestRenderer): any[] {
  const json = renderer.toJSON();
  if (json == null) return [];
  return Array.isArray(json) ? json : [json];
}

/** The resolved palette of the theme the background SCENE is drawing — read via
 *  the mocked scene's `sceneThemeId` and mapped back to the palette (the live
 *  scene's sky gradient uses this same palette). */
function gradientColors(renderer: TestRenderer.ReactTestRenderer): string[] | undefined {
  const node = renderer.root.findAll(
    (n) => typeof n.type === 'string' && n.props?.testID === 'scene',
  )[0];
  const id = node?.props?.sceneThemeId as string | undefined;
  return id ? resolveProfileTheme(id).palette.gradient : undefined;
}

/** True when a text node containing `glyph` is present anywhere in the tree. */
function hasGlyph(renderer: TestRenderer.ReactTestRenderer, glyph: string): boolean {
  return JSON.stringify(renderer.toJSON()).includes(glyph);
}

function findByTestId(renderer: TestRenderer.ReactTestRenderer, id: string) {
  // Restrict to host nodes (string type) — a composite component and its
  // rendered host node both carry the forwarded testID, which would double-count.
  return renderer.root.findAll(
    (n) => typeof n.type === 'string' && n.props?.testID === id,
  );
}

beforeEach(() => {
  jest.useFakeTimers();
  mockGlassActive = false;
  mockIsLoaded.mockReset();
  mockIsLoaded.mockReturnValue(true);
});

afterEach(() => {
  act(() => {
    renderers.forEach((r) => r.unmount());
  });
  renderers.length = 0;
  jest.clearAllTimers();
  jest.useRealTimers();
});

// ─── 1. Resolved theme applied for own + visitor; fallback for unknown/missing
//     (Req 4.1, 4.2, 4.3) ───────────────────────────────────────────────────

describe('resolved theme palette + accents (Req 4.1, 4.2, 4.3)', () => {
  it('own profile applies the resolved palette + emoji accents for a known theme_id', () => {
    // Own profile: theme id is the active account's stored id (e.g. "spring").
    const r = render(<ProfileHarness themeId="spring" />);

    expect(gradientColors(r)).toEqual(BUILT_IN_THEMES.spring.palette.gradient);
    // Spring emoji accents render on the like / menu / follow controls.
    expect(hasGlyph(r, '🌷')).toBe(true); // like
    expect(hasGlyph(r, '🌿')).toBe(true); // menu
    expect(hasGlyph(r, '🌱')).toBe(true); // follow
    // No default Feather controls when emoji accents are active.
    expect(r.root.findAllByType(Feather)).toHaveLength(0);
  });

  it('visitor profile applies the same resolved palette for the same known theme_id', () => {
    // Visitor: theme id comes from the fetched `profile.theme_id` — same path.
    const r = render(<ProfileHarness themeId="winter" />);

    expect(gradientColors(r)).toEqual(BUILT_IN_THEMES.winter.palette.gradient);
    expect(hasGlyph(r, '❄️')).toBe(true); // winter like accent
  });

  it.each([
    ['an unknown theme_id', 'totally-not-a-real-theme'],
    ['a null theme_id', null],
    ['an undefined theme_id', undefined],
    ['an empty theme_id', ''],
  ])('falls back to the Default_Theme for %s', (_label, themeId) => {
    const r = render(<ProfileHarness themeId={themeId as any} />);

    // Default palette is applied (Req 4.3 / 5.1 / 5.2).
    expect(gradientColors(r)).toEqual(DEFAULT_THEME.palette.gradient);
    // Default theme defines NO emoji accents → default Feather controls render.
    const icons = r.root.findAllByType(Feather);
    const iconNames = icons.map((i) => i.props.name);
    expect(iconNames).toContain('heart'); // ThemedLikeIcon default
    expect(iconNames).toContain('more-horizontal'); // ThemedMenuTrigger default
    expect(hasGlyph(r, '🌷')).toBe(false);
  });
});

// ─── 2. Background is an absoluteFill sibling beneath the content (Req 4.4, 9.2)

describe('themed background layering (Req 4.4, 9.2)', () => {
  it('renders the Background_Illustration as an absoluteFill sibling, beneath the content card', () => {
    const r = render(<ProfileHarness themeId="winter" illustration={FAKE_ILLUSTRATION} />);

    // The illustration layer is present and covers the screen.
    const imageNode = r.root.findAll(
      (n) => typeof n.type === 'string' && n.props?.source === FAKE_ILLUSTRATION,
    )[0];
    expect(imageNode).toBeTruthy();
    const flat = StyleSheet.flatten(imageNode.props.style);
    expect(flat.position).toBe('absolute');
    expect(flat.top).toBe(0);
    expect(flat.left).toBe(0);
    expect(flat.right).toBe(0);
    expect(flat.bottom).toBe(0);

    // It is a SIBLING, not an ancestor, of the content card (the glass-safety
    // rule: the background never wraps the glass content). With glass off the
    // content is the fallback surface.
    const surface = findByTestId(r, 'fallback-surface')[0];
    expect(surface).toBeTruthy();
    const imageContainsSurface = imageNode.findAll((n: any) => n === surface).length > 0;
    expect(imageContainsSurface).toBe(false);

    // Ordering: scene (Layer 0/1) → illustration → content (Layer 3),
    // i.e. the background sits BENEATH the content in paint order.
    const top = topLevelHostNodes(r);
    const sceneIdx = top.findIndex((n) => n.props?.testID === 'scene');
    const imageIdx = top.findIndex((n) => n.props?.source === FAKE_ILLUSTRATION);
    const surfaceIdx = top.findIndex((n) => n.props?.testID === 'fallback-surface');
    expect(sceneIdx).toBeGreaterThanOrEqual(0);
    expect(imageIdx).toBeGreaterThan(sceneIdx);
    expect(surfaceIdx).toBeGreaterThan(imageIdx);
  });

  it('renders no illustration layer when the theme has no Background_Illustration (palette-only)', () => {
    // Placeholder-phase themes ship illustration=null → palette shows through.
    const r = render(<ProfileHarness themeId="winter" illustration={null} />);
    const images = r.root.findAll(
      (n) => typeof n.type === 'string' && n.props?.source === FAKE_ILLUSTRATION,
    );
    expect(images).toHaveLength(0);
    // Palette gradient is still applied.
    expect(gradientColors(r)).toEqual(BUILT_IN_THEMES.winter.palette.gradient);
  });
});

// ─── 3. useLiquidGlassActive() toggles glass vs non-glass fallback (Req 7.4, 9.3)

describe('glass vs non-glass content card (Req 7.4, 9.3)', () => {
  it('renders the non-glass fallback surface when liquid glass is inactive', () => {
    mockGlassActive = false;
    const r = render(<ProfileHarness themeId="spring" />);

    expect(findByTestId(r, 'fallback-surface')).toHaveLength(1);
    expect(findByTestId(r, 'glass-surface')).toHaveLength(0);
  });

  it('renders the glass surface when liquid glass is active', () => {
    mockGlassActive = true;
    const r = render(<ProfileHarness themeId="spring" />);

    expect(findByTestId(r, 'glass-surface')).toHaveLength(1);
    expect(findByTestId(r, 'fallback-surface')).toHaveLength(0);
    // Emoji accents still render inside the glass content.
    expect(hasGlyph(r, '🌷')).toBe(true);
  });
});

// ─── 4. Emoji accents + themed font are confined to the scope (Req 4.6, 4.7, 4.10)

describe('scope containment of accents + font (Req 4.6, 4.7, 4.10)', () => {
  it('renders emoji accents inside the scope and default Feather controls outside it', () => {
    // Inside the scope (spring active): emoji accents render.
    const inside = render(<ProfileHarness themeId="spring" />);
    expect(inside.root.findAllByType(Feather)).toHaveLength(0);
    expect(hasGlyph(inside, '🌷')).toBe(true);

    // OUTSIDE any ProfileThemeScope, even though a theme is "active" elsewhere,
    // the same controls render the neutral default (Feather), no emoji leak.
    const outside = render(
      <>
        <ThemedLikeIcon size={14} color="#fff" />
        <ThemedMenuTrigger size={18} color="#fff" />
      </>,
    );
    const names = outside.root.findAllByType(Feather).map((i) => i.props.name);
    expect(names).toEqual(expect.arrayContaining(['heart', 'more-horizontal']));
    expect(hasGlyph(outside, '🌷')).toBe(false);
  });

  it('applies the themed font only to text inside the scope, not to text outside it', () => {
    mockIsLoaded.mockReturnValue(true);
    // A theme whose font has a (mock) bundled asset, so it can "load".
    const pixelTheme: ProfileTheme = {
      ...DEFAULT_THEME,
      id: 'purple-pixel',
      themeFont: { key: 'pixel', family: 'PixelFamily', asset: 1 },
    };
    const ctx: ProfileThemeContextValue = {
      theme: pixelTheme,
      emojiAccents: pixelTheme.emojiAccents,
      font: pixelTheme.themeFont ?? APP_DEFAULT_FONT,
    };

    const r = render(
      <>
        <ProfileThemeProvider value={ctx}>
          <ThemedProfileText>inside</ThemedProfileText>
        </ProfileThemeProvider>
        {/* Sibling OUTSIDE the provider → must use the app default font. */}
        <ThemedProfileText>outside</ThemedProfileText>
      </>,
    );

    // The themed font family is applied to the inside text only. Locate each
    // text node by its content and inspect the flattened style.
    const textNodes = r.root.findAll(
      (n) => typeof n.type === 'string' && (n.props?.children === 'inside' || n.props?.children === 'outside'),
    );
    const inside = textNodes.find((n) => n.props.children === 'inside');
    const outside = textNodes.find((n) => n.props.children === 'outside');
    expect(StyleSheet.flatten(inside!.props.style).fontFamily).toBe('PixelFamily');
    expect(StyleSheet.flatten(outside!.props.style).fontFamily).not.toBe('PixelFamily');
  });
});
