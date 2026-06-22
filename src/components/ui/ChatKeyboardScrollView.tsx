import React, { forwardRef } from 'react';
import type { ScrollViewProps } from 'react-native';
import { KeyboardChatScrollView, type KeyboardChatScrollViewProps } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Shared wrapper around the official react-native-keyboard-controller chat
// scroll view. Used as a FlatList `renderScrollComponent` so the library can
// reposition chat content on keyboard open/close natively (Telegram/WhatsApp
// "always" lift) — replacing the old per-frame translateY list-lift that read
// as a content "jump" on the first focus / on dismiss.
//
// The bottom `offset` tells KeyboardChatScrollView how far the scroll view's
// bottom sits from the screen bottom so it lifts content by the *effective*
// keyboard height. Our composers float just above the safe-area, so the offset
// is the bottom safe-area minus a small margin.
type Ref = React.ElementRef<typeof KeyboardChatScrollView>;

const BOTTOM_OFFSET = 8;

export const ChatKeyboardScrollView = forwardRef<Ref, ScrollViewProps & KeyboardChatScrollViewProps>(
  ({ inverted, ...props }, ref) => {
    const { bottom } = useSafeAreaInsets();
    return (
      <KeyboardChatScrollView
        ref={ref}
        inverted={inverted}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        keyboardDismissMode="interactive"
        offset={Math.max(bottom - BOTTOM_OFFSET, 0)}
        {...props}
      />
    );
  },
);

ChatKeyboardScrollView.displayName = 'ChatKeyboardScrollView';
