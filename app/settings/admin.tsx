import React, { useState, useEffect, useCallback } from 'react';
import { View, ScrollView, Pressable, TextInput, Alert, Modal, FlatList, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../src/theme';
import { Text, Avatar } from '../../src/components/ui';
import { CachedImage } from '../../src/components/ui/CachedImage';
import { supabase, parseImageUrls, adminDeletePost } from '../../src/lib/supabase';
import { useFeedStore } from '../../src/store/feedStore';
import { accountKey } from '../../src/services/cacheService';
import { formatTimeAgo } from '../../src/utils/mockData';

const ADMIN_PASSWORD = 'V7k!Qm9@Lp2#xR8$Tw6ZcD4%yN';
const STATUS_ENDPOINT = 'https://san-m-app.com/api/admin/status';

interface ServiceStatus {
  key: string;
  name: string;
  status: 'online' | 'degraded' | 'offline';
  latencyMs: number;
  detail: string;
}
interface StatusResponse {
  generatedAt: string;
  services: ServiceStatus[];
  metrics: { profiles: number | null; posts: number | null; comments: number | null; dbLatencyMs: number };
}

const BADGES = [
  { key: 'developer', label: 'Разработчик', color: '#6366F1', icon: 'code' },
  { key: 'admin', label: 'Администратор', color: '#EF4444', icon: 'shield' },
  { key: 'moderator', label: 'Модератор', color: '#F59E0B', icon: 'eye' },
  { key: 'verified', label: 'Верифицирован', color: '#10B981', icon: 'check-circle' },
  { key: 'vip', label: 'VIP', color: '#8B5CF6', icon: 'star' },
  { key: 'creator', label: 'Создатель контента', color: '#EC4899', icon: 'film' },
];

export default function AdminScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [users, setUsers] = useState<any[]>([]);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [userPosts, setUserPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [showPostModal, setShowPostModal] = useState(false);
  const [selectedPost, setSelectedPost] = useState<any>(null);
  const [showStatus, setShowStatus] = useState(false);
  const [statusData, setStatusData] = useState<StatusResponse | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    setStatusError(null);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      const resp = await fetch(STATUS_ENDPOINT, {
        headers: { 'x-admin-key': ADMIN_PASSWORD },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!resp.ok) throw new Error('Сервер вернул ' + resp.status);
      const json = (await resp.json()) as StatusResponse;
      setStatusData(json);
    } catch (e: any) {
      setStatusError(e?.message || 'Не удалось загрузить статус');
    } finally {
      setStatusLoading(false);
    }
  }, []);

  const openStatus = () => {
    setShowStatus(true);
    loadStatus();
  };

  const handleLogin = () => {
    if (password === ADMIN_PASSWORD) {
      setAuthenticated(true);
      loadUsers();
    } else {
      Alert.alert('Ошибка', 'Неверный пароль');
    }
  };

  const loadUsers = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('profiles').select('*').order('created_at', { ascending: false }).limit(50);
    if (data) setUsers(data);
    setLoading(false);
  }, []);

  const loadUserPosts = useCallback(async (userId: string) => {
    setLoading(true);
    const { data } = await supabase.from('posts').select('*').eq('author_id', userId).order('created_at', { ascending: false }).limit(30);
    if (data) setUserPosts(data);
    setLoading(false);
  }, []);

  const handleSelectUser = (user: any) => {
    setSelectedUser(user);
    loadUserPosts(user.id);
  };

  const handleDeletePost = async (postId: string) => {
    Alert.alert('Удалить пост?', 'Будет удалён с сервера, из кэшей и все связанные репосты', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Удалить', style: 'destructive', onPress: async () => {
        // Delete from server (+ images + reposts + likes + comments)
        const { error } = await adminDeletePost(postId);
        if (error) {
          Alert.alert('Ошибка', error);
          return;
        }

        // Remove from local state
        setUserPosts(prev => prev.filter(p => p.id !== postId));
        setShowPostModal(false);
        setSelectedPost(null);

        // Remove from Zustand feed store
        useFeedStore.getState().removePost(postId);

        // Remove from AsyncStorage caches
        try {
          const feedCached = await AsyncStorage.getItem(accountKey('@san:feed_posts'));
          if (feedCached) {
            const posts = JSON.parse(feedCached).filter((p: any) => p.id !== postId);
            await AsyncStorage.setItem(accountKey('@san:feed_posts'), JSON.stringify(posts));
          }
          const myCached = await AsyncStorage.getItem(accountKey('@san:my_posts'));
          if (myCached) {
            const posts = JSON.parse(myCached).filter((p: any) => p.id !== postId);
            await AsyncStorage.setItem(accountKey('@san:my_posts'), JSON.stringify(posts));
          }
        } catch {}
      }},
    ]);
  };

  const handleToggleVerify = async (userId: string, currentlyVerified: boolean) => {
    await supabase.from('profiles').update({ is_verified: !currentlyVerified }).eq('id', userId);
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, is_verified: !currentlyVerified } : u));
    if (selectedUser?.id === userId) setSelectedUser({ ...selectedUser, is_verified: !currentlyVerified });
  };

  const handleSetBadge = async (userId: string, badge: string | null) => {
    await supabase.from('profiles').update({ badge }).eq('id', userId);
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, badge } : u));
    if (selectedUser?.id === userId) setSelectedUser({ ...selectedUser, badge });
  };

  // Password screen
  if (!authenticated) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background.primary, justifyContent: 'center', paddingHorizontal: 32 }}>
        <Pressable onPress={() => router.back()} style={{ position: 'absolute', top: insets.top + 12, left: 16 }}>
          <Feather name="chevron-left" size={24} color={theme.colors.text.primary} />
        </Pressable>
        <View style={{ alignItems: 'center', marginBottom: 32 }}>
          <Feather name="shield" size={40} color={theme.colors.accent.primary} />
          <Text variant="subheading" weight="bold" style={{ marginTop: 12 }}>Панель управления</Text>
          <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginTop: 4 }}>Введите пароль администратора</Text>
        </View>
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="Пароль"
          placeholderTextColor={theme.colors.text.tertiary}
          secureTextEntry
          autoFocus
          style={{
            backgroundColor: theme.colors.background.elevated,
            borderRadius: 14,
            paddingHorizontal: 16,
            paddingVertical: 14,
            fontSize: 16,
            color: theme.colors.text.primary,
            borderWidth: 1,
            borderColor: theme.colors.border.light,
            marginBottom: 16,
          }}
          onSubmitEditing={handleLogin}
        />
        <Pressable onPress={handleLogin} style={{ backgroundColor: theme.colors.accent.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' }}>
          <Text variant="body" weight="semibold" color="#FFFFFF">Войти</Text>
        </Pressable>
      </View>
    );
  }

  // User posts view
  if (selectedUser) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: insets.top + 8, paddingBottom: 12, paddingHorizontal: 16, gap: 12 }}>
          <Pressable onPress={() => { setSelectedUser(null); setUserPosts([]); }}>
            <Feather name="chevron-left" size={24} color={theme.colors.text.primary} />
          </Pressable>
          <Avatar emoji={selectedUser.emoji || '😊'} size="sm" />
          <View style={{ flex: 1 }}>
            <Text variant="body" weight="semibold">{selectedUser.display_name}</Text>
            <Text variant="caption" color={theme.colors.text.tertiary}>@{selectedUser.username}</Text>
          </View>
        </View>

        {/* Badge & Verify controls */}
        <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
            <Pressable onPress={() => handleToggleVerify(selectedUser.id, selectedUser.is_verified)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: selectedUser.is_verified ? '#10B98120' : theme.colors.background.secondary }}>
              <Feather name="check-circle" size={14} color={selectedUser.is_verified ? '#10B981' : theme.colors.text.tertiary} />
              <Text variant="caption" color={selectedUser.is_verified ? '#10B981' : theme.colors.text.tertiary}>{selectedUser.is_verified ? 'Верифицирован' : 'Верифицировать'}</Text>
            </Pressable>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            <Pressable onPress={() => handleSetBadge(selectedUser.id, null)} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: !selectedUser.badge ? theme.colors.accent.primary + '20' : theme.colors.background.secondary }}>
              <Text variant="caption" color={!selectedUser.badge ? theme.colors.accent.primary : theme.colors.text.tertiary}>Без плашки</Text>
            </Pressable>
            {BADGES.map(b => (
              <Pressable key={b.key} onPress={() => handleSetBadge(selectedUser.id, b.key)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: selectedUser.badge === b.key ? b.color + '20' : theme.colors.background.secondary }}>
                <Feather name={b.icon as any} size={12} color={selectedUser.badge === b.key ? b.color : theme.colors.text.tertiary} />
                <Text variant="caption" color={selectedUser.badge === b.key ? b.color : theme.colors.text.tertiary}>{b.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        {/* Posts list */}
        {loading ? <ActivityIndicator style={{ marginTop: 40 }} /> : (
          <FlatList
            data={userPosts}
            keyExtractor={item => item.id}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
            renderItem={({ item }) => {
              const imgs = parseImageUrls(item.image_url);
              return (
                <Pressable onPress={() => { setSelectedPost(item); setShowPostModal(true); }} style={{ backgroundColor: theme.colors.background.elevated, borderRadius: 16, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: theme.colors.border.light }}>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    {imgs[0] && <CachedImage uri={imgs[0]} style={{ width: 50, height: 50, borderRadius: 10 }} resizeMode="cover" />}
                    <View style={{ flex: 1 }}>
                      <Text variant="caption" numberOfLines={2} color={theme.colors.text.secondary}>{item.content || '(без текста)'}</Text>
                      <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 10, marginTop: 4 }}>{formatTimeAgo(item.created_at)}</Text>
                    </View>
                    <Pressable onPress={() => handleDeletePost(item.id)} style={{ padding: 6 }}>
                      <Feather name="trash-2" size={16} color="#FF3B30" />
                    </Pressable>
                  </View>
                </Pressable>
              );
            }}
            ListEmptyComponent={<Text variant="caption" color={theme.colors.text.tertiary} align="center" style={{ marginTop: 40 }}>Нет публикаций</Text>}
          />
        )}

        {/* Post detail modal */}
        <Modal visible={showPostModal} transparent animationType="fade" onRequestClose={() => setShowPostModal(false)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', paddingHorizontal: 16 }}>
            <View style={{ backgroundColor: theme.isDark ? theme.colors.background.elevated : '#FFFFFF', borderRadius: 24, padding: 20, maxHeight: '80%' }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 }}>
                <Text variant="body" weight="semibold">Пост</Text>
                <Pressable onPress={() => setShowPostModal(false)}><Feather name="x" size={22} color={theme.colors.text.primary} /></Pressable>
              </View>
              {selectedPost && (
                <ScrollView showsVerticalScrollIndicator={false}>
                  <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginBottom: 8 }}>ID: {selectedPost.id}</Text>
                  <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginBottom: 12 }}>{formatTimeAgo(selectedPost.created_at)}</Text>
                  {selectedPost.content && <Text variant="body" style={{ marginBottom: 12 }}>{selectedPost.content}</Text>}
                  {parseImageUrls(selectedPost.image_url).map((uri: string, i: number) => (
                    <CachedImage key={i} uri={uri} style={{ width: '100%', height: 200, borderRadius: 12, marginBottom: 8 }} resizeMode="cover" />
                  ))}
                  <Pressable onPress={() => handleDeletePost(selectedPost.id)} style={{ backgroundColor: '#FF3B3015', borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 16 }}>
                    <Text variant="body" weight="semibold" color="#FF3B30">Удалить пост</Text>
                  </Pressable>
                </ScrollView>
              )}
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  // Services / Status view
  if (showStatus) {
    const dot = (s: string) => (s === 'online' ? '#10B981' : s === 'degraded' ? '#F59E0B' : '#EF4444');
    const dotLabel = (s: string) => (s === 'online' ? 'Онлайн' : s === 'degraded' ? 'Сбои' : 'Недоступно');
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: insets.top + 8, paddingBottom: 12, paddingHorizontal: 16, gap: 12 }}>
          <Pressable onPress={() => setShowStatus(false)}>
            <Feather name="chevron-left" size={24} color={theme.colors.text.primary} />
          </Pressable>
          <Feather name="activity" size={20} color={theme.colors.accent.primary} />
          <Text variant="body" weight="bold" style={{ flex: 1 }}>Сервисы и нагрузка</Text>
          <Pressable onPress={loadStatus} hitSlop={8} style={{ padding: 4 }}>
            <Feather name="refresh-cw" size={18} color={theme.colors.text.secondary} />
          </Pressable>
        </View>

        {statusLoading && !statusData ? (
          <ActivityIndicator style={{ marginTop: 40 }} />
        ) : statusError ? (
          <View style={{ padding: 24, alignItems: 'center' }}>
            <Feather name="alert-triangle" size={28} color="#F59E0B" />
            <Text variant="body" color={theme.colors.text.secondary} align="center" style={{ marginTop: 12 }}>{statusError}</Text>
            <Pressable onPress={loadStatus} style={{ marginTop: 16, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12, backgroundColor: theme.colors.accent.primary }}>
              <Text variant="caption" color="#FFFFFF" weight="semibold">Повторить</Text>
            </Pressable>
          </View>
        ) : statusData ? (
          <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
            {/* Services */}
            <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginBottom: 8, marginTop: 4 }}>СЕРВИСЫ</Text>
            {statusData.services.map((s) => (
              <View key={s.key} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.background.elevated, borderRadius: 16, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: theme.colors.border.light, gap: 12 }}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: dot(s.status) }} />
                <View style={{ flex: 1 }}>
                  <Text variant="body" weight="semibold" numberOfLines={1}>{s.name}</Text>
                  <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1} style={{ marginTop: 2 }}>{s.detail}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text variant="caption" weight="semibold" color={dot(s.status)}>{dotLabel(s.status)}</Text>
                  {s.latencyMs > 0 && <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 10, marginTop: 2 }}>{s.latencyMs} мс</Text>}
                </View>
              </View>
            ))}

            {/* Metrics */}
            <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginBottom: 8, marginTop: 16 }}>БАЗА ДАННЫХ</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <MetricCard theme={theme} label="Профили" value={statusData.metrics.profiles} />
              <MetricCard theme={theme} label="Посты" value={statusData.metrics.posts} />
              <MetricCard theme={theme} label="Комменты" value={statusData.metrics.comments} />
            </View>

            <View style={{ marginTop: 16, backgroundColor: theme.colors.background.elevated, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: theme.colors.border.light }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                <Text variant="caption" color={theme.colors.text.tertiary}>Задержка БД</Text>
                <Text variant="caption" weight="semibold">{statusData.metrics.dbLatencyMs} мс</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text variant="caption" color={theme.colors.text.tertiary}>Обновлено</Text>
                <Text variant="caption" weight="semibold">{new Date(statusData.generatedAt).toLocaleTimeString('ru-RU')}</Text>
              </View>
            </View>
          </ScrollView>
        ) : null}
      </View>
    );
  }

  // Users list
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: insets.top + 8, paddingBottom: 12, paddingHorizontal: 16, gap: 12 }}>
        <Pressable onPress={() => router.back()}>
          <Feather name="chevron-left" size={24} color={theme.colors.text.primary} />
        </Pressable>
        <Feather name="shield" size={20} color={theme.colors.accent.primary} />
        <Text variant="body" weight="bold" style={{ flex: 1 }}>Админ-панель</Text>
        <Pressable onPress={openStatus} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: theme.colors.accent.primary + '18' }}>
          <Feather name="activity" size={14} color={theme.colors.accent.primary} />
          <Text variant="caption" weight="semibold" color={theme.colors.accent.primary}>Сервисы</Text>
        </Pressable>
      </View>

      {loading ? <ActivityIndicator style={{ marginTop: 40 }} /> : (
        <FlatList
          data={users}
          keyExtractor={item => item.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
          renderItem={({ item }) => {
            const badge = BADGES.find(b => b.key === item.badge);
            return (
              <Pressable onPress={() => handleSelectUser(item)} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.background.elevated, borderRadius: 16, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: theme.colors.border.light, gap: 12 }}>
                <Avatar emoji={item.emoji || '😊'} size="sm" />
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text variant="body" weight="semibold" numberOfLines={1}>{item.display_name}</Text>
                    {item.is_verified && <Feather name="check-circle" size={12} color="#10B981" />}
                    {badge && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: badge.color + '20', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                        <Feather name={badge.icon as any} size={9} color={badge.color} />
                        <Text style={{ fontSize: 9, color: badge.color, fontWeight: '600' }}>{badge.label}</Text>
                      </View>
                    )}
                  </View>
                  <Text variant="caption" color={theme.colors.text.tertiary}>@{item.username}</Text>
                </View>
                <Feather name="chevron-right" size={18} color={theme.colors.text.tertiary} />
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

function MetricCard({ theme, label, value }: { theme: any; label: string; value: number | null }) {
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background.elevated, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: theme.colors.border.light, alignItems: 'center' }}>
      <Text variant="subheading" weight="bold" style={{ fontSize: 22 }}>{value ?? '—'}</Text>
      <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginTop: 2 }}>{label}</Text>
    </View>
  );
}
