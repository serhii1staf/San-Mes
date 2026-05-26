import React, { useState, useRef, useEffect } from 'react';
import { View, ScrollView, Pressable, ViewStyle, Alert, Platform, KeyboardAvoidingView, Animated, Dimensions, PanResponder, Text as RNText } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme';
import { Text, Input, Avatar } from '../../src/components/ui';
import { useAuthStore } from '../../src/store';
import { currentUser } from '../../src/utils/mockData';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const DISMISS_THRESHOLD = 120;

const EMOJIS = [
  '😊', '😎', '🥰', '🤩', '😇', '🦊', '🐱', '🐶',
  '🦁', '🐼', '🐨', '🦋', '🌸', '🌺', '🍀', '✨',
  '🔥', '💎', '🎭', '🎨', '🎵', '🌙', '☀️', '🌈',
  '🍄', '🪷', '🫧', '🧿', '💫', '🪐', '🌊', '🍂',
];

export default function EditProfileScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { user, updateProfile } = useAuthStore();
  const displayUser = user || currentUser;

  const [name, setName] = useState(displayUser.displayName);
  const [username, setUsername] = useState(displayUser.username);
  const [bio, setBio] = useState(displayUser.bio || '');
  const [selectedEmoji, setSelectedEmoji] = useState(displayUser.emoji || '😊');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Animation
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;
  const dragAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 65,
        friction: 11,
      }),
      Animated.timing(backdropAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const handleClose = () => {
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: SCREEN_HEIGHT,
        duration: 280,
        useNativeDriver: true,
      }),
      Animated.timing(backdropAnim, {
        toValue: 0,
        duration: 280,
        useNativeDriver: true,
      }),
    ]).start(() => {
      router.back();
    });
  };

  // Swipe down to dismiss
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return gestureState.dy > 10 && Math.abs(gestureState.dx) < Math.abs(gestureState.dy);
      },
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dy > 0) {
          dragAnim.setValue(gestureState.dy);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy > DISMISS_THRESHOLD) {
          handleClose();
        } else {
          Animated.spring(dragAnim, {
            toValue: 0,
            useNativeDriver: true,
            tension: 100,
            friction: 10,
          }).start();
        }
      },
    })
  ).current;

  const handleSave = () => {
    setIsSaving(true);
    setTimeout(() => {
      updateProfile({ displayName: name, username, bio, emoji: selectedEmoji });
      setIsSaving(false);
      Alert.alert('Сохранено!', 'Ваш профиль обновлён.');
      handleClose();
    }, 800);
  };

  const outerStyle: ViewStyle = {
    flex: 1,
    backgroundColor: 'transparent',
  };

  // Task 2: Modal positioned lower (insets.top + 60)
  const cardStyle: ViewStyle = {
    marginHorizontal: 6,
    marginTop: insets.top + 60,
    marginBottom: insets.bottom + 6,
    flex: 1,
    borderRadius: 32,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.3,
    shadowRadius: 32,
    elevation: 20,
  };

  const translateY = Animated.add(slideAnim, dragAnim);

  return (
    <View style={outerStyle}>
      {/* Backdrop - tap to close */}
      <Animated.View
        style={{
          ...({ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as ViewStyle),
          backgroundColor: 'rgba(0,0,0,0.4)',
          opacity: backdropAnim,
        }}
      >
        <Pressable style={{ flex: 1 }} onPress={handleClose} />
      </Animated.View>

      {/* Modal Card */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Animated.View
          style={[
            cardStyle,
            { transform: [{ translateY }] },
          ]}
          {...panResponder.panHandlers}
        >
          {/* Glass background */}
          <View
            style={{
              flex: 1,
              backgroundColor: theme.isDark
                ? 'rgba(30, 30, 30, 0.92)'
                : 'rgba(255, 255, 255, 0.94)',
            }}
          >
              {/* Drag handle */}
              <View style={{ alignItems: 'center', paddingTop: 12, paddingBottom: 4 }}>
                <View
                  style={{
                    width: 36,
                    height: 5,
                    borderRadius: 3,
                    backgroundColor: theme.colors.border.medium,
                  }}
                />
              </View>

              <ScrollView
                contentContainerStyle={{ paddingBottom: 32 }}
                showsVerticalScrollIndicator={false}
                scrollEnabled={true}
              >
                {/* Header */}
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingHorizontal: 20,
                    paddingTop: 8,
                    paddingBottom: 12,
                  }}
                >
                  <Pressable onPress={handleClose}>
                    <Feather name="x" size={22} color={theme.colors.text.primary} />
                  </Pressable>
                  <Text variant="body" weight="semibold">Редактировать</Text>
                  <View style={{ width: 22 }} />
                </View>

                {/* Emoji Avatar */}
                <View style={{ alignItems: 'center', marginVertical: 20 }}>
                  <Avatar emoji={selectedEmoji} size="xl" />
                  <Pressable style={{ marginTop: 12 }} onPress={() => setShowEmojiPicker(true)}>
                    <Text variant="body" weight="medium" color={theme.colors.accent.primary}>
                      Изменить эмодзи
                    </Text>
                  </Pressable>
                </View>

                {/* Fields */}
                <View style={{ paddingHorizontal: 20 }}>
                  <Input
                    label="Имя"
                    value={name}
                    onChangeText={setName}
                    placeholder="Ваше имя"
                    style={{ marginBottom: 16 }}
                  />

                  <Input
                    label="Имя пользователя"
                    value={username}
                    onChangeText={setUsername}
                    placeholder="username"
                    style={{ marginBottom: 16 }}
                  />

                  <Input
                    label="О себе"
                    value={bio}
                    onChangeText={(text) => setBio(text.slice(0, 150))}
                    placeholder="Расскажите о себе"
                    multiline
                    style={{ marginBottom: 4 }}
                  />
                  <Text
                    variant="caption"
                    color={theme.colors.text.tertiary}
                    style={{ marginBottom: 28 }}
                  >
                    {150 - bio.length} символов осталось
                  </Text>

                  <Pressable
                    onPress={handleSave}
                    style={{
                      backgroundColor: theme.colors.accent.primary,
                      borderRadius: 14,
                      paddingVertical: 16,
                      alignItems: 'center',
                    }}
                    disabled={isSaving}
                  >
                    <Text variant="body" weight="semibold" color={theme.colors.text.inverse}>
                      {isSaving ? 'Сохранение...' : 'Сохранить'}
                    </Text>
                  </Pressable>
                </View>
              </ScrollView>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>

      {/* Task 1: Emoji Picker as separate modal overlay */}
      {showEmojiPicker && (
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 999,
          }}
        >
          {/* Dark backdrop */}
          <Pressable
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0,0,0,0.5)',
            }}
            onPress={() => setShowEmojiPicker(false)}
          />
          {/* Bottom sheet card */}
          <View
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              backgroundColor: theme.isDark ? '#1e1e1e' : '#ffffff',
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              paddingTop: 16,
              paddingBottom: insets.bottom + 20,
              paddingHorizontal: 20,
            }}
          >
            {/* Handle */}
            <View style={{ alignItems: 'center', marginBottom: 16 }}>
              <View
                style={{
                  width: 36,
                  height: 5,
                  borderRadius: 3,
                  backgroundColor: theme.colors.border.medium,
                }}
              />
            </View>
            <Text variant="body" weight="semibold" align="center" style={{ marginBottom: 16 }}>
              Выберите эмодзи
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10 }}>
              {EMOJIS.map((e) => (
                <Pressable
                  key={e}
                  onPress={() => { setSelectedEmoji(e); setShowEmojiPicker(false); }}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 12,
                    backgroundColor: selectedEmoji === e ? theme.colors.accent.primary + '30' : theme.colors.background.secondary,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: selectedEmoji === e ? 2 : 0,
                    borderColor: theme.colors.accent.primary,
                  }}
                >
                  <RNText style={{ fontSize: 20 }} allowFontScaling={false}>{e}</RNText>
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
