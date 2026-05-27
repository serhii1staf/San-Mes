import React, { useState, useEffect } from 'react';
import { View, Pressable, ViewStyle, TextInput, FlatList, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTheme } from '../../src/theme';
import { Text, Avatar } from '../../src/components/ui';
import { getProfiles } from '../../src/lib/supabase';

interface ProfileResult {
  id: string;
  username: string;
  display_name: string;
  emoji: string;
  bio: string;
}

export default function SearchScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [isFocused, setIsFocused] = useState(false);
  const [query, setQuery] = useState('');
  const [profiles, setProfiles] = useState<ProfileResult[]>([]);
  const [allProfiles, setAllProfiles] = useState<ProfileResult[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadProfiles();
  }, []);

  useEffect(() => {
    if (query.trim()) {
      const lower = query.toLowerCase();
      const filtered = allProfiles.filter(p =>
        p.username.toLowerCase().includes(lower) ||
        p.display_name.toLowerCase().includes(lower)
      );
      setProfiles(filtered);
    } else {
      setProfiles(allProfiles);
    }
  }, [query, allProfiles]);

  const loadProfiles = async () => {
    setIsLoading(true);
    const { profiles: data } = await getProfiles();
    setAllProfiles(data as any[]);
    setProfiles(data as any[]);
    setIsLoading(false);
  };

  const containerStyle: ViewStyle = {
    flex: 1,
    backgroundColor: theme.colors.background.primary,
    paddingTop: insets.top,
  };

  return (
    <View style={containerStyle}>
      <View style={{ paddingHorizontal: theme.spacing.base, paddingBottom: theme.spacing.sm }}>
        <Text variant="subheading" weight="bold">Поиск</Text>
      </View>

      {/* Search Input */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: theme.spacing.base,
          paddingVertical: theme.spacing.sm,
          backgroundColor: theme.colors.background.elevated,
          borderRadius: theme.borderRadius.pill,
          marginHorizontal: theme.spacing.base,
          marginTop: theme.spacing.sm,
          borderWidth: isFocused ? 1.5 : 1,
          borderColor: isFocused ? theme.colors.accent.primary : theme.colors.border.light,
        }}
      >
        <Feather
          name="search"
          size={18}
          color={isFocused ? theme.colors.accent.primary : theme.colors.text.tertiary}
        />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Поиск людей..."
          placeholderTextColor={theme.colors.text.tertiary}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          style={{
            flex: 1,
            marginLeft: theme.spacing.sm,
            fontSize: theme.typography.sizes.base,
            fontFamily: theme.fontFamily.regular,
            color: theme.colors.text.primary,
            paddingVertical: theme.spacing.xs,
          }}
        />
        {query.length > 0 && (
          <Pressable onPress={() => setQuery('')}>
            <Feather name="x" size={16} color={theme.colors.text.tertiary} />
          </Pressable>
        )}
      </View>

      {/* Results */}
      {isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={theme.colors.accent.primary} />
        </View>
      ) : (
        <FlatList
          data={profiles}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: theme.spacing.base, paddingTop: 16, paddingBottom: 100 }}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push({ pathname: '/profile/[id]', params: { id: item.id } })}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: 12,
                borderBottomWidth: 0.5,
                borderBottomColor: theme.colors.border.light,
              }}
            >
              <Avatar emoji={item.emoji} size="md" />
              <View style={{ marginLeft: 12, flex: 1 }}>
                <Text variant="body" weight="semibold">{item.display_name}</Text>
                <Text variant="caption" color={theme.colors.text.secondary}>@{item.username}</Text>
              </View>
              <Feather name="chevron-right" size={18} color={theme.colors.text.tertiary} />
            </Pressable>
          )}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingTop: 40 }}>
              <Text variant="body" color={theme.colors.text.tertiary}>Никого не найдено</Text>
            </View>
          }
        />
      )}
    </View>
  );
}
