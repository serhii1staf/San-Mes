import React, { useEffect, useRef, useState } from 'react';
import { View, Pressable, Modal, Animated, Dimensions, KeyboardAvoidingView, Platform } from 'react-native';
import { ModalStatusBar } from './ModalStatusBar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

interface SlideUpSheetProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /**
   * Exit UPWARD instead of downward, for a handoff rather than a dismissal.
   *
   * Asked for by description: tapping the three-dots should send the sheet up and open a full screen
   * from above. The direction is the whole message — down means "I am finished with this", up means
   * "this is becoming something else". A sheet that slides down and is immediately followed by a screen
   * pushing in reads as two unrelated events.
   *
   * A ref rather than a prop on purpose: the direction is decided by WHICH control was pressed, at the
   * moment it is pressed, and a prop would have to be set in a prior render and would still be set on
   * the next ordinary close. The parent points this at `true` just before triggering the handoff.
   */
  exitUpRef?: React.MutableRefObject<boolean>;
}

// Bottom sheet with the EXACT same open/close/dim animation as the feed's
// three-dots menu (PostMenuModal): spring slide-up from the bottom, a 0.4 black
// backdrop fading in over 200ms, and a 250ms slide-down + fade-out on close.
export function SlideUpSheet({ visible, onClose, children, exitUpRef }: SlideUpSheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;
  const isClosing = useRef(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      isClosing.current = false;
      slideAnim.setValue(SCREEN_HEIGHT);
      backdropAnim.setValue(0);
      Animated.parallel([
        Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 50, friction: 9 }),
        Animated.timing(backdropAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    } else if (mounted && !isClosing.current) {
      // External close (parent set visible=false without going through the
      // backdrop press / onRequestClose): run the same dismiss animation
      // so the sheet doesn't get stuck visible while React thinks it's
      // closed. This was the "category tap plays haptic but the sheet
      // doesn't dismiss" bug in the mini-app report flow.
      dismiss();
    }
    // We deliberately depend only on `visible`; `mounted` and `isClosing`
    // are refs / state that don't need to retrigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const dismiss = () => {
    if (isClosing.current) return;
    isClosing.current = true;
    // Up for a handoff, down for a dismissal — see `exitUpRef`. The ref is consumed here so it cannot
    // leak into the next close: whoever set it gets exactly one upward exit out of it.
    const up = !!exitUpRef?.current;
    if (exitUpRef) exitUpRef.current = false;
    Animated.parallel([
      // Off the top edge needs the card's own height as well as the screen, since it starts at the
      // bottom — `-SCREEN_HEIGHT` alone would leave a tall sheet's lower half still visible.
      Animated.timing(slideAnim, { toValue: up ? -SCREEN_HEIGHT : SCREEN_HEIGHT, duration: 250, useNativeDriver: true }),
      Animated.timing(backdropAnim, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start(() => {
      setTimeout(() => { setMounted(false); onClose(); }, 30);
    });
  };

  if (!visible && !mounted) return null;

  return (
    <Modal visible={visible || mounted} transparent animationType="none" onRequestClose={dismiss} statusBarTranslucent>
      <ModalStatusBar />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Backdrop sits BELOW the content. Without an explicit zIndex on
            the content wrapper React Native's tap routing can let the
            backdrop's full-screen Pressable swallow taps on the card itself
            on some configurations (Modal + absolute backdrop + Animated
            child), which is exactly the "buttons don't react" symptom
            users reported on the mini-app report sheet. */}
        <Animated.View
          pointerEvents={visible ? 'auto' : 'none'}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', opacity: backdropAnim, zIndex: 1 }}
        >
          <Pressable style={{ flex: 1 }} onPress={dismiss} />
        </Animated.View>

        <View style={{ flex: 1, justifyContent: 'flex-end', zIndex: 2 }} pointerEvents="box-none">
          <Animated.View style={{ transform: [{ translateY: slideAnim }] }}>
            {/* Match PostMenuModal exactly: 8 px horizontal margin, 16 px
                bottom margin (NOT safe-area-aware — the sheet visually
                hangs above the home indicator the same way the post menu
                does), 28-px corners. Earlier 40-px corners + safe-area
                bottom made the same component look like a different sheet
                family (which is what users were comparing to). */}
            <View style={{ marginHorizontal: 8, marginBottom: 16, backgroundColor: theme.isDark ? theme.colors.background.elevated : '#FFFFFF', borderRadius: 28, shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.12, shadowRadius: 16, elevation: 10 }}>
              <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 4 }}>
                <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)' }} />
              </View>
              {children}
              <View style={{ height: 10 + insets.bottom }} />
            </View>
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
