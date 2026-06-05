import React, { useState } from 'react';
import { View, Pressable, ScrollView, TextInput, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { useChatSettingsStore } from '../../src/store/chatSettingsStore';
import { showToast } from '../../src/store/toastStore';

export default function ChatSettingsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const chatId = id || '';
  const { getSettings, updateSettings } = useChatSettingsStore();
  const settings = getSettings(chatId);
  const [localName, setLocalName] = useState(settings.localName || '');
  const [fontSize, setFontSize] = useState(settings.fontSize);
  const [bubbleRadius, setBubbleRadius] = useState(settings.bubbleRadius);

  const pickBackground = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (!result.canceled && result.assets[0]) {
      updateSettings(chatId, { backgroundImage: result.assets[0].uri });
      showToast('Фон установлен', 'check');
    }
  };

  const save = () => {
    updateSettings(chatId, { localName: localName.trim() || undefined, fontSize, bubbleRadius });
    showToast('Сохранено', 'check');
    router.back();
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: insets.top + 8, paddingBottom: 12 }}>
        <Pressable onPress={() => router.back()}><Feather name="chevron-left" size={24} color={theme.colors.text.primary} /></Pressable>
        <Text variant="body" weight="bold">Настройки чата</Text>
        <Pressable onPress={save}><Text variant="body" weight="semibold" color={theme.colors.accent.primary}>Готово</Text></Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        {/* Background */}
        <Pressable onPress={pickBackground} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.background.elevated, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: theme.colors.border.light }}>
          <Feather name="image" size={18} color={theme.colors.accent.primary} />
          <Text variant="body" style={{ marginLeft: 12 }}>Фон чата</Text>
          {settings.backgroundImage && <Feather name="check" size={16} color={theme.colors.accent.primary} style={{ marginLeft: 'auto' }} />}
        </Pressable>

        {/* Remove background */}
        {settings.backgroundImage && (
          <Pressable onPress={() => { updateSettings(chatId, { backgroundImage: undefined }); showToast('Фон убран', 'check'); }} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.background.elevated, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: theme.colors.border.light }}>
            <Feather name="x" size={18} color="#FF3B30" />
            <Text variant="body" color="#FF3B30" style={{ marginLeft: 12 }}>Убрать фон</Text>
          </Pressable>
        )}

        {/* Local name */}
        <View style={{ backgroundColor: theme.colors.background.elevated, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: theme.colors.border.light }}>
          <Text variant="caption" weight="semibold" color={theme.colors.text.tertiary} style={{ marginBottom: 8 }}>Локальное имя</Text>
          <TextInput value={localName} onChangeText={setLocalName} placeholder="Имя для отображения" placeholderTextColor={theme.colors.text.tertiary} style={{ fontSize: 15, color: theme.colors.text.primary }} />
        </View>

        {/* Font size */}
        <View style={{ backgroundColor: theme.colors.background.elevated, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: theme.colors.border.light }}>
          <Text variant="caption" weight="semibold" color={theme.colors.text.tertiary} style={{ marginBottom: 8 }}>Размер шрифта: {fontSize}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Pressable onPress={() => setFontSize(Math.max(12, fontSize - 1))} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.colors.accent.primary + '15', alignItems: 'center', justifyContent: 'center' }}>
              <Feather name="minus" size={16} color={theme.colors.accent.primary} />
            </Pressable>
            <View style={{ flex: 1, height: 4, backgroundColor: theme.colors.border.light, borderRadius: 2 }}>
              <View style={{ width: `${((fontSize - 12) / 10) * 100}%`, height: 4, backgroundColor: theme.colors.accent.primary, borderRadius: 2 }} />
            </View>
            <Pressable onPress={() => setFontSize(Math.min(22, fontSize + 1))} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.colors.accent.primary + '15', alignItems: 'center', justifyContent: 'center' }}>
              <Feather name="plus" size={16} color={theme.colors.accent.primary} />
            </Pressable>
          </View>
        </View>

        {/* Bubble radius */}
        <View style={{ backgroundColor: theme.colors.background.elevated, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: theme.colors.border.light }}>
          <Text variant="caption" weight="semibold" color={theme.colors.text.tertiary} style={{ marginBottom: 8 }}>Округление пузырей: {bubbleRadius}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Pressable onPress={() => setBubbleRadius(Math.max(4, bubbleRadius - 2))} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.colors.accent.primary + '15', alignItems: 'center', justifyContent: 'center' }}>
              <Feather name="minus" size={16} color={theme.colors.accent.primary} />
            </Pressable>
            <View style={{ flex: 1, height: 4, backgroundColor: theme.colors.border.light, borderRadius: 2 }}>
              <View style={{ width: `${((bubbleRadius - 4) / 20) * 100}%`, height: 4, backgroundColor: theme.colors.accent.primary, borderRadius: 2 }} />
            </View>
            <Pressable onPress={() => setBubbleRadius(Math.min(24, bubbleRadius + 2))} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.colors.accent.primary + '15', alignItems: 'center', justifyContent: 'center' }}>
              <Feather name="plus" size={16} color={theme.colors.accent.primary} />
            </Pressable>
          </View>
        </View>

        {/* Font family */}
        <View style={{ backgroundColor: theme.colors.background.elevated, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: theme.colors.border.light }}>
          <Text variant="caption" weight="semibold" color={theme.colors.text.tertiary} style={{ marginBottom: 8 }}>Шрифт</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {['system', 'serif', 'mono'].map(f => (
              <Pressable key={f} onPress={() => updateSettings(chatId, { fontFamily: f })} style={{ flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: settings.fontFamily === f ? theme.colors.accent.primary + '20' : 'transparent', alignItems: 'center', borderWidth: 1, borderColor: settings.fontFamily === f ? theme.colors.accent.primary : theme.colors.border.light }}>
                <Text variant="caption" weight={settings.fontFamily === f ? 'bold' : 'regular'} color={settings.fontFamily === f ? theme.colors.accent.primary : theme.colors.text.primary}>{f}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
