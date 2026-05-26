import React, { useState } from 'react';
import { View, TextInput, Pressable, ViewStyle, ScrollView, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { useAuthStore } from '../../src/store/authStore';
import { createPost } from '../../src/lib/supabase';

const MAX_CHARS = 500;

type Audience = 'public' | 'friends';

export default function CreateScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const [content, setContent] = useState('');
  const [isPosting, setIsPosting] = useState(false);
  const [audience, setAudience] = useState<Audience>('public');

  const handlePost = async () => {
    if (!content.trim()) return;
    if (!user) {
      Alert.alert('Ошибка', 'Необходимо войти в аккаунт');
      return;
    }

    setIsPosting(true);
    try {
      const { error } = await createPost(user.id, content.trim());
      if (error) {
        Alert.alert('Ошибка', error);
      } else {
        setContent('');
        Alert.alert('Готово', 'Пост опубликован!');
      }
    } catch (e) {
      Alert.alert('Ошибка', 'Не удалось опубликовать пост');
    } finally {
      setIsPosting(false);
    }
  };

  const charsRemaining = MAX_CHARS - content.length;
  const charColor = charsRemaining < 50
    ? theme.colors.status.error
    : charsRemaining < 100
      ? theme.colors.status.warning
      : theme.colors.text.tertiary;

  const containerStyle: ViewStyle = {
    flex: 1,
    backgroundColor: theme.colors.background.primary,
    paddingTop: insets.top,
  };

  return (
    <ScrollView style={containerStyle} contentContainerStyle={{ paddingBottom: 100 }}>
      <View style={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.base }}>
        <View>
          <Text variant="subheading" weight="bold" style={{ marginBottom: theme.spacing.lg }}>
            Новый пост
          </Text>
        </View>

        <View>
          <View
            style={{
              backgroundColor: theme.colors.background.elevated,
              borderRadius: theme.borderRadius.lg,
              padding: theme.spacing.base,
              minHeight: 160,
              borderWidth: 1,
              borderColor: theme.colors.border.light,
            }}
          >
            <TextInput
              value={content}
              onChangeText={(text) => setContent(text.slice(0, MAX_CHARS))}
              placeholder="Что у вас нового?"
              placeholderTextColor={theme.colors.text.tertiary}
              multiline
              style={{
                fontSize: theme.typography.sizes.base,
                fontFamily: theme.fontFamily.regular,
                color: theme.colors.text.primary,
                minHeight: 120,
                textAlignVertical: 'top',
              }}
            />
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
              <Text variant="caption" color={charColor}>
                {charsRemaining}
              </Text>
            </View>
          </View>
        </View>

        {/* Audience selector */}
        <View style={{ marginTop: theme.spacing.lg }}>
          <Text variant="caption" weight="medium" color={theme.colors.text.secondary} style={{ marginBottom: theme.spacing.sm }}>
            Аудитория
          </Text>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Pressable
              onPress={() => setAudience('public')}
              style={{
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                paddingVertical: 12,
                borderRadius: theme.borderRadius.md,
                backgroundColor: audience === 'public'
                  ? theme.colors.accent.primary + '20'
                  : theme.colors.background.secondary,
                borderWidth: audience === 'public' ? 1.5 : 1,
                borderColor: audience === 'public'
                  ? theme.colors.accent.primary
                  : theme.colors.border.light,
              }}
            >
              <Feather
                name="globe"
                size={16}
                color={audience === 'public' ? theme.colors.accent.primary : theme.colors.text.tertiary}
              />
              <Text
                variant="caption"
                weight={audience === 'public' ? 'semibold' : 'regular'}
                color={audience === 'public' ? theme.colors.accent.primary : theme.colors.text.secondary}
              >
                Для всех
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setAudience('friends')}
              style={{
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                paddingVertical: 12,
                borderRadius: theme.borderRadius.md,
                backgroundColor: audience === 'friends'
                  ? theme.colors.accent.primary + '20'
                  : theme.colors.background.secondary,
                borderWidth: audience === 'friends' ? 1.5 : 1,
                borderColor: audience === 'friends'
                  ? theme.colors.accent.primary
                  : theme.colors.border.light,
              }}
            >
              <Feather
                name="users"
                size={16}
                color={audience === 'friends' ? theme.colors.accent.primary : theme.colors.text.tertiary}
              />
              <Text
                variant="caption"
                weight={audience === 'friends' ? 'semibold' : 'regular'}
                color={audience === 'friends' ? theme.colors.accent.primary : theme.colors.text.secondary}
              >
                Для друзей
              </Text>
            </Pressable>
          </View>
        </View>

        <View style={{ marginTop: theme.spacing.xl }}>
          <Pressable
            onPress={handlePost}
            style={{
              backgroundColor: content.trim()
                ? theme.colors.accent.primary
                : theme.colors.border.light,
              borderRadius: theme.borderRadius.pill,
              paddingVertical: theme.spacing.base,
              alignItems: 'center',
            }}
            disabled={isPosting || !content.trim()}
          >
            <Text variant="body" weight="semibold" color={theme.colors.text.inverse}>
              {isPosting ? 'Публикация...' : 'Опубликовать'}
            </Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}
