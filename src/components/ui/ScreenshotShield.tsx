import React, { useEffect } from 'react';
import { View, Text as RNText, StyleSheet, Modal } from 'react-native';
import { useT } from '../../i18n/store';

// Full-screen cover shown (iOS only) the moment a screenshot is detected on an
// account that disabled screenshots. iOS can't block the still image itself, so
// this is the after-the-fact deterrent: a black screen with a 🙈, auto-hiding.
// On Android the OS already blanks the capture (FLAG_SECURE), so this never
// needs to fire there.
export function ScreenshotShield({ visible, onHide }: { visible: boolean; onHide?: () => void }) {
  const t = useT();
  useEffect(() => {
    if (!visible || !onHide) return;
    const timer = setTimeout(onHide, 2500);
    return () => clearTimeout(timer);
  }, [visible, onHide]);

  if (!visible) return null;
  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent>
      <View style={styles.fill}>
        <RNText style={styles.emoji} allowFontScaling={false}>🙈</RNText>
        <RNText style={styles.txt}>{t('screenshot.blocked', 'This account has screenshots turned off')}</RNText>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', gap: 18 },
  emoji: { fontSize: 76 },
  txt: { color: 'rgba(255,255,255,0.72)', fontSize: 14, paddingHorizontal: 48, textAlign: 'center', lineHeight: 20 },
});
