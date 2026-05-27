import React, { useState, useRef, useEffect } from 'react';
import { View, ScrollView, Pressable, ViewStyle, Platform, KeyboardAvoidingView, Animated, Dimensions, PanResponder, Text as RNText } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme';
import { Text, Input, Avatar } from '../../src/components/ui';
import { useAuthStore, UserLink } from '../../src/store/authStore';
import { updateProfile as updateSupabaseProfile } from '../../src/lib/supabase';
import { currentUser } from '../../src/utils/mockData';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const DISMISS_THRESHOLD = 120;

const LINK_TYPES = [
  { key: 'github', label: 'GitHub', icon: 'github' },
  { key: 'twitter', label: 'Twitter', icon: 'twitter' },
  { key: 'instagram', label: 'Instagram', icon: 'instagram' },
  { key: 'youtube', label: 'YouTube', icon: 'youtube' },
  { key: 'telegram', label: 'Telegram', icon: 'send' },
  { key: 'website', label: 'Сайт', icon: 'globe' },
];

const MOOD_CATEGORIES: { title: string; emojis: string[] }[] = [
  {
    title: 'Настроение',
    emojis: [
      '😊', '😄', '😁', '🥰', '😍', '🤩', '😎', '🥳',
      '😇', '🤗', '😌', '😏', '🤔', '😴', '🥱', '😢',
      '😭', '😤', '🤬', '😱', '🤯', '😵‍💫', '🫠', '🥺',
      '😈', '👻', '💀', '🤡', '😷', '🤒', '🤕', '🤑',
    ],
  },
  {
    title: 'Животные',
    emojis: [
      '🦊', '🐱', '🐶', '🐺', '🦁', '🐯', '🐼', '🐨',
      '🐸', '🐙', '🦋', '🐝', '🐞', '🦄', '🐰', '🐻',
      '🦈', '🐬', '🐳', '🦉', '🦅', '🐦', '🦜', '🐧',
      '🐢', '🦎', '🐍', '🦔', '🐹', '🐿️', '🦩', '🐾',
    ],
  },
  {
    title: 'Природа',
    emojis: [
      '🌸', '🌺', '🌻', '🌹', '🌷', '💐', '🍀', '🌿',
      '🍃', '🍂', '🍁', '🌾', '🌵', '🎋', '🪷', '🌊',
      '☀️', '🌙', '⭐', '🌈', '☁️', '⚡', '❄️', '🔥',
      '🍄', '🪨', '💎', '🪐', '🌍', '🌋', '🏔️', '🌅',
    ],
  },
  {
    title: 'Еда',
    emojis: [
      '🍕', '🍔', '🍟', '🌮', '🍣', '🍜', '🍩', '🍪',
      '🎂', '🍰', '🧁', '🍫', '🍬', '🍭', '🍿', '🥤',
      '☕', '🍵', '🧋', '🍺', '🍷', '🥂', '🍹', '🧃',
      '🍎', '🍓', '🍑', '🥑', '🌽', '🥕', '🍉', '🥥',
    ],
  },
  {
    title: 'Активности',
    emojis: [
      '🎮', '🎯', '🎲', '🎸', '🎵', '🎤', '🎬', '🎨',
      '🎭', '🎪', '🎢', '🏀', '⚽', '🏈', '🎾', '🏓',
      '🎳', '🛹', '🏄', '🚴', '🏋️', '🧘', '💃', '🕺',
      '🎧', '📷', '🎥', '💻', '📚', '✍️', '🎓', '🔬',
    ],
  },
  {
    title: 'Символы',
    emojis: [
      '✨', '💫', '⚡', '💥', '🫧', '🧿', '🪬', '🔮',
      '💝', '💖', '💗', '💓', '💕', '❤️‍🔥', '🖤', '💜',
      '💙', '💚', '💛', '🧡', '❤️', '🤍', '🩷', '🩵',
      '☮️', '✝️', '☯️', '♾️', '🏳️‍🌈', '🎀', '👑', '🦴',
    ],
  },
  {
    title: 'Объекты',
    emojis: [
      '🚀', '✈️', '🛸', '🏎️', '🚗', '🛵', '⛵', '🚂',
      '🏠', '🏰', '⛩️', '🗼', '🎡', '🌉', '💡', '🔑',
      '🗝️', '💰', '💸', '🎁', '🎈', '🎊', '🎉', '🪩',
      '🛡️', '⚔️', '🏹', '🪄', '🧲', '💊', '🩹', '🧸',
    ],
  },
];

// Flat list for quick access
const ALL_EMOJIS = MOOD_CATEGORIES.flatMap(c => c.emojis);

export default function EditProfileScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { user, updateProfile } = useAuthStore();
  const displayUser = user || currentUser;

  const [name, setName] = useState(displayUser.displayName);
  const [username, setUsername] = useState(displayUser.username);
  const [bio, setBio] = useState(displayUser.bio || '');
  const [selectedEmoji, setSelectedEmoji] = useState(displayUser.emoji || '😊');
  const [links, setLinks] = useState<UserLink[]>((user as any)?.links || []);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showLinkPicker, setShowLinkPicker] = useState(false);
  const [editingLinkIndex, setEditingLinkIndex] = useState<number | null>(null);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkType, setLinkType] = useState('website');
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

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // Update local state immediately
      updateProfile({ displayName: name, username, bio, emoji: selectedEmoji, links });

      // Sync to Supabase (name, bio, emoji)
      if (user?.id) {
        await updateSupabaseProfile(user.id, {
          display_name: name,
          bio,
          emoji: selectedEmoji,
        });
      }
    } catch (e) {
      // Local save always works, Supabase sync is best-effort
    }
    setIsSaving(false);
    handleClose();
  };

  const handleAddLink = () => {
    if (links.length >= 3) {
      return;
    }
    setEditingLinkIndex(null);
    setLinkUrl('');
    setLinkType('website');
    setShowLinkPicker(true);
  };

  const handleEditLink = (index: number) => {
    setEditingLinkIndex(index);
    setLinkUrl(links[index].url);
    setLinkType(links[index].type);
    setShowLinkPicker(true);
  };

  const handleSaveLink = () => {
    if (!linkUrl.trim()) {
      setShowLinkPicker(false);
      return;
    }
    const newLink: UserLink = { type: linkType, url: linkUrl.trim() };
    if (editingLinkIndex !== null) {
      const updated = [...links];
      updated[editingLinkIndex] = newLink;
      setLinks(updated);
    } else {
      setLinks([...links, newLink]);
    }
    setShowLinkPicker(false);
  };

  const handleRemoveLink = (index: number) => {
    setLinks(links.filter((_, i) => i !== index));
  };

  const outerStyle: ViewStyle = {
    flex: 1,
    backgroundColor: 'transparent',
  };

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
                ? 'rgba(20, 20, 20, 0.98)'
                : 'rgba(255, 255, 255, 0.98)',
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
                      Изменить модди
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
                    style={{ marginBottom: 20 }}
                  >
                    {150 - bio.length} символов осталось
                  </Text>

                  {/* Links Section */}
                  <View style={{ marginBottom: 24 }}>
                    <Text variant="body" weight="semibold" style={{ marginBottom: 12 }}>
                      Ссылки
                    </Text>
                    {links.map((link, index) => (
                      <View
                        key={index}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          backgroundColor: theme.colors.background.secondary,
                          borderRadius: 12,
                          paddingHorizontal: 12,
                          paddingVertical: 10,
                          marginBottom: 8,
                        }}
                      >
                        <Feather
                          name={(LINK_TYPES.find(t => t.key === link.type)?.icon || 'link') as any}
                          size={18}
                          color={theme.colors.accent.primary}
                        />
                        <Pressable
                          onPress={() => handleEditLink(index)}
                          style={{ flex: 1, marginLeft: 10 }}
                        >
                          <Text variant="caption" weight="medium" numberOfLines={1}>
                            {link.url}
                          </Text>
                        </Pressable>
                        <Pressable onPress={() => handleRemoveLink(index)}>
                          <Feather name="x-circle" size={18} color={theme.colors.text.tertiary} />
                        </Pressable>
                      </View>
                    ))}
                    {links.length < 3 && (
                      <Pressable
                        onPress={handleAddLink}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 8,
                          paddingVertical: 10,
                        }}
                      >
                        <Feather name="plus-circle" size={18} color={theme.colors.accent.primary} />
                        <Text variant="caption" weight="medium" color={theme.colors.accent.primary}>
                          Добавить ссылку
                        </Text>
                      </Pressable>
                    )}
                  </View>

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

      {/* Emoji/Mood Picker - Full modal same format as edit modal */}
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
          {/* Full modal card - same format as edit modal */}
          <View
            style={{
              marginHorizontal: 6,
              marginTop: insets.top + 60,
              marginBottom: insets.bottom + 6,
              flex: 1,
              borderRadius: 32,
              overflow: 'hidden',
              backgroundColor: theme.isDark ? 'rgba(30, 30, 30, 0.97)' : 'rgba(255, 255, 255, 0.98)',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 12 },
              shadowOpacity: 0.3,
              shadowRadius: 32,
              elevation: 20,
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
              <Pressable onPress={() => setShowEmojiPicker(false)}>
                <Feather name="x" size={22} color={theme.colors.text.primary} />
              </Pressable>
              <Text variant="body" weight="semibold">Изменить модди</Text>
              <View style={{ width: 22 }} />
            </View>

            {/* Current selection preview */}
            <View style={{ alignItems: 'center', marginBottom: 16 }}>
              <View
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 32,
                  backgroundColor: theme.colors.accent.primary + '20',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 2,
                  borderColor: theme.colors.accent.primary,
                }}
              >
                <RNText style={{ fontSize: 32 }} allowFontScaling={false}>{selectedEmoji}</RNText>
              </View>
            </View>

            {/* Scrollable emoji categories */}
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
            >
              {MOOD_CATEGORIES.map((category) => (
                <View key={category.title} style={{ marginBottom: 20 }}>
                  <Text variant="caption" weight="semibold" color={theme.colors.text.secondary} style={{ marginBottom: 10, paddingHorizontal: 4 }}>
                    {category.title}
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 }}>
                    {category.emojis.map((e) => (
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
              ))}
            </ScrollView>
          </View>
        </View>
      )}

      {/* Link Picker modal overlay */}
      {showLinkPicker && (
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
          <Pressable
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0,0,0,0.5)',
            }}
            onPress={() => setShowLinkPicker(false)}
          />
          <KeyboardAvoidingView
            style={{ flex: 1, justifyContent: 'center' }}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
            <View
              style={{
                marginHorizontal: 16,
                backgroundColor: theme.isDark ? '#1e1e1e' : '#ffffff',
                borderRadius: 24,
                paddingTop: 16,
                paddingBottom: 24,
                paddingHorizontal: 20,
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 12 },
                shadowOpacity: 0.3,
                shadowRadius: 32,
                elevation: 20,
              }}
            >
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
                {editingLinkIndex !== null ? 'Редактировать ссылку' : 'Добавить ссылку'}
              </Text>

              {/* Link type selector */}
              <Text variant="caption" weight="medium" color={theme.colors.text.secondary} style={{ marginBottom: 8 }}>
                Тип
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                {LINK_TYPES.map((lt) => (
                  <Pressable
                    key={lt.key}
                    onPress={() => setLinkType(lt.key)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 6,
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      borderRadius: 10,
                      backgroundColor: linkType === lt.key
                        ? theme.colors.accent.primary + '20'
                        : theme.colors.background.secondary,
                      borderWidth: linkType === lt.key ? 1.5 : 0,
                      borderColor: theme.colors.accent.primary,
                    }}
                  >
                    <Feather name={lt.icon as any} size={14} color={linkType === lt.key ? theme.colors.accent.primary : theme.colors.text.tertiary} />
                    <Text variant="caption" weight={linkType === lt.key ? 'semibold' : 'regular'} color={linkType === lt.key ? theme.colors.accent.primary : theme.colors.text.secondary}>
                      {lt.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {/* URL input */}
              <Input
                label="URL"
                value={linkUrl}
                onChangeText={setLinkUrl}
                placeholder="https://..."
                style={{ marginBottom: 20 }}
              />

              <Pressable
                onPress={handleSaveLink}
                style={{
                  backgroundColor: theme.colors.accent.primary,
                  borderRadius: 14,
                  paddingVertical: 14,
                  alignItems: 'center',
                }}
              >
                <Text variant="body" weight="semibold" color={theme.colors.text.inverse}>
                  {editingLinkIndex !== null ? 'Сохранить' : 'Добавить'}
                </Text>
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </View>
      )}
    </View>
  );
}
