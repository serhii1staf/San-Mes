// Unit tests for Seasonal Profile Themes theme-aware accent controls + themed
// text (task 6.3): ThemedLikeIcon, ThemedMenuTrigger, ThemedFollowButton,
// ThemedProfileText.
//
// Library: Jest + react-test-renderer (repo convention — there is no
// @testing-library/react-native; see ProfileThemeContext.property.test.tsx).
// These cover the rendering glue over the already-property-tested pure
// selectors (effectiveEmojiAccents / effectiveFont): emoji glyph vs default
// Feather control (Req 4.6, 4.7) and theme-font-vs-app-default (Req 4.8, 4.9,
// 5.4).

// Control the font load-state deterministically.
jest.mock('expo-font', () => ({ isLoaded: jest.fn(() => true) }));

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Feather } from '@expo/vector-icons';
import { isLoaded } from 'expo-font';

import { ThemeProvider } from '../../../theme/ThemeProvider';
import {
  ProfileThemeProvider,
  type ProfileThemeContextValue,
} from '../ProfileThemeContext';
import {
  APP_DEFAULT_FONT,
  BUILT_IN_THEMES,
  DEFAULT_THEME,
  type ProfileTheme,
} from '../../../theme/profileThemes';
import { ThemedLikeIcon } from '../ThemedLikeIcon';
import { ThemedMenuTrigger } from '../ThemedMenuTrigger';
import { ThemedFollowButton } from '../ThemedFollowButton';
import { ThemedProfileText } from '../ThemedProfileText';

const mockIsLoaded = isLoaded as jest.Mock;

const SPRING = BUILT_IN_THEMES.spring; // emoji accents { like:🌷, menu:🌿, follow:🌱 }

function ctxFor(theme: ProfileTheme): ProfileThemeContextValue {
  return {
    theme,
    emojiAccents: theme.emojiAccents,
    font: theme.themeFont ?? APP_DEFAULT_FONT,
  };
}

// Track renderers so we can unmount them after each test — this triggers the
// font hook's effect cleanup, cancelling its poll/timeout timers so nothing
// fires after the Jest environment is torn down.
const renderers: TestRenderer.ReactTestRenderer[] = [];

function render(node: React.ReactElement): TestRenderer.ReactTestRenderer {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<ThemeProvider>{node}</ThemeProvider>);
  });
  renderers.push(renderer);
  return renderer;
}

function withScope(theme: ProfileTheme, node: React.ReactNode): React.ReactElement {
  return <ProfileThemeProvider value={ctxFor(theme)}>{node}</ProfileThemeProvider>;
}

/** True when the rendered tree contains a text node with the given glyph. */
function hasGlyph(renderer: TestRenderer.ReactTestRenderer, glyph: string): boolean {
  return JSON.stringify(renderer.toJSON()).includes(glyph);
}

beforeEach(() => {
  jest.useFakeTimers();
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

describe('ThemedLikeIcon (Req 4.6, 4.7)', () => {
  it('renders the theme like emoji glyph when accents are defined', () => {
    const r = render(withScope(SPRING, <ThemedLikeIcon size={14} color="#fff" />));
    expect(hasGlyph(r, '🌷')).toBe(true);
    expect(r.root.findAllByType(Feather)).toHaveLength(0);
  });

  it('renders the default Feather heart when no accents are defined', () => {
    const r = render(withScope(DEFAULT_THEME, <ThemedLikeIcon size={14} color="#fff" />));
    const icons = r.root.findAllByType(Feather);
    expect(icons).toHaveLength(1);
    expect(icons[0].props.name).toBe('heart');
  });

  it('renders the default Feather control outside any scope', () => {
    const r = render(<ThemedLikeIcon size={14} color="#fff" />);
    expect(r.root.findAllByType(Feather)).toHaveLength(1);
  });
});

describe('ThemedMenuTrigger (Req 4.6, 4.7)', () => {
  it('renders the theme menu emoji glyph when accents are defined', () => {
    const r = render(withScope(SPRING, <ThemedMenuTrigger size={18} color="#fff" />));
    expect(hasGlyph(r, '🌿')).toBe(true);
    expect(r.root.findAllByType(Feather)).toHaveLength(0);
  });

  it('renders the default Feather overflow icon when no accents are defined', () => {
    const r = render(withScope(DEFAULT_THEME, <ThemedMenuTrigger size={18} color="#fff" />));
    const icons = r.root.findAllByType(Feather);
    expect(icons).toHaveLength(1);
    expect(icons[0].props.name).toBe('more-horizontal');
  });
});

describe('ThemedFollowButton (Req 4.6, 4.7)', () => {
  const onPress = () => {};

  it('shows the follow emoji glyph alongside the label when accents are defined', () => {
    const r = render(
      withScope(SPRING, <ThemedFollowButton following={false} onPress={onPress} label="Подписаться" />),
    );
    expect(hasGlyph(r, '🌱')).toBe(true);
    expect(hasGlyph(r, 'Подписаться')).toBe(true);
  });

  it('renders only the label when no accents are defined', () => {
    const r = render(
      withScope(DEFAULT_THEME, <ThemedFollowButton following onPress={onPress} label="Вы подписаны" />),
    );
    expect(hasGlyph(r, 'Вы подписаны')).toBe(true);
    // No spring follow glyph leaks in.
    expect(hasGlyph(r, '🌱')).toBe(false);
  });
});

describe('ThemedProfileText (Req 4.8, 4.9, 5.4)', () => {
  // A theme font with a (mock) bundled asset, so it can "load".
  const pixelTheme: ProfileTheme = {
    ...DEFAULT_THEME,
    id: 'purple-pixel',
    themeFont: { key: 'pixel', family: 'PixelFamily', asset: 1 },
  };

  it('applies the theme font family when the theme font is defined and loaded', () => {
    mockIsLoaded.mockReturnValue(true);
    const r = render(withScope(pixelTheme, <ThemedProfileText>hello</ThemedProfileText>));
    expect(JSON.stringify(r.toJSON())).toContain('PixelFamily');
  });

  it('falls back to the app default font when the theme font has not loaded', () => {
    mockIsLoaded.mockReturnValue(false);
    const r = render(withScope(pixelTheme, <ThemedProfileText>hello</ThemedProfileText>));
    expect(JSON.stringify(r.toJSON())).not.toContain('PixelFamily');
  });

  it('uses the app default font for a theme that defines no font', () => {
    const r = render(withScope(DEFAULT_THEME, <ThemedProfileText>hello</ThemedProfileText>));
    expect(JSON.stringify(r.toJSON())).not.toContain('PixelFamily');
  });
});
