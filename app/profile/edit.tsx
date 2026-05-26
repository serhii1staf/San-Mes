import React, { useState } from 'react';
import { View, ScrollView, Pressable, ViewStyle, Alert, Platform, KeyboardAvoidingView } from 'react-native';
import Animated, { FadeInUp, useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '../../src/theme';
import { Text, Input, Avatar } from '../../src/components/ui';
import { useAuthStore } from '../../src/store';
import { currentUser } from '../../src/utils/mockData';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export default function EditProfileScreen() {
  const theme = useTheme();
  const { user, updateProfile } = useAuthStore();
  const displayUser = user || currentUser;

  const [name, setName] = useState(displayUser.displayName);
  const [username, setUsername] = useState(displayUser.username);
  const [bio, setBio] = useState(displayUser.bio || '');
  const [website, setWebsite] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const saveScale = useSharedValue(1);
  const saveAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: saveScale.value }],
  }));

  const handleSave = () => {
    setIsSaving(true);
    saveScale.value = withSpring(0.95, { damping: 15, stiffness: 300 });
    setTimeout(() => {
      saveScale.value = withSpring(1, { damping: 15, stiffness: 300 });
      updateProfile({ displayName: name, username, bio });
      setIsSaving(false);
      Alert.alert('Saved!', 'Your profile has been updated.');
      router.back();
    }, 800);
  };

  const containerStyle: ViewStyle = {
    flex: 1,
    backgroundColor: theme.colors.background.primary,
  };

  return (
    <KeyboardAvoidingView style={containerStyle} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: theme.spacing.lg,
            paddingTop: theme.spacing['2xl'],
            paddingBottom: theme.spacing.md,
          }}
        >
          <Pressable onPress={() => router.back()}>
            <Feather name="x" size={22} color={theme.colors.text.primary} />
          </Pressable>
          <Text variant="body" weight="semibold">Edit Profile</Text>
          <View style={{ width: 22 }} />
        </View>

        {/* Avatar */}
        <Animated.View entering={FadeInUp.duration(400)} style={{ alignItems: 'center', marginVertical: theme.spacing.lg }}>
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
                borderColor: theme.colors.background.primary,
              }}
            >
              <Feather name="camera" size={16} color={theme.colors.text.inverse} />
            </Pressable>
          </View>
          <Pressable style={{ marginTop: theme.spacing.md }}>
            <Text variant="body" weight="medium" color={theme.colors.accent.primary}>
              Change Photo
            </Text>
          </Pressable>
        </Animated.View>

        {/* Fields */}
        <View style={{ paddingHorizontal: theme.spacing.lg }}>
          <Animated.View entering={FadeInUp.duration(400).delay(100)}>
            <Input
              label="Display Name"
              value={name}
              onChangeText={setName}
              placeholder="Your display name"
              style={{ marginBottom: theme.spacing.base }}
            />
          </Animated.View>

          <Animated.View entering={FadeInUp.duration(400).delay(150)}>
            <Input
              label="Username"
              value={username}
              onChangeText={setUsername}
              placeholder="your_username"
              style={{ marginBottom: theme.spacing.base }}
            />
          </Animated.View>

          <Animated.View entering={FadeInUp.duration(400).delay(200)}>
            <Input
              label="Bio"
              value={bio}
              onChangeText={(text) => setBio(text.slice(0, 150))}
              placeholder="Tell people about yourself"
              multiline
              style={{ marginBottom: theme.spacing.base }}
            />
            <Text
              variant="caption"
              color={theme.colors.text.tertiary}
              style={{ marginTop: -theme.spacing.sm, marginBottom: theme.spacing.base }}
            >
              {150 - bio.length} characters remaining
            </Text>
          </Animated.View>

          <Animated.View entering={FadeInUp.duration(400).delay(250)}>
            <Input
              label="Website"
              value={website}
              onChangeText={setWebsite}
              placeholder="https://yourwebsite.com"
              style={{ marginBottom: theme.spacing.xl }}
            />
          </Animated.View>

          <Animated.View entering={FadeInUp.duration(400).delay(300)}>
            <AnimatedPressable
              onPress={handleSave}
              style={[
                saveAnimatedStyle,
                {
                  backgroundColor: theme.colors.accent.primary,
                  borderRadius: theme.borderRadius.pill,
                  paddingVertical: theme.spacing.base,
                  alignItems: 'center',
                },
              ]}
              disabled={isSaving}
            >
              <Text variant="body" weight="semibold" color={theme.colors.text.inverse}>
                {isSaving ? 'Saving...' : 'Save Changes'}
              </Text>
            </AnimatedPressable>
          </Animated.View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
