import React, { useState, useRef, useEffect } from 'react';
import { View, ScrollView, Pressable, ViewStyle, Alert, Platform, KeyboardAvoidingView, Animated, Dimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme';
import { Text, Input, Avatar } from '../../src/components/ui';
import { useAuthStore } from '../../src/store';
import { currentUser } from '../../src/utils/mockData';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function EditProfileScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { user, updateProfile } = useAuthStore();
  const displayUser = user || currentUser;

  const [name, setName] = useState(displayUser.displayName);
  const [username, setUsername] = useState(displayUser.username);
  const [bio, setBio] = useState(displayUser.bio || '');
  const [website, setWebsite] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Animation
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;

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

  const handleSave = () => {
    setIsSaving(true);
    setTimeout(() => {
      updateProfile({ displayName: name, username, bio });
      setIsSaving(false);
      Alert.alert('Сохранено!', 'Ваш профиль обновлён.');
      handleClose();
    }, 800);
  };

  const outerStyle: ViewStyle = {
    flex: 1,
    backgroundColor: 'transparent',
  };

  const cardStyle: ViewStyle = {
    backgroundColor: theme.colors.background.elevated,
    borderRadius: 28,
    marginHorizontal: 12,
    marginTop: insets.top + 12,
    marginBottom: insets.bottom + 12,
    flex: 1,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 30,
    elevation: 16,
  };

  return (
    <View style={outerStyle}>
      {/* Backdrop */}
      <Animated.View
        style={{
          ...({ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as ViewStyle),
          backgroundColor: 'rgba(0,0,0,0.5)',
          opacity: backdropAnim,
        }}
      />

      {/* Modal Card */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Animated.View
          style={[
            cardStyle,
            { transform: [{ translateY: slideAnim }] },
          ]}
        >
          <ScrollView
            contentContainerStyle={{ paddingBottom: 32 }}
            showsVerticalScrollIndicator={false}
          >
            {/* Header */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingHorizontal: 20,
                paddingTop: 20,
                paddingBottom: 12,
              }}
            >
              <Pressable onPress={handleClose}>
                <Feather name="x" size={22} color={theme.colors.text.primary} />
              </Pressable>
              <Text variant="body" weight="semibold">Редактировать</Text>
              <View style={{ width: 22 }} />
            </View>

            {/* Drag indicator */}
            <View style={{ alignItems: 'center', marginBottom: 8 }}>
              <View
                style={{
                  width: 36,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: theme.colors.border.light,
                }}
              />
            </View>

            {/* Avatar */}
            <View style={{ alignItems: 'center', marginVertical: 24 }}>
              <View style={{ position: 'relative' }}>
                <Avatar source={displayUser.avatar} name={displayUser.displayName} size="xl" />
                <Pressable
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    right: 0,
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    backgroundColor: theme.colors.accent.primary,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: 2,
                    borderColor: theme.colors.background.elevated,
                  }}
                >
                  <Feather name="camera" size={16} color={theme.colors.text.inverse} />
                </Pressable>
              </View>
              <Pressable style={{ marginTop: 12 }}>
                <Text variant="body" weight="medium" color={theme.colors.accent.primary}>
                  Изменить фото
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
                style={{ marginBottom: 16 }}
              >
                {150 - bio.length} символов осталось
              </Text>

              <Input
                label="Сайт"
                value={website}
                onChangeText={setWebsite}
                placeholder="https://yourwebsite.com"
                style={{ marginBottom: 28 }}
              />

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
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}
