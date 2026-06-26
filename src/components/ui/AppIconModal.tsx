import React, { useState, useRef, useEffect, useMemo } from 'react';
import { View, Pressable, Modal, Image, ActivityIndicator, Alert, Animated, Dimensions, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { Text } from './Text';
import {
  setAlternateAppIcon,
  getAppIconName,
  supportsAlternateIcons,
} from 'expo-alternate-app-icons';
import { useT } from '../../i18n/store';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

// iOS (18/26) intermittently rejects `setAlternateIconName` with
// NSPOSIXErrorDomain code 35 ("Resource temporarily unavailable" / EAGAIN)
// coming from LSIconAlertManager — it couldn't acquire the icon-change system
// alert token in time. It's transient: a short delay + retry almost always
// succeeds on the next attempt. We retry a few times before surfacing an error.
const ICON_SET_RETRIES = 4;
const ICON_SET_RETRY_DELAY_MS = 350;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function setAppIconWithRetry(name: string | null): Promise<void> {
  let lastError: any;
  for (let attempt = 0; attempt < ICON_SET_RETRIES; attempt++) {
    try {
      await setAlternateAppIcon(name);
      return;
    } catch (e) {
      lastError = e;
      if (attempt < ICON_SET_RETRIES - 1) await sleep(ICON_SET_RETRY_DELAY_MS);
    }
  }
  throw lastError;
}

interface IconOption {
  name: string | null; // null = default app icon
  label: string;
  source: any;
}

interface AppIconModalProps {
  visible: boolean;
  onClose: () => void;
}

export function AppIconModal({ visible, onClose }: AppIconModalProps) {
  const theme = useTheme();
  const t = useT();
  // Build the icon list inside the component so labels follow the active locale.
  const ICONS: IconOption[] = useMemo(() => [
    { name: null, label: t('app_icon.default'), source: require('../../../assets/icon.png') },
    { name: 'Style1', label: t('app_icon.style1'), source: require('../../../assets/app-icons/style1.png') },
    { name: 'Style2', label: t('app_icon.style2'), source: require('../../../assets/app-icons/style2.png') },
    { name: 'Style3', label: t('app_icon.style3'), source: require('../../../assets/app-icons/style3.png') },
    { name: 'Style4', label: t('app_icon.style4'), source: require('../../../assets/app-icons/style4.png') },
  ], [t]);
  const [current, setCurrent] = useState<string | null>(null);
  const [applying, setApplying] = useState<string | null>(null);
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      try { setCurrent(getAppIconName()); } catch { setCurrent(null); }
      slideAnim.setValue(SCREEN_HEIGHT);
      backdropAnim.setValue(0);
      Animated.parallel([
        Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 50, friction: 9 }),
        Animated.timing(backdropAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  const dismiss = () => {
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: SCREEN_HEIGHT, duration: 220, useNativeDriver: true }),
      Animated.timing(backdropAnim, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start(({ finished }) => { if (finished) onClose(); });
  };

  const handleSelect = async (icon: IconOption) => {
    if (Platform.OS !== 'ios') { Alert.alert(t('app_icon.unavailable_title'), t('app_icon.unavailable_ios_only')); return; }
    if (!supportsAlternateIcons) { Alert.alert(t('app_icon.unavailable_title'), t('app_icon.unavailable_device')); return; }
    const isSame = (icon.name ?? null) === (current ?? null);
    if (isSame || applying) return;
    const target = icon.name;
    setApplying(icon.name ?? 'default');
    // Close our React Native <Modal> BEFORE switching the icon. iOS shows a
    // mandatory "You have changed the icon…" system alert, and it fails to
    // acquire the alert token (NSPOSIXErrorDomain 35, "Resource temporarily
    // unavailable") when another modal/window is on screen at call time. By
    // dismissing first and switching after the close animation settles, iOS has
    // a clean key window to present that alert on.
    dismiss();
    setTimeout(async () => {
      try {
        await setAppIconWithRetry(target);
      } catch (e: any) {
        const detail = e?.message ? `\n\n${String(e.message)}` : '';
        Alert.alert(t('app_icon.error_title'), `${t('app_icon.error_change')}${detail}`);
      }
    }, 450);
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={dismiss} statusBarTranslucent>
      <View style={{ flex: 1 }}>
        <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', opacity: backdropAnim }}>
          <Pressable style={{ flex: 1 }} onPress={dismiss} />
        </Animated.View>
        <View style={{ flex: 1, justifyContent: 'flex-end' }} pointerEvents="box-none">
          <Animated.View style={{ transform: [{ translateY: slideAnim }] }}>
            <View style={{ marginHorizontal: 8, marginBottom: 16, backgroundColor: theme.isDark ? theme.colors.background.elevated : '#FFFFFF', borderRadius: 28, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.12, shadowRadius: 16, elevation: 10 }}>
              <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 6 }}>
                <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)' }} />
              </View>
              <Text variant="body" weight="bold" align="center" style={{ marginBottom: 4 }}>{t('app_icon.title')}</Text>
              <Text variant="caption" align="center" color={theme.colors.text.tertiary} style={{ marginBottom: 12, paddingHorizontal: 24 }}>
                {t('app_icon.subtitle')}
              </Text>

              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 20 }}>
                {ICONS.map((icon) => {
                  const selected = (icon.name ?? null) === (current ?? null);
                  const isApplying = applying === (icon.name ?? 'default');
                  return (
                    <Pressable key={icon.label} onPress={() => handleSelect(icon)} style={{ width: '31%', alignItems: 'center', marginBottom: 12 }}>
                      <View style={{ width: '100%', aspectRatio: 1, borderRadius: 34, overflow: 'hidden', borderWidth: selected ? 3 : 1, borderColor: selected ? theme.colors.accent.primary : theme.colors.border.light }}>
                        <Image source={icon.source} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                        {isApplying && (
                          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' }}>
                            <ActivityIndicator color="#FFF" />
                          </View>
                        )}
                        {selected && !isApplying && (
                          <View style={{ position: 'absolute', top: 6, right: 6, width: 24, height: 24, borderRadius: 12, backgroundColor: theme.colors.accent.primary, alignItems: 'center', justifyContent: 'center' }}>
                            <Feather name="check" size={14} color="#FFF" />
                          </View>
                        )}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </Animated.View>
        </View>
      </View>
    </Modal>
  );
}
