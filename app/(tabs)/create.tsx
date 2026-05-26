import React, { useState } from 'react';
import { View, TextInput, Pressable, ViewStyle, ScrollView, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { useAuthStore } from '../../src/store/authStore';
import { createPost } from '../../src/lib/supabase';

const MAX_CHARS = 500;

export default function CreateScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const [content, setContent] = useState('');
  const [isPosting, setIsPosting] = useState(false);

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
