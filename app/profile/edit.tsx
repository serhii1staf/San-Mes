import React, { useState } from 'react';
import { View, ScrollView, Pressable, ViewStyle, Alert, Platform, KeyboardAvoidingView } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme';
import { Text, Input, Avatar } from '../../src/components/ui';
import { useAuthStore } from '../../src/store';
import { currentUser } from '../../src/utils/mockData';

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

  const handleSave = () => {
    setIsSaving(true);
    setTimeout(() => {
      updateProfile({ displayName: name, username, bio });
      setIsSaving(false);
      Alert.alert('Saved!', 'Your profile has been updated.');
      router.back();
    }, 800);
  };

  const outerStyle: ViewStyle = {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingTop: insets.top + 16,
    paddingBottom: insets.bottom + 16,
  };

  const cardStyle: ViewStyle = {
    backgroundColor: theme.colors.background.primary,
    borderRadius: 24,
    maxHeight: '95%',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 12,
  };

  return (
    <KeyboardAvoidingView style={outerStyle} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={cardStyle}>
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
              paddingHorizontal: theme.spacing.lg,
              paddingTop: theme.spacing.lg,
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
          <View style={{ alignItems: 'center', marginVertical: theme.spacing.lg }}>
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
          </View>

          {/* Fields */}
          <View style={{ paddingHorizontal: theme.spacing.lg }}>
            <View>
              <Input
                label="Display Name"
                value={name}
                onChangeText={setName}
                placeholder="Your display name"
                style={{ marginBottom: theme.spacing.base }}
              />
            </View>

            <View>
              <Input
                label="Username"
                value={username}
                onChangeText={setUsername}
                placeholder="your_username"
                style={{ marginBottom: theme.spacing.base }}
              />
            </View>

            <View>
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
            </View>

            <View>
              <Input
                label="Website"
                value={website}
                onChangeText={setWebsite}
                placeholder="https://yourwebsite.com"
                style={{ marginBottom: theme.spacing.xl }}
              />
            </View>

            <View>
              <Pressable
                onPress={handleSave}
                style={{
                  backgroundColor: theme.colors.accent.primary,
                  borderRadius: theme.borderRadius.pill,
                  paddingVertical: theme.spacing.base,
                  alignItems: 'center',
                }}
                disabled={isSaving}
              >
                <Text variant="body" weight="semibold" color={theme.colors.text.inverse}>
                  {isSaving ? 'Saving...' : 'Save Changes'}
                </Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}
