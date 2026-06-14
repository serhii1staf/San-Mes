// Unit test for MusicMiniBar (a.k.a. MusicBottomIndicator) — Task 8.1.
//
// Property 3 — closeButtonVisible'(X) = false when queue.length > 0. The
// production widget does NOT render a Feather "x" close-cross at all (the
// design landed on swipe-to-dismiss, see MusicBottomIndicator.tsx), so the
// invariant holds for every queue/recent state. This test pins that down by
// rendering the component twice — non-empty queue and empty queue — and
// asserting no Feather "x" icon appears in the rendered tree in either case.
//
// Library: react-test-renderer (already pulled in by react), matching the
// existing useContextMenuGuard.property.test.tsx pattern. No new test-library
// dependency is added.

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

// ─── Module mocks (kept minimal — only what the component actually touches) ──
jest.mock('expo-router', () => ({
  usePathname: () => '/',
}));

jest.mock('../../../theme', () => ({
  useTheme: () => ({
    isDark: false,
    colors: {
      accent: { primary: '#3478F6' },
      background: { elevated: '#F5F5F5' },
      text: { primary: '#000', tertiary: '#888' },
    },
  }),
}));

jest.mock('../../../utils/haptics', () => ({
  triggerHaptic: jest.fn(),
}));

jest.mock('../CachedImage', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    CachedImage: (props: any) => React.createElement(View, { ...props, testID: 'cached-image' }),
  };
});

// Mock Text to avoid pulling the full theme tokens (typography sizes / fontFamily)
// just to render two title strings.
jest.mock('../Text', () => {
  const React = require('react');
  const { Text: RNText } = require('react-native');
  return {
    Text: (props: any) => React.createElement(RNText, props, props.children),
  };
});

// Lightweight Feather icon mock — exposes the `name` prop in the rendered tree
// so the JSON walk below can assert no element with name="x" was emitted.
jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    Feather: ({ name, ...rest }: any) =>
      React.createElement(View, { ...rest, 'data-icon-name': name, testID: `icon-${name}` }),
  };
});

// expo-av is mocked because importing the music store transitively pulls it in.
jest.mock('expo-av', () => ({
  Audio: {
    setAudioModeAsync: jest.fn(async () => {}),
    Sound: {
      createAsync: jest.fn(async () => ({
        sound: {
          unloadAsync: jest.fn(async () => {}),
          getStatusAsync: jest.fn(async () => ({ isLoaded: true, isPlaying: true, positionMillis: 0, durationMillis: 1000 })),
          playAsync: jest.fn(async () => {}),
          pauseAsync: jest.fn(async () => {}),
          setPositionAsync: jest.fn(async () => {}),
          setStatusAsync: jest.fn(async () => {}),
          stopAsync: jest.fn(async () => {}),
        },
        status: { isLoaded: true },
      })),
    },
  },
}));

import { MusicBottomIndicator } from '../MusicBottomIndicator';
import { useMusicStore } from '../../../store/musicStore';
import type { Track } from '../../../services/musicService';

const track = (id: string): Track =>
  ({
    id,
    title: `Track ${id}`,
    artist: 'Artist',
    artwork: '',
    streamUrl: `https://api.audius.co/v1/tracks/${id}/stream`,
    durationMs: 200000,
    sourceHost: 'https://api.audius.co',
    isPreview: false,
  }) as Track;

/** Recursively collect every Feather-icon element's `name` prop from a JSON tree. */
function collectIconNames(node: any, into: string[] = []): string[] {
  if (!node) return into;
  if (Array.isArray(node)) {
    for (const c of node) collectIconNames(c, into);
    return into;
  }
  if (typeof node !== 'object') return into;
  const iconName = node?.props?.['data-icon-name'];
  if (typeof iconName === 'string') into.push(iconName);
  if (node.children) collectIconNames(node.children, into);
  return into;
}

function reset() {
  useMusicStore.setState({
    current: null,
    recent: [],
    isPlaying: false,
    positionMs: 0,
    durationMs: 0,
    isLoading: false,
    playerOpen: false,
    inMusicChat: false,
  });
}

describe('MusicMiniBar (MusicBottomIndicator) — close-cross conditional render (Property 3)', () => {
  beforeEach(reset);

  it('with a non-empty queue (recent has 3 tracks) — no close-cross "x" icon is rendered', async () => {
    const A = track('A');
    const B = track('B');
    const C = track('C');
    useMusicStore.setState({ current: A, recent: [A, B, C], isPlaying: true });

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<MusicBottomIndicator />);
    });

    const tree = renderer.toJSON();
    const icons = collectIconNames(tree);
    // The play/pause icon must be present (the widget renders it for the current track).
    expect(icons).toEqual(expect.arrayContaining([expect.stringMatching(/^(play|pause)$/)]));
    // A close-cross would be Feather name="x" — must NOT be in the tree (Property 3).
    expect(icons).not.toContain('x');

    await act(async () => renderer.unmount());
  });

  it('with an empty queue (recent contains only current) — also no Feather "x" icon (swipe-to-dismiss design)', async () => {
    const only = track('only');
    useMusicStore.setState({ current: only, recent: [only], isPlaying: false });

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<MusicBottomIndicator />);
    });

    const tree = renderer.toJSON();
    const icons = collectIconNames(tree);
    // The widget chose swipe-to-dismiss over a close-cross, so neither the
    // empty-queue nor the non-empty-queue branch ever surfaces a Feather "x".
    expect(icons).not.toContain('x');

    await act(async () => renderer.unmount());
  });

  it('with current=null the widget unmounts to nothing (no icons at all)', async () => {
    useMusicStore.setState({ current: null });

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<MusicBottomIndicator />);
    });

    expect(renderer.toJSON()).toBeNull();

    await act(async () => renderer.unmount());
  });
});
