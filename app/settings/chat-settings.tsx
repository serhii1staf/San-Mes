import React, { useState } from 'react';
import { View, Pressable, ScrollView, TextInput, StyleSheet, ImageBackground } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '../../src/theme';
import { Text, Avatar } from '../../src/components/ui';
import { useChatSettingsStore, GLOBAL_CHAT_SETTINGS_KEY } from '../../src/store/chatSettingsStore';
import { useEntityStore } from '../../src/store';
import { showToast } from '../../src/store/toastStore';

function ChatPreview({ fontSize, bubbleRadius, fontFamily, backgroundImage }: { fontSize: number; bubbleRadius: number; fontFamily: string; backgroundImage?: string }) {
  const theme = useTheme();
  const fontFamilyStyle = fontFamily === 'mono' ? 'monospace' : fontFamily === 'serif' ? 'serif' : undefined;

  const content = (
    <View style={{ paddingHorizontal: 16, paddingVertical: 20, minHeight: 200 }}>
      {/* Incoming message */}
      <View style={{ alignSelf: 'flex-start', maxWidth: '75%', marginBottom: 8 }}>
        <View style={{ backgroundColor: theme.colors.background.tertiary, paddingHorizontal: 14, paddingVertical: 10, borderRadius: bubbleRadius, borderBottomLeftRadius: 4 }}>
          <Text variant="body" style={{ fontSize, fontFamily: fontFamilyStyle }}>Привет! Как дела? 😊</Text>
          <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 10, marginTop: 3, alignSelf: 'flex-end' }}>12:30</Text>
        </View>
      </View>
      {/* Outgoing message */}
      <View style={{ alignSelf: 'flex-end', maxWidth: '75%', marginBottom: 8 }}>
        <View style={{ backgroundColor: theme.colors.accent.primary, paddingHorizontal: 14, paddingVertical: 10, borderRadius: bubbleRadius, borderBottomRightRadius: 4 }}>
          <Text variant="body" color="#FFFFFF" style={{ fontSize, fontFamily: fontFamilyStyle }}>Всё отлично, спасибо!</Text>
          <Text variant="caption" color="rgba(255,255,255,0.6)" style={{ fontSize: 10, marginTop: 3, alignSelf: 'flex-end' }}>12:31</Text>
        </View>
      </View>
      {/* Another incoming */}
      <View style={{ alignSelf: 'flex-start', maxWidth: '75%' }}>
        <View style={{ backgroundColor: theme.colors.background.tertiary, paddingHorizontal: 14, paddingVertical: 10, borderRadius: bubbleRadius, borderBottomLeftRadius: 4 }}>
          <Text variant="body" style={{ fontSize, fontFamily: fontFamilyStyle }}>Давай встретимся завтра?</Text>
          <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 10, marginTop: 3, alignSelf: 'flex-end' }}>12:32</Text>
        </View>
      </View>
    </View>
  );

  if (backgroundImage) {
    return (
      <ImageBackground source={{ uri: backgroundImage }} style={{ minHeight: 200 }} resizeMode="cover">
        {content}
      </ImageBackground>
    );
  }

  return <View style={{ backgroundColor: theme.colors.background.primary }}>{content}</View>;
}

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
  const [fontFamily, setFontFamily] = useState(settings.fontFamily);
  const [backgroundImage, setBackgroundImage] = useState(settings.backgroundImage);

  // Try to get participant info from entity store conversations
  const conversations = useEntityStore((s) => s.conversations);
  const conv = conversations.find(c => c.id === chatId);
  const isGlobal = chatId === GLOBAL_CHAT_SETTINGS_KEY;
  const participantName = isGlobal ? 'Все чаты' : (conv?.participantName || 'Чат');
  const participantEmoji = isGlobal ? '💬' : (conv?.participantEmoji || '😊');

  const pickBackground = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (!result.canceled && result.assets[0]) {
      const uri = result.assets[0].uri;
      setBackgroundImage(uri);
      updateSettings(chatId, { backgroundImage: uri });
      showToast('Фон установлен', 'check');
    }
  };

  const save = () => {
    updateSettings(chatId, { localName: localName.trim() || undefined, fontSize, bubbleRadius, fontFamily, backgroundImage });
    showToast('Сохранено', 'check');
    router.back();
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
      {/* Blurred header */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100 }}>
        <BlurView intensity={80} tint={theme.isDark ? 'dark' : 'light'} style={{ paddingTop: insets.top + 8, paddingBottom: 12, paddingHorizontal: 20 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Pressable onPress={() => router.back()} hitSlop={8}>
              <Feather name="chevron-left" size={24} color={theme.colors.text.primary} />
            </Pressable>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Avatar emoji={participantEmoji} size="xs" />
              <Text variant="body" weight="bold">{participantName}</Text>
            </View>
            <Pressable onPress={save} hitSlop={8}>
              <Text variant="body" weight="semibold" color={theme.colors.accent.primary}>Готово</Text>
            </Pressable>
          </View>
        </BlurView>
      </View>

      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 64, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {/* Live Chat Preview */}
        <View style={{ marginHorizontal: 16, marginBottom: 24, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: theme.colors.border.light }}>
          <View style={{ backgroundColor: theme.colors.background.elevated, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 0.5, borderBottomColor: theme.colors.border.light }}>
            <Feather name="chevron-left" size={16} color={theme.colors.text.tertiary} />
            <Avatar emoji={participantEmoji} size="xs" style={{ marginLeft: 8 }} />
            <Text variant="caption" weight="semibold" style={{ marginLeft: 6 }}>{localName || participantName}</Text>
          </View>
          <ChatPreview fontSize={fontSize} bubbleRadius={bubbleRadius} fontFamily={fontFamily} backgroundImage={backgroundImage} />
        </View>

        {/* Settings sections */}
        <View style={{ paddingHorizontal: 16, gap: 12 }}>
          {/* Background */}
          <View style={[styles.section, { backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light }]}>
            <Pressable onPress={pickBackground} style={styles.row}>
              <View style={[styles.iconCircle, { backgroundColor: theme.colors.accent.primary + '15' }]}>
                <Feather name="image" size={16} color={theme.colors.accent.primary} />
              </View>
              <Text variant="body" style={{ flex: 1 }}>Фон чата</Text>
              {backgroundImage && <Feather name="check-circle" size={16} color={theme.colors.accent.primary} />}
              <Feather name="chevron-right" size={16} color={theme.colors.text.tertiary} style={{ marginLeft: 8 }} />
            </Pressable>
            {backgroundImage && (
              <>
                <View style={{ height: 0.5, backgroundColor: theme.colors.border.light, marginLeft: 52 }} />
                <Pressable onPress={() => { setBackgroundImage(undefined); updateSettings(chatId, { backgroundImage: undefined }); showToast('Фон убран', 'check'); }} style={styles.row}>
                  <View style={[styles.iconCircle, { backgroundColor: '#FF3B3015' }]}>
                    <Feather name="x" size={16} color="#FF3B30" />
                  </View>
                  <Text variant="body" color="#FF3B30">Убрать фон</Text>
                </Pressable>
              </>
            )}
          </View>

          {/* Local name (per-chat only, not for global settings) */}
          {!isGlobal && (
          <View style={[styles.section, { backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light }]}>
            <View style={[styles.row, { paddingVertical: 8 }]}>
              <View style={[styles.iconCircle, { backgroundColor: theme.colors.accent.primary + '15' }]}>
                <Feather name="edit-3" size={16} color={theme.colors.accent.primary} />
              </View>
              <TextInput
                value={localName}
                onChangeText={setLocalName}
                placeholder="Локальное имя"
                placeholderTextColor={theme.colors.text.tertiary}
                style={{ flex: 1, fontSize: 15, color: theme.colors.text.primary, paddingVertical: 4 }}
              />
            </View>
          </View>
          )}

          {/* Font size */}
          <View style={[styles.section, { backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light }]}>
            <View style={{ padding: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                <View style={[styles.iconCircle, { backgroundColor: theme.colors.accent.primary + '15' }]}>
                  <Feather name="type" size={16} color={theme.colors.accent.primary} />
                </View>
                <Text variant="body" style={{ flex: 1 }}>Размер шрифта</Text>
                <Text variant="caption" weight="bold" color={theme.colors.accent.primary}>{fontSize}</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Pressable onPress={() => setFontSize(Math.max(12, fontSize - 1))} style={[styles.stepper, { backgroundColor: theme.colors.background.primary }]}>
                  <Text variant="body" color={theme.colors.text.secondary} style={{ fontSize: 12 }}>A</Text>
                </Pressable>
                <View style={{ flex: 1, height: 4, backgroundColor: theme.colors.border.light, borderRadius: 2 }}>
                  <View style={{ width: `${((fontSize - 12) / 10) * 100}%`, height: 4, backgroundColor: theme.colors.accent.primary, borderRadius: 2 }} />
                </View>
                <Pressable onPress={() => setFontSize(Math.min(22, fontSize + 1))} style={[styles.stepper, { backgroundColor: theme.colors.background.primary }]}>
                  <Text variant="body" color={theme.colors.text.secondary} style={{ fontSize: 18 }}>A</Text>
                </Pressable>
              </View>
            </View>
          </View>

          {/* Bubble radius */}
          <View style={[styles.section, { backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light }]}>
            <View style={{ padding: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                <View style={[styles.iconCircle, { backgroundColor: theme.colors.accent.primary + '15' }]}>
                  <Feather name="message-circle" size={16} color={theme.colors.accent.primary} />
                </View>
                <Text variant="body" style={{ flex: 1 }}>Округление</Text>
                <Text variant="caption" weight="bold" color={theme.colors.accent.primary}>{bubbleRadius}</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Pressable onPress={() => setBubbleRadius(Math.max(4, bubbleRadius - 2))} style={[styles.stepper, { backgroundColor: theme.colors.background.primary }]}>
                  <Feather name="minus" size={14} color={theme.colors.text.secondary} />
                </Pressable>
                <View style={{ flex: 1, height: 4, backgroundColor: theme.colors.border.light, borderRadius: 2 }}>
                  <View style={{ width: `${((bubbleRadius - 4) / 20) * 100}%`, height: 4, backgroundColor: theme.colors.accent.primary, borderRadius: 2 }} />
                </View>
                <Pressable onPress={() => setBubbleRadius(Math.min(24, bubbleRadius + 2))} style={[styles.stepper, { backgroundColor: theme.colors.background.primary }]}>
                  <Feather name="plus" size={14} color={theme.colors.text.secondary} />
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    borderRadius: 14,
    borderWidth: 0.5,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  stepper: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
