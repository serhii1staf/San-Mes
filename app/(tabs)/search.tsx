import React, { useState, useEffect, useCallback } from 'react';
import { View, Pressable, ViewStyle, TextInput, FlatList, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../src/theme';
import { Text, Avatar } from '../../src/components/ui';
import { VerifiedBadge } from '../../src/components/ui/VerifiedBadge';
import { UserBadge } from '../../src/components/ui/UserBadge';
import { getProfiles } from '../../src/lib/supabase';
import { useMiniAppsStore } from '../../src/store/miniAppsStore';

const SEARCH_HISTORY_KEY = '@san:search_history';

interface ProfileResult {
  id: string;
  username: string;
  display_name: string;
  emoji: string;
  bio: string;
  badge?: string;
  is_verified?: boolean;
}

export default function SearchScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [isFocused, setIsFocused] = useState(false);
  const [query, setQuery] = useState('');
  const [profiles, setProfiles] = useState<ProfileResult[]>([]);
  const [allProfiles, setAllProfiles] = useState<ProfileResult[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [history, setHistory] = useState<ProfileResult[]>([]);

  useEffect(() => {
    loadProfiles();
    loadHistory();
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
      setProfiles([]);
    }
  }, [query, allProfiles]);

  const loadProfiles = async () => {
    setIsLoading(true);
    const { profiles: data } = await getProfiles();
    setAllProfiles(data as any[]);
    setIsLoading(false);
  };

  const loadHistory = async () => {
    try {
      const cached = await AsyncStorage.getItem(SEARCH_HISTORY_KEY);
      if (cached) setHistory(JSON.parse(cached));
    } catch {}
  };

  const addToHistory = useCallback(async (profile: ProfileResult) => {
    const updated = [profile, ...history.filter(h => h.id !== profile.id)].slice(0, 10);
    setHistory(updated);
    await AsyncStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(updated));
  }, [history]);

  const clearHistory = async () => {
    setHistory([]);
    await AsyncStorage.removeItem(SEARCH_HISTORY_KEY);
  };

  const handleSelect = (item: ProfileResult) => {
    addToHistory(item);
    router.push({ pathname: '/profile/[id]', params: { id: item.id } });
  };

  const containerStyle: ViewStyle = {
    flex: 1,
    backgroundColor: theme.colors.background.primary,
    paddingTop: insets.top,
  };

  const showHistory = !query.trim() && history.length > 0;

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

      {/* History */}
      {showHistory && (
        <View style={{ paddingHorizontal: theme.spacing.base, paddingTop: 16 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Text variant="caption" weight="semibold" color={theme.colors.text.secondary}>Недавние</Text>
            <Pressable onPress={clearHistory}>
              <Text variant="caption" color={theme.colors.accent.primary}>Очистить</Text>
            </Pressable>
          </View>
          {history.map(item => (
            <Pressable key={item.id} onPress={() => handleSelect(item)} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10 }}>
              <Avatar emoji={item.emoji} size="sm" />
              <View style={{ marginLeft: 10, flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                  <Text variant="caption" weight="semibold" numberOfLines={1} style={{ maxWidth: '70%' }}>{item.display_name}</Text>
                  {item.is_verified && <VerifiedBadge size={10} />}
                </View>
                <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1}>@{item.username}</Text>
              </View>
              <Feather name="clock" size={14} color={theme.colors.text.tertiary} />
            </Pressable>
          ))}
        </View>
      )}

      {/* Results */}
      {isLoading && !showHistory ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={theme.colors.accent.primary} />
        </View>
      ) : query.trim() ? (
        <FlatList
          data={profiles}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: theme.spacing.base, paddingTop: 16, paddingBottom: 100 }}
          ListHeaderComponent={() => {
            const { searchApps } = useMiniAppsStore.getState();
            const matchedApps = searchApps(query);
            if (matchedApps.length === 0) return null;
            return (
              <View style={{ marginBottom: 16 }}>
                <Text variant="caption" weight="semibold" color={theme.colors.text.secondary} style={{ marginBottom: 8 }}>Мини-приложения</Text>
                {matchedApps.slice(0, 3).map(app => (
                  <Pressable key={app.id} onPress={() => router.push({ pathname: '/mini-app', params: { url: encodeURIComponent(app.url), name: app.name, emoji: app.emoji } })} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8 }}>
                    <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: theme.colors.accent.primary + '12', alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontSize: 18 }} allowFontScaling={false}>{app.emoji}</Text>
                    </View>
                    <Text variant="body" weight="medium" style={{ marginLeft: 10 }}>{app.name}</Text>
                  </Pressable>
                ))}
              </View>
            );
          }}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => handleSelect(item)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: 12,
                borderBottomWidth: 0.5,
                borderBottomColor: theme.colors.border.light,
              }}
            >
              <Avatar emoji={item.emoji} size="md" />
              <View style={{ marginLeft: 12, flex: 1, overflow: 'hidden' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                  <Text variant="body" weight="semibold" numberOfLines={1} style={{ flexShrink: 1 }}>{item.display_name}</Text>
                  {item.is_verified && <VerifiedBadge size={12} />}
                  {item.badge && <UserBadge badge={item.badge} size="sm" />}
                </View>
                <Text variant="caption" color={theme.colors.text.secondary} numberOfLines={1}>@{item.username}</Text>
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
      ) : null}
    </View>
  );
}
