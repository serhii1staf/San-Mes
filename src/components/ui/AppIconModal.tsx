import React, { useState, useRef, useEffect } from 'react';
import { View, Pressable, Modal, Image, ActivityIndicator, Alert, Animated, Dimensions, ScrollView, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { Text } from './Text';
import {
  setAlternateAppIcon,
  getAppIconName,
  supportsAlternateIcons,
} from 'expo-alternate-app-icons';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

interface IconOption {
  name: string | null; // null = default app icon
  label: string;
  source: any;
}

const ICONS: IconOption[] = [
  { name: null, label: 'По умолчанию', source: require('../../../assets/icon.png') },
  { name: 'Classic', label: 'Классическая', source: require('../../../assets/app-icons/classic.png') },
  { name: 'Dark', label: 'Тёмная', source: require('../../../assets/app-icons/dark.png') },
  { name: 'Blue', label: 'Синяя', source: require('../../../assets/app-icons/blue.png') },
  { name: 'Orange', label: 'Оранжевая', source: require('../../../assets/app-icons/orange.png') },
  { name: 'Mono', label: 'Моно', source: require('../../../assets/app-icons/mono.png') },
  { name: 'Gradient', label: 'Градиент', source: require('../../../assets/app-icons/gradient.png') },
];

interface AppIconModalProps {
  visible: boolean;
  onClose: () => void;
}

export function AppIconModal({ visible, onClose }: AppIconModalProps) {
  const theme = useTheme();
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
    if (Platform.OS !== 'ios') { Alert.alert('Недоступно', 'Смена иконки доступна только на iOS.'); return; }
    if (!supportsAlternateIcons) { Alert.alert('Недоступно', 'Это устройство не поддерживает смену иконки.'); return; }
    const isSame = (icon.name ?? null) === (current ?? null);
    if (isSame || applying) return;
    setApplying(icon.name ?? 'default');
    try {
      await setAlternateAppIcon(icon.name);
      setCurrent(icon.name ?? null);
    } catch {
      Alert.alert('Ошибка', 'Не удалось сменить иконку.');
    } finally {
      setApplying(null);
    }
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
              <Text variant="body" weight="bold" align="center" style={{ marginBottom: 4 }}>Иконка приложения</Text>
              <Text variant="caption" align="center" color={theme.colors.text.tertiary} style={{ marginBottom: 12, paddingHorizontal: 24 }}>
                Иконка на главном экране телефона
              </Text>

              <ScrollView contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 20 }} showsVerticalScrollIndicator={false}>
                {ICONS.map((icon) => {
                  const selected = (icon.name ?? null) === (current ?? null);
                  const isApplying = applying === (icon.name ?? 'default');
                  return (
                    <Pressable key={icon.label} onPress={() => handleSelect(icon)} style={{ width: '31%', alignItems: 'center', marginBottom: 18 }}>
                      <View style={{ width: '100%', aspectRatio: 1, borderRadius: 18, overflow: 'hidden', borderWidth: selected ? 2.5 : 1, borderColor: selected ? theme.colors.accent.primary : theme.colors.border.light }}>
                        <Image source={icon.source} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                        {isApplying && (
                          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' }}>
                            <ActivityIndicator color="#FFF" />
                          </View>
                        )}
                        {selected && !isApplying && (
                          <View style={{ position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: theme.colors.accent.primary, alignItems: 'center', justifyContent: 'center' }}>
                            <Feather name="check" size={13} color="#FFF" />
                          </View>
                        )}
                      </View>
                      <Text variant="caption" weight={selected ? 'semibold' : 'regular'} color={selected ? theme.colors.accent.primary : theme.colors.text.secondary} style={{ marginTop: 6 }} numberOfLines={1}>
                        {icon.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          </Animated.View>
        </View>
      </View>
    </Modal>
  );
}
