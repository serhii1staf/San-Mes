import React, { useState } from 'react';
import { View, TextInput, Image, Pressable, ViewStyle, ScrollView, Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';

const MAX_CHARS = 500;

export default function CreateScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [content, setContent] = useState('');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [audience, setAudience] = useState<'public' | 'friends'>('public');
  const [isPosting, setIsPosting] = useState(false);

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });

    if (!result.canceled) {
      setSelectedImage(result.assets[0].uri);
    }
  };

  const handlePost = () => {
    if (!content.trim() && !selectedImage) return;
    setIsPosting(true);
    setTimeout(() => {
      setIsPosting(false);
      setContent('');
      setSelectedImage(null);
      Alert.alert('Posted!', 'Your post has been shared.');
    }, 1000);
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
            Create Post
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
              placeholder="What's on your mind?"
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

        {selectedImage && (
          <View style={{ marginTop: theme.spacing.base, position: 'relative' }}>
            <Image
              source={{ uri: selectedImage }}
              style={{
                width: '100%',
                height: 200,
                borderRadius: theme.borderRadius.lg,
              }}
              resizeMode="cover"
            />
            <Pressable
              onPress={() => setSelectedImage(null)}
              style={{
                position: 'absolute',
                top: theme.spacing.sm,
                right: theme.spacing.sm,
                width: 28,
                height: 28,
                borderRadius: 14,
                backgroundColor: 'rgba(0,0,0,0.6)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Feather name="x" size={16} color="#fff" />
            </Pressable>
          </View>
        )}

        <View>
          <View
            style={{
              flexDirection: 'row',
              marginTop: theme.spacing.lg,
              gap: theme.spacing.sm,
            }}
          >
            <Pressable
              onPress={pickImage}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: theme.spacing.base,
                paddingVertical: theme.spacing.md,
                borderRadius: theme.borderRadius.pill,
                backgroundColor: theme.colors.background.elevated,
                borderWidth: 1,
                borderColor: theme.colors.border.light,
              }}
            >
              <Feather name="image" size={18} color={theme.colors.accent.secondary} />
              <Text variant="caption" weight="medium" style={{ marginLeft: theme.spacing.xs }}>
                Photo
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setAudience(audience === 'public' ? 'friends' : 'public')}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: theme.spacing.base,
                paddingVertical: theme.spacing.md,
                borderRadius: theme.borderRadius.pill,
                backgroundColor: theme.colors.background.elevated,
                borderWidth: 1,
                borderColor: theme.colors.border.light,
              }}
            >
              <Feather
                name={audience === 'public' ? 'globe' : 'users'}
                size={18}
                color={theme.colors.accent.tertiary}
              />
              <Text variant="caption" weight="medium" style={{ marginLeft: theme.spacing.xs }}>
                {audience === 'public' ? 'Public' : 'Friends'}
              </Text>
            </Pressable>
          </View>
        </View>

        <View style={{ marginTop: theme.spacing.xl }}>
          <Pressable
            onPress={handlePost}
            style={{
              backgroundColor: (content.trim() || selectedImage)
                ? theme.colors.accent.primary
                : theme.colors.border.light,
              borderRadius: theme.borderRadius.pill,
              paddingVertical: theme.spacing.base,
              alignItems: 'center',
            }}
            disabled={isPosting}
          >
            <Text variant="body" weight="semibold" color={theme.colors.text.inverse}>
              {isPosting ? 'Posting...' : 'Share Post'}
            </Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}
