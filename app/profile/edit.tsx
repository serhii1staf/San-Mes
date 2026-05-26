import React, { useState, useRef, useEffect } from 'react';
import { View, ScrollView, Pressable, ViewStyle, Alert, Platform, KeyboardAvoidingView, Animated, Dimensions, PanResponder } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme';
import { Text, Input, Avatar } from '../../src/components/ui';
import { useAuthStore } from '../../src/store';
import { currentUser } from '../../src/utils/mockData';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const DISMISS_THRESHOLD = 120;

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

  // Modal is lower (more top margin), very rounded corners, glass effect
  const cardStyle: ViewStyle = {
    marginHorizontal: 6,
    marginTop: insets.top + 40,
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

                {/* Avatar */}
                <View style={{ alignItems: 'center', marginVertical: 20 }}>
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
                        borderColor: theme.isDark ? 'rgba(30,30,30,0.75)' : 'rgba(255,255,255,0.78)',
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
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}
