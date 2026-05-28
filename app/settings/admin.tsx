import React, { useState, useEffect, useCallback } from 'react';
import { View, ScrollView, Pressable, TextInput, Alert, Modal, FlatList, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme';
import { Text, Avatar } from '../../src/components/ui';
import { CachedImage } from '../../src/components/ui/CachedImage';
import { supabase, parseImageUrls } from '../../src/lib/supabase';
import { formatTimeAgo } from '../../src/utils/mockData';

const ADMIN_PASSWORD = 'V7k!Qm9@Lp2#xR8$Tw6ZcD4%yN';

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
    Alert.alert('Удалить пост?', 'Это действие необратимо', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Удалить', style: 'destructive', onPress: async () => {
        await supabase.from('posts').delete().eq('id', postId);
        setUserPosts(prev => prev.filter(p => p.id !== postId));
        setShowPostModal(false);
        setSelectedPost(null);
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

  // Users list
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: insets.top + 8, paddingBottom: 12, paddingHorizontal: 16, gap: 12 }}>
        <Pressable onPress={() => router.back()}>
          <Feather name="chevron-left" size={24} color={theme.colors.text.primary} />
        </Pressable>
        <Feather name="shield" size={20} color={theme.colors.accent.primary} />
        <Text variant="body" weight="bold">Админ-панель</Text>
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
