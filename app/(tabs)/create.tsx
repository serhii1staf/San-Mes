import React, { useState } from 'react';
import { View, TextInput, Image, Pressable, ViewStyle, ScrollView, Alert, Platform } from 'react-native';
import Animated, {
  FadeIn,
  FadeInUp,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import * as ImagePicker from 'expo-image-picker';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../src/theme';
import { Text, Button } from '../../src/components/ui';

const MAX_CHARS = 500;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export default function CreateScreen() {
  const theme = useTheme();
  const [content, setContent] = useState('');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [audience, setAudience] = useState<'public' | 'friends'>('public');
  const [isPosting, setIsPosting] = useState(false);

  const buttonScale = useSharedValue(1);
  const buttonAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: buttonScale.value }],
  }));

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
    buttonScale.value = withSpring(0.95, { damping: 15, stiffness: 300 });
    setTimeout(() => {
      buttonScale.value = withSpring(1, { damping: 15, stiffness: 300 });
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
    paddingTop: theme.spacing['2xl'],
  };

  return (
    <ScrollView style={containerStyle} contentContainerStyle={{ paddingBottom: 100 }}>
      <View style={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.base }}>
        <Animated.View entering={FadeIn.duration(400)}>
          <Text variant="subheading" weight="bold" style={{ marginBottom: theme.spacing.lg }}>
            Create Post
          </Text>
        </Animated.View>

        <Animated.View entering={FadeInUp.duration(400).delay(100)}>
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
        </Animated.View>

        {selectedImage && (
          <Animated.View
            entering={FadeInUp.duration(300)}
            style={{ marginTop: theme.spacing.base, position: 'relative' }}
          >
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
          </Animated.View>
        )}

        <Animated.View entering={FadeInUp.duration(400).delay(200)}>
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
        </Animated.View>

        <Animated.View entering={FadeInUp.duration(400).delay(300)} style={{ marginTop: theme.spacing.xl }}>
          <AnimatedPressable
            onPress={handlePost}
            style={[
              buttonAnimatedStyle,
              {
                backgroundColor: (content.trim() || selectedImage)
                  ? theme.colors.accent.primary
                  : theme.colors.border.light,
                borderRadius: theme.borderRadius.pill,
                paddingVertical: theme.spacing.base,
                alignItems: 'center',
              },
            ]}
            disabled={isPosting}
          >
            <Text variant="body" weight="semibold" color={theme.colors.text.inverse}>
              {isPosting ? 'Posting...' : 'Share Post'}
            </Text>
          </AnimatedPressable>
        </Animated.View>
      </View>
    </ScrollView>
  );
}
